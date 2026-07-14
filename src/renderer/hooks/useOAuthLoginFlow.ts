import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type {
  OAuthLoginInspectResult,
  OAuthLoginSaveResult,
  OAuthLoginSession,
  TargetTool
} from "../../shared/types";
import type { OAuthLoginDialogProps } from "../components/OAuthLoginDialog";
import { startOAuthLoginAutoInspect } from "../oauthLoginPolling";
import type { StatusMessage } from "../types";
import { getApi, getErrorMessage } from "../utils";

interface OAuthLoginInspectionState {
  profileNameDraft: string;
  nicknameDraft: string;
  status: StatusMessage;
}

type OAuthLoginInspectionDetails = Pick<
  OAuthLoginInspectResult,
  "oauthExists" | "accountEmail" | "proposedProfileName" | "proposedNickname" | "conflictProfileName"
>;

interface UseOAuthLoginFlowOptions {
  selectedTool: TargetTool;
  profilesRoot: string;
  existingProfileNames: string[];
  isAccountActionBlocked: () => boolean;
  onSaved: (saved: OAuthLoginSaveResult) => void;
}

interface OAuthLoginFlow {
  isOpen: boolean;
  open: () => void;
  dialogProps: OAuthLoginDialogProps;
}

type OAuthLoginOperation = "starting" | "inspecting" | "saving" | "cancelling";

export function buildOAuthLoginInspectionState(
  inspection: OAuthLoginInspectionDetails,
  credentialLabel: string
): OAuthLoginInspectionState {
  const profileNameDraft = inspection.proposedProfileName ?? "";
  const nicknameDraft = inspection.proposedNickname ?? "";
  if (inspection.conflictProfileName) {
    return {
      profileNameDraft,
      nicknameDraft,
      status: {
        tone: "error",
        text: `账号已存在：${inspection.conflictProfileName}。请不要重复新增，或手动改成新的保存名称。`
      }
    };
  }

  return {
    profileNameDraft,
    nicknameDraft,
    status: {
      tone: "success",
      text: inspection.accountEmail
        ? `已识别到账号 ${inspection.accountEmail}。`
        : `已检测到 ${credentialLabel}，但没有识别出邮箱。请手动填写保存名称。`
    }
  };
}

export function useOAuthLoginFlow(options: UseOAuthLoginFlowOptions): OAuthLoginFlow {
  const credentialLabel = options.selectedTool === "gemini" ? "OAuth 文件" : "登录凭据";
  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState<OAuthLoginSession | undefined>();
  const [inspection, setInspection] = useState<OAuthLoginInspectResult | undefined>();
  const [status, setStatus] = useState<StatusMessage>({
    tone: "idle",
    text: "会先创建临时登录目录，登录成功后自动识别账号。"
  });
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const inspectionInFlightRef = useRef(false);
  const operationInFlightRef = useRef<OAuthLoginOperation | undefined>(undefined);
  const isAccountActionBlockedRef = useRef(options.isAccountActionBlocked);
  const onSavedRef = useRef(options.onSaved);
  isAccountActionBlockedRef.current = options.isAccountActionBlocked;
  onSavedRef.current = options.onSaved;

  const clearSession = useCallback(() => {
    setSession(undefined);
    setInspection(undefined);
    setProfileNameDraft("");
    setNicknameDraft("");
  }, []);

  const requestInspection = useCallback(async (sessionId: string): Promise<OAuthLoginInspectResult | undefined> => {
    if (inspectionInFlightRef.current) {
      return undefined;
    }
    inspectionInFlightRef.current = true;
    try {
      return await getApi().inspectOAuthLogin(sessionId);
    } finally {
      inspectionInFlightRef.current = false;
    }
  }, []);

  const applyInspection = useCallback((nextInspection: OAuthLoginInspectResult) => {
    const nextState = buildOAuthLoginInspectionState(nextInspection, credentialLabel);
    setInspection(nextInspection);
    setProfileNameDraft(nextState.profileNameDraft);
    setNicknameDraft(nextState.nicknameDraft);
    setStatus(nextState.status);
  }, [credentialLabel]);

  useEffect(() => {
    const sessionId = session?.sessionId;
    if (!isOpen || !sessionId || inspection?.oauthExists || isCancelling) {
      return;
    }

    return startOAuthLoginAutoInspect({
      inspect: () => requestInspection(sessionId),
      onResult: (nextInspection) => {
        if (nextInspection.oauthExists) {
          applyInspection(nextInspection);
        }
      },
      isComplete: (nextInspection) => nextInspection.oauthExists
    });
  }, [applyInspection, inspection?.oauthExists, isCancelling, isOpen, requestInspection, session?.sessionId]);

  const open = useCallback(() => {
    if (isOpen || operationInFlightRef.current) {
      return;
    }
    clearSession();
    setStatus({
      tone: "idle",
      text: `会先创建临时登录目录，登录成功后检测 ${credentialLabel} 并保存到账号列表。`
    });
    setIsOpen(true);
  }, [clearSession, credentialLabel, isOpen]);

  const start = useCallback(async () => {
    if (session || operationInFlightRef.current) {
      return;
    }
    operationInFlightRef.current = "starting";
    setIsStarting(true);
    setStatus({ tone: "idle", text: "正在打开独立 PowerShell 登录窗口..." });
    try {
      const nextSession = await getApi().startOAuthLogin(options.selectedTool);
      setSession(nextSession);
      setInspection(undefined);
      setProfileNameDraft("");
      setNicknameDraft("");
      setStatus({ tone: "success", text: "登录窗口已打开。完成浏览器登录后会自动检测账号。" });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      operationInFlightRef.current = undefined;
      setIsStarting(false);
    }
  }, [options.selectedTool, session]);

  const inspect = useCallback(async () => {
    if (!session) {
      setStatus({ tone: "error", text: "请先打开登录窗口。" });
      return;
    }
    if (inspectionInFlightRef.current) {
      setStatus({ tone: "idle", text: `正在自动检测 ${credentialLabel}...` });
      return;
    }
    if (operationInFlightRef.current) {
      return;
    }

    operationInFlightRef.current = "inspecting";
    setIsInspecting(true);
    setStatus({ tone: "idle", text: `正在检测 ${credentialLabel}...` });
    try {
      const nextInspection = await requestInspection(session.sessionId);
      if (!nextInspection) {
        return;
      }
      if (!nextInspection.oauthExists) {
        setStatus({ tone: "idle", text: `还没有检测到 ${credentialLabel}。请先在登录窗口完成登录。` });
        return;
      }
      applyInspection(nextInspection);
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      operationInFlightRef.current = undefined;
      setIsInspecting(false);
    }
  }, [applyInspection, credentialLabel, requestInspection, session]);

  const save = useCallback(async () => {
    if (!session) {
      setStatus({ tone: "error", text: "请先打开登录窗口。" });
      return;
    }
    if (isAccountActionBlockedRef.current()) {
      setStatus({ tone: "idle", text: "账号操作完成后再保存新增登录。" });
      return;
    }
    const profileName = profileNameDraft.trim();
    if (!profileName) {
      setStatus({ tone: "error", text: "请填写保存名称。" });
      return;
    }
    if (operationInFlightRef.current) {
      return;
    }

    operationInFlightRef.current = "saving";
    setIsSaving(true);
    setStatus({ tone: "idle", text: "正在保存到账号列表..." });
    try {
      const saved = await getApi().saveOAuthLogin({
        sessionId: session.sessionId,
        profileName,
        nickname: nicknameDraft.trim()
      });
      clearSession();
      setIsOpen(false);
      onSavedRef.current(saved);
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      operationInFlightRef.current = undefined;
      setIsSaving(false);
    }
  }, [clearSession, nicknameDraft, profileNameDraft, session]);

  const close = useCallback(async () => {
    if (operationInFlightRef.current) {
      return;
    }
    if (!session) {
      clearSession();
      setIsOpen(false);
      return;
    }

    operationInFlightRef.current = "cancelling";
    setIsCancelling(true);
    setStatus({ tone: "idle", text: "正在清理临时登录目录..." });
    try {
      await getApi().cancelOAuthLogin({
        sessionId: session.sessionId,
        pendingProfilePath: session.pendingProfilePath
      });
      clearSession();
      setIsOpen(false);
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      operationInFlightRef.current = undefined;
      setIsCancelling(false);
    }
  }, [clearSession, session]);

  const onBackdropClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) {
      void close();
    }
  }, [close]);

  return {
    isOpen,
    open,
    dialogProps: {
      selectedTool: options.selectedTool,
      profilesRoot: options.profilesRoot,
      session,
      inspection,
      existingProfileNames: options.existingProfileNames,
      status,
      profileNameDraft,
      nicknameDraft,
      isStarting,
      isInspecting,
      isSaving,
      isCancelling,
      onStart: start,
      onInspect: inspect,
      onProfileNameChange: setProfileNameDraft,
      onNicknameChange: setNicknameDraft,
      onSave: save,
      onClose: close,
      onBackdropClick
    }
  };
}
