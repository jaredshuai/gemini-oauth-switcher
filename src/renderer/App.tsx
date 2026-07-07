import { Activity, ChevronDown, ChevronUp, Clock, Copy, FolderOpen, Pencil, Plus, RefreshCw, Settings, Shuffle, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type {
  AppSettings,
  LastSwitchResult,
  LocalDiagnosticsResult,
  OAuthLoginInspectResult,
  OAuthLoginSession,
  ProfileInfo,
  ProfileListResult,
  ProfileUsageResult,
  RevealTarget,
  TargetTool,
  TrayBehavior,
  UsageTier
} from "../shared/types";

type StatusTone = "idle" | "success" | "error";
type StatusVisibility = "visible" | "fading" | "collapsed";

interface StatusMessage {
  tone: StatusTone;
  text: string;
  autoFade?: boolean;
}

const TOOL_LABELS: Record<
  TargetTool,
  {
    name: string;
    shortName: string;
    targetLabel: string;
    fileLabel: string;
    missingLabel: string;
    command: string;
    targetPathFallback: string;
    targetReveal: RevealTarget;
  }
> = {
  gemini: {
    name: "Gemini CLI",
    shortName: "Gemini",
    targetLabel: "目标 OAuth",
    fileLabel: "OAuth",
    missingLabel: "缺 OAuth",
    command: "gemini",
    targetPathFallback: "C:\\Users\\<current-user>\\.gemini\\oauth_creds.json",
    targetReveal: "targetGeminiDir"
  },
  "antigravity-cli": {
    name: "Antigravity CLI",
    shortName: "Antigravity",
    targetLabel: "目标凭据",
    fileLabel: "凭据",
    missingLabel: "缺凭据",
    command: "agy",
    targetPathFallback: "Windows Credential Manager: gemini:antigravity",
    targetReveal: "targetAntigravityCliDir"
  }
};

const emptyResult: ProfileListResult = {
  profilesRoot: "",
  targetGeminiDir: "",
  targetOAuthPath: "",
  profiles: []
};

export function App() {
  const [settings, setSettings] = useState<AppSettings>({ profilesRoot: "" });
  const [profilesRootDraft, setProfilesRootDraft] = useState("");
  const [trayBehaviorDraft, setTrayBehaviorDraft] = useState<TrayBehavior>("exit");
  const [autoUpdateEnabledDraft, setAutoUpdateEnabledDraft] = useState(true);
  const [selectedTool, setSelectedTool] = useState<TargetTool>("gemini");
  const [result, setResult] = useState<ProfileListResult>(emptyResult);
  const [status, setStatus] = useState<StatusMessage>({
    tone: "idle",
    text: "默认扫描当前用户 home 下的 .gemini-homes。"
  });
  const [isLoading, setIsLoading] = useState(true);
  const [switchingProfile, setSwitchingProfile] = useState<string | undefined>();
  const [deletingProfile, setDeletingProfile] = useState<string | undefined>();
  const [usageByProfile, setUsageByProfile] = useState<Record<string, ProfileUsageResult>>({});
  const [localDiagnostics, setLocalDiagnostics] = useState<LocalDiagnosticsResult | undefined>();
  const [refreshingUsageProfiles, setRefreshingUsageProfiles] = useState<Set<string>>(() => new Set());
  const [isRefreshingAllUsage, setIsRefreshingAllUsage] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSavingTrayBehavior, setIsSavingTrayBehavior] = useState(false);
  const [isSavingAutoUpdate, setIsSavingAutoUpdate] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<StatusMessage | undefined>();
  const [nicknameEditorProfile, setNicknameEditorProfile] = useState<ProfileInfo | undefined>();
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [isSavingNickname, setIsSavingNickname] = useState(false);
  const [isOAuthLoginOpen, setIsOAuthLoginOpen] = useState(false);
  const [oauthLoginSession, setOAuthLoginSession] = useState<OAuthLoginSession | undefined>();
  const [oauthLoginInspection, setOAuthLoginInspection] = useState<OAuthLoginInspectResult | undefined>();
  const [oauthLoginStatus, setOAuthLoginStatus] = useState<StatusMessage>({
    tone: "idle",
    text: "会先创建临时登录目录，登录成功后自动识别账号。"
  });
  const [oauthProfileNameDraft, setOAuthProfileNameDraft] = useState("");
  const [oauthNicknameDraft, setOAuthNicknameDraft] = useState("");
  const [isStartingOAuthLogin, setIsStartingOAuthLogin] = useState(false);
  const [isInspectingOAuthLogin, setIsInspectingOAuthLogin] = useState(false);
  const [isSavingOAuthLogin, setIsSavingOAuthLogin] = useState(false);
  const [isCancellingOAuthLogin, setIsCancellingOAuthLogin] = useState(false);
  const [statusVisibility, setStatusVisibility] = useState<StatusVisibility>("visible");
  const [, setRelativeTimeTick] = useState(0);
  const profileActionInFlightRef = useRef(false);
  const settingsActionInFlightRef = useRef(false);
  const loadProfilesRequestIdRef = useRef(0);
  const refreshingUsageProfilesRef = useRef<Set<string>>(new Set());
  const isRefreshingAllUsageRef = useRef(false);

  const currentProfile = useMemo(
    () => result.profiles.find((profile) => profile.isCurrent),
    [result.profiles]
  );
  const profileNicknames = settings.profileNicknames ?? {};
  const currentProfileDisplayName = currentProfile ? getProfileDisplayName(currentProfile, profileNicknames) : undefined;
  const toolLabels = TOOL_LABELS[selectedTool];
  const isGeminiTool = selectedTool === "gemini";
  const loginCredentialLabel = isGeminiTool ? "OAuth 文件" : "登录凭据";
  const visibleLastSwitch =
    settings.lastSwitch && (settings.lastSwitch.targetTool ?? "gemini") === selectedTool ? settings.lastSwitch : undefined;

  const loadProfiles = useCallback(async (targetTool: TargetTool): Promise<ProfileListResult | undefined> => {
    const requestId = loadProfilesRequestIdRef.current + 1;
    loadProfilesRequestIdRef.current = requestId;
    setIsLoading(true);
    try {
      const nextResult = await getApi().listProfiles(targetTool);
      if (requestId !== loadProfilesRequestIdRef.current) {
        return undefined;
      }
      setResult(nextResult);
      setStatus({
        tone: "idle",
        text: nextResult.profilesRoot
          ? `已找到 ${nextResult.profiles.length} 个账号目录。`
          : "默认扫描当前用户 home 下的 .gemini-homes。",
        autoFade: Boolean(nextResult.profilesRoot)
      });
      return nextResult;
    } catch (error) {
      if (requestId === loadProfilesRequestIdRef.current) {
        setStatus({ tone: "error", text: getErrorMessage(error) });
      }
      return undefined;
    } finally {
      if (requestId === loadProfilesRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        const [nextSettings, diagnostics] = await Promise.all([
          getApi().getSettings(),
          getApi()
            .getLocalDiagnostics()
            .catch(() => undefined)
        ]);
        if (!mounted) {
          return;
        }

        setSettings(nextSettings);
        const nextSelectedTool = nextSettings.selectedTool ?? "gemini";
        setSelectedTool(nextSelectedTool);
        setLocalDiagnostics(diagnostics);
        setProfilesRootDraft(nextSettings.profilesRoot);
        setTrayBehaviorDraft(nextSettings.trayBehavior ?? "exit");
        setAutoUpdateEnabledDraft(nextSettings.autoUpdateEnabled !== false);
        await loadProfiles(nextSelectedTool);
      } catch (error) {
        if (mounted) {
          setStatus({ tone: "error", text: getErrorMessage(error) });
          setIsLoading(false);
        }
      }
    }

    void boot();
    return () => {
      mounted = false;
    };
  }, [loadProfiles]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRelativeTimeTick((tick) => tick + 1);
    }, 60_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isOAuthLoginOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        void closeOAuthLoginDialog();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOAuthLoginOpen, oauthLoginSession, isStartingOAuthLogin, isInspectingOAuthLogin, isSavingOAuthLogin, isCancellingOAuthLogin]);

  useEffect(() => {
    setStatusVisibility("visible");

    if (status.tone !== "success" && !status.autoFade) {
      return;
    }

    const fadeTimer = window.setTimeout(() => {
      setStatusVisibility("fading");
    }, 4_500);
    const collapseTimer = window.setTimeout(() => {
      setStatusVisibility("collapsed");
    }, 5_300);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(collapseTimer);
    };
  }, [status]);

  async function saveProfilesRoot() {
    if (profileActionInFlightRef.current || settingsActionInFlightRef.current) {
      setSettingsStatus({ tone: "idle", text: "账号操作完成后再保存账号目录。" });
      return;
    }

    settingsActionInFlightRef.current = true;
    const profilesRoot = profilesRootDraft.trim();
    setIsSavingSettings(true);
    setSettingsStatus({ tone: "idle", text: "正在保存并扫描账号目录..." });
    try {
      const nextSettings = await getApi().saveSettings({ profilesRoot, trayBehavior: trayBehaviorDraft, selectedTool });
      setSettings(nextSettings);
      setProfilesRootDraft(nextSettings.profilesRoot);
      setTrayBehaviorDraft(nextSettings.trayBehavior ?? "exit");
      setAutoUpdateEnabledDraft(nextSettings.autoUpdateEnabled !== false);
      setUsageByProfile({});
      const nextResult = await loadProfiles(selectedTool);
      if (nextResult) {
        setSettingsStatus({ tone: "success", text: `已保存，找到 ${nextResult.profiles.length} 个账号目录。` });
      } else {
        setSettingsStatus({ tone: "idle", text: "路径已保存，账号列表正在刷新。" });
      }
    } catch (error) {
      const message = getErrorMessage(error);
      setStatus({ tone: "error", text: message });
      setSettingsStatus({ tone: "error", text: message });
    } finally {
      setIsSavingSettings(false);
      settingsActionInFlightRef.current = false;
    }
  }

  async function selectTargetTool(targetTool: TargetTool) {
    if (targetTool === selectedTool) {
      return;
    }
    if (profileActionInFlightRef.current || settingsActionInFlightRef.current) {
      setStatus({ tone: "idle", text: "账号操作完成后再切换目标工具。" });
      return;
    }

    settingsActionInFlightRef.current = true;
    const previousTool = selectedTool;
    setSelectedTool(targetTool);
    setResult(emptyResult);
    setUsageByProfile({});
    setStatus({ tone: "idle", text: `正在切换到 ${TOOL_LABELS[targetTool].name}...` });
    try {
      const nextSettings = await getApi().saveSettings({ selectedTool: targetTool });
      setSettings(nextSettings);
      await loadProfiles(targetTool);
    } catch (error) {
      setSelectedTool(previousTool);
      setStatus({ tone: "error", text: getErrorMessage(error) });
      await loadProfiles(previousTool);
    } finally {
      settingsActionInFlightRef.current = false;
    }
  }

  async function saveTrayBehavior(nextBehavior: TrayBehavior) {
    if (profileActionInFlightRef.current || settingsActionInFlightRef.current) {
      setSettingsStatus({ tone: "idle", text: "账号操作完成后再修改关闭行为。" });
      return;
    }

    const previousBehavior = settings.trayBehavior ?? "exit";
    setTrayBehaviorDraft(nextBehavior);
    setIsSavingTrayBehavior(true);

    try {
      const nextSettings = await getApi().saveSettings({ trayBehavior: nextBehavior });
      setSettings(nextSettings);
      setTrayBehaviorDraft(nextSettings.trayBehavior ?? "exit");
    } catch (error) {
      const message = getErrorMessage(error);
      setTrayBehaviorDraft(previousBehavior);
      setStatus({ tone: "error", text: message });
      setSettingsStatus({ tone: "error", text: message });
    } finally {
      setIsSavingTrayBehavior(false);
    }
  }

  async function saveAutoUpdateEnabled(enabled: boolean) {
    if (profileActionInFlightRef.current || settingsActionInFlightRef.current) {
      setSettingsStatus({ tone: "idle", text: "账号操作完成后再修改更新设置。" });
      return;
    }

    const previousValue = settings.autoUpdateEnabled !== false;
    setAutoUpdateEnabledDraft(enabled);
    setIsSavingAutoUpdate(true);

    try {
      const nextSettings = await getApi().saveSettings({ autoUpdateEnabled: enabled });
      setSettings(nextSettings);
      setAutoUpdateEnabledDraft(nextSettings.autoUpdateEnabled !== false);
    } catch (error) {
      const message = getErrorMessage(error);
      setAutoUpdateEnabledDraft(previousValue);
      setStatus({ tone: "error", text: message });
      setSettingsStatus({ tone: "error", text: message });
    } finally {
      setIsSavingAutoUpdate(false);
    }
  }

  async function switchToProfile(profile: ProfileInfo) {
    if (profileActionInFlightRef.current || settingsActionInFlightRef.current) {
      return;
    }

    profileActionInFlightRef.current = true;
    setSwitchingProfile(profile.name);
    try {
      await getApi().switchProfile(profile.name, selectedTool);
      const nextSettings = await getApi().getSettings();
      setSettings(nextSettings);
      await loadProfiles(selectedTool);
      const displayName = getProfileDisplayName(profile, nextSettings.profileNicknames ?? {});
      setStatus({
        tone: "success",
        text: `已切换为 ${displayName}。可以关闭窗口；新开 PowerShell 后运行 ${toolLabels.command} 会使用这个${toolLabels.fileLabel}。`
      });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setSwitchingProfile(undefined);
      profileActionInFlightRef.current = false;
    }
  }

  async function deleteProfile(profile: ProfileInfo) {
    if (!isGeminiTool) {
      setStatus({ tone: "error", text: "Antigravity CLI 模式不会删除共享 profile 目录。" });
      return;
    }
    if (profile.isCurrent) {
      setStatus({ tone: "error", text: "不能删除当前正在使用的账号。请先切换到其他账号。" });
      return;
    }

    const confirmed = window.confirm(`删除 profile「${profile.name}」？\n\n会把这个目录移到 Windows 回收站：\n${profile.profilePath}`);
    if (!confirmed) {
      return;
    }
    if (profileActionInFlightRef.current || settingsActionInFlightRef.current) {
      return;
    }

    profileActionInFlightRef.current = true;
    setDeletingProfile(profile.name);
    try {
      await getApi().deleteProfile(profile.name);
      const nextNicknames = { ...profileNicknames };
      delete nextNicknames[profile.name];
      const nextSettings = await getApi().saveSettings({ profileNicknames: nextNicknames });
      setSettings(nextSettings);
      setUsageByProfile((current) => {
        const next = { ...current };
        delete next[profile.name];
        return next;
      });
      await loadProfiles(selectedTool);
      setStatus({ tone: "success", text: `已将 ${profile.name} 移到回收站。` });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setDeletingProfile(undefined);
      profileActionInFlightRef.current = false;
    }
  }

  async function copyProfileName(profileName: string) {
    try {
      await copyText(profileName);
      setStatus({ tone: "success", text: `已复制完整 profile 名称：${profileName}` });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    }
  }

  function openProfileNicknameEditor(profile: ProfileInfo) {
    setNicknameEditorProfile(profile);
    setNicknameDraft(profileNicknames[profile.name] ?? "");
  }

  async function saveProfileNickname() {
    if (!nicknameEditorProfile) {
      return;
    }
    if (profileActionInFlightRef.current || settingsActionInFlightRef.current) {
      setStatus({ tone: "idle", text: "账号操作完成后再修改昵称。" });
      return;
    }

    const profile = nicknameEditorProfile;
    const trimmed = nicknameDraft.trim();
    const nextNicknames = { ...profileNicknames };
    if (trimmed) {
      nextNicknames[profile.name] = trimmed;
    } else {
      delete nextNicknames[profile.name];
    }

    setIsSavingNickname(true);
    try {
      const nextSettings = await getApi().saveSettings({ profileNicknames: nextNicknames });
      setSettings(nextSettings);
      setNicknameEditorProfile(undefined);
      setStatus({
        tone: "success",
        text: trimmed ? `已将 ${profile.name} 显示为「${trimmed}」。` : `已恢复 ${profile.name} 的目录名显示。`
      });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setIsSavingNickname(false);
    }
  }

  function openOAuthLoginDialog() {
    setOAuthLoginSession(undefined);
    setOAuthLoginInspection(undefined);
    setOAuthProfileNameDraft("");
    setOAuthNicknameDraft("");
    setOAuthLoginStatus({
      tone: "idle",
      text: `会先创建临时登录目录，登录成功后检测 ${loginCredentialLabel} 并保存到账号列表。`
    });
    setIsOAuthLoginOpen(true);
  }

  async function startOAuthLogin() {
    setIsStartingOAuthLogin(true);
    setOAuthLoginStatus({ tone: "idle", text: "正在打开独立 PowerShell 登录窗口..." });
    try {
      const session = await getApi().startOAuthLogin(selectedTool);
      setOAuthLoginSession(session);
      setOAuthLoginInspection(undefined);
      setOAuthProfileNameDraft("");
      setOAuthNicknameDraft("");
      setOAuthLoginStatus({ tone: "success", text: "登录窗口已打开。完成浏览器登录后，回到这里点击重新检测。" });
    } catch (error) {
      setOAuthLoginStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setIsStartingOAuthLogin(false);
    }
  }

  async function inspectOAuthLogin() {
    if (!oauthLoginSession) {
      setOAuthLoginStatus({ tone: "error", text: "请先打开登录窗口。" });
      return;
    }

    setIsInspectingOAuthLogin(true);
    setOAuthLoginStatus({ tone: "idle", text: `正在检测 ${loginCredentialLabel}...` });
    try {
      const inspection = await getApi().inspectOAuthLogin(oauthLoginSession.sessionId);
      setOAuthLoginInspection(inspection);
      if (!inspection.oauthExists) {
        setOAuthLoginStatus({ tone: "idle", text: `还没有检测到 ${loginCredentialLabel}。请先在登录窗口完成登录。` });
        return;
      }

      setOAuthProfileNameDraft(inspection.proposedProfileName ?? "");
      setOAuthNicknameDraft(inspection.proposedNickname ?? "");
      if (inspection.conflictProfileName) {
        setOAuthLoginStatus({
          tone: "error",
          text: `账号已存在：${inspection.conflictProfileName}。请不要重复新增，或手动改成新的保存名称。`
        });
        return;
      }
      setOAuthLoginStatus({
        tone: "success",
        text: inspection.accountEmail
          ? `已识别到账号 ${inspection.accountEmail}。`
          : `已检测到 ${loginCredentialLabel}，但没有识别出邮箱。请手动填写保存名称。`
      });
    } catch (error) {
      setOAuthLoginStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setIsInspectingOAuthLogin(false);
    }
  }

  async function saveOAuthLogin() {
    if (!oauthLoginSession) {
      setOAuthLoginStatus({ tone: "error", text: "请先打开登录窗口。" });
      return;
    }
    if (profileActionInFlightRef.current || settingsActionInFlightRef.current) {
      setOAuthLoginStatus({ tone: "idle", text: "账号操作完成后再保存新增登录。" });
      return;
    }

    const profileName = oauthProfileNameDraft.trim();
    if (!profileName) {
      setOAuthLoginStatus({ tone: "error", text: "请填写保存名称。" });
      return;
    }

    setIsSavingOAuthLogin(true);
    setOAuthLoginStatus({ tone: "idle", text: "正在保存到账号列表..." });
    try {
      const saved = await getApi().saveOAuthLogin({
        sessionId: oauthLoginSession.sessionId,
        profileName,
        nickname: oauthNicknameDraft.trim()
      });
      const nextSettings = await getApi().getSettings();
      setSettings(nextSettings);
      setUsageByProfile({});
      await loadProfiles(selectedTool);
      setIsOAuthLoginOpen(false);
      setOAuthLoginSession(undefined);
      setOAuthLoginInspection(undefined);
      setOAuthProfileNameDraft("");
      setOAuthNicknameDraft("");
      setStatus({ tone: "success", text: `已新增登录账号 ${saved.nickname || saved.profileName}。` });
    } catch (error) {
      setOAuthLoginStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setIsSavingOAuthLogin(false);
    }
  }

  async function closeOAuthLoginDialog() {
    if (isStartingOAuthLogin || isInspectingOAuthLogin || isSavingOAuthLogin || isCancellingOAuthLogin) {
      return;
    }

    const session = oauthLoginSession;

    if (!session) {
      setIsOAuthLoginOpen(false);
      setOAuthLoginSession(undefined);
      setOAuthLoginInspection(undefined);
      setOAuthProfileNameDraft("");
      setOAuthNicknameDraft("");
      return;
    }

    setIsCancellingOAuthLogin(true);
    setOAuthLoginStatus({ tone: "idle", text: "正在清理临时登录目录..." });
    try {
      await getApi().cancelOAuthLogin({
        sessionId: session.sessionId,
        pendingProfilePath: session.pendingProfilePath
      });
      setIsOAuthLoginOpen(false);
      setOAuthLoginSession(undefined);
      setOAuthLoginInspection(undefined);
      setOAuthProfileNameDraft("");
      setOAuthNicknameDraft("");
    } catch (error) {
      setOAuthLoginStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setIsCancellingOAuthLogin(false);
    }
  }

  function onOAuthLoginBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.currentTarget === event.target) {
      void closeOAuthLoginDialog();
    }
  }

  async function refreshUsage(profileName: string) {
    if (!isGeminiTool) {
      return;
    }
    if (isRefreshingAllUsageRef.current || refreshingUsageProfilesRef.current.has(profileName)) {
      return;
    }

    refreshingUsageProfilesRef.current.add(profileName);
    setRefreshingUsageProfiles((current) => {
      const next = new Set(current);
      next.add(profileName);
      return next;
    });
    try {
      const usage = await getApi().refreshProfileUsage(profileName);
      setUsageByProfile((current) => ({ ...current, [profileName]: usage }));
      setStatus({
        tone: usage.success ? "success" : "error",
        text: usage.success ? `已查询 ${profileName} 的用量。` : `${profileName} 用量查询失败：${describeUsageFailure(usage)}`
      });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      refreshingUsageProfilesRef.current.delete(profileName);
      setRefreshingUsageProfiles((current) => {
        const next = new Set(current);
        next.delete(profileName);
        return next;
      });
    }
  }

  async function refreshAllUsage() {
    if (!isGeminiTool) {
      return;
    }
    if (isRefreshingAllUsageRef.current || refreshingUsageProfilesRef.current.size > 0) {
      return;
    }

    isRefreshingAllUsageRef.current = true;
    setIsRefreshingAllUsage(true);
    try {
      const usages = await getApi().refreshAllUsage();
      const values = Object.values(usages);
      const successCount = values.filter((usage) => usage.success).length;
      const failedCount = values.filter((usage) => usage.credentialStatus !== "not_found" && !usage.success).length;

      setUsageByProfile(usages);
      setStatus({
        tone: failedCount > 0 ? "error" : "success",
        text:
          failedCount > 0
            ? `用量查询完成：成功 ${successCount} 个，失败 ${failedCount} 个。`
            : `已查询 ${successCount} 个账号的用量。`
      });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setIsRefreshingAllUsage(false);
      isRefreshingAllUsageRef.current = false;
    }
  }

  async function reveal(target: RevealTarget) {
    try {
      await getApi().revealPath(target);
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    }
  }

  async function selectProfilesRoot() {
    if (profileActionInFlightRef.current || settingsActionInFlightRef.current) {
      setSettingsStatus({ tone: "idle", text: "账号操作完成后再选择账号目录。" });
      return;
    }

    try {
      const selectedPath = await getApi().selectDirectory(profilesRootDraft || settings.profilesRoot);
      if (selectedPath) {
        setProfilesRootDraft(selectedPath);
      }
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    }
  }

  const isProfileActionBusy = Boolean(switchingProfile || deletingProfile);
  const hasRefreshingUsageProfiles = refreshingUsageProfiles.size > 0;
  const isUsageRefreshBusy = isRefreshingAllUsage || hasRefreshingUsageProfiles;
  const isToolSwitchDisabled = isLoading || isProfileActionBusy || isSavingSettings || isUsageRefreshBusy;

  return (
    <main className="min-h-screen bg-[#f7f3ea] text-neutral-950">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 pb-6 pt-5">
        <header className="flex items-center justify-between gap-4 border-b border-neutral-300/80 pb-3">
          <h1 className="flex shrink-0 items-center gap-1.5 text-xl font-semibold text-neutral-950">
            <TargetToolSwitch selectedTool={selectedTool} disabled={isToolSwitchDisabled} onChange={selectTargetTool} />
            <span className="font-normal text-neutral-400">OAuth Switcher</span>
          </h1>

          <div className="flex items-center gap-2">
              <button
                className="tool-button"
                onClick={() => void loadProfiles(selectedTool)}
                disabled={isLoading || isProfileActionBusy || isSavingSettings}
                title="重新扫描账号列表"
              >
                <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                刷新列表
              </button>
              {isGeminiTool ? (
                <button
                  className="tool-button"
                  onClick={refreshAllUsage}
                  disabled={isUsageRefreshBusy || isLoading || result.profiles.length === 0}
                  title="查询所有账号的 Gemini 用量"
                >
                  <Activity className={isRefreshingAllUsage ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
                  查询用量
                </button>
              ) : null}
              <button className="tool-button" onClick={openOAuthLoginDialog} title={`登录一个新的 ${toolLabels.name} profile`}>
                <Plus className="h-4 w-4" />
                新增登录
              </button>
              <button
                className="tool-button"
                onClick={() => {
                  setSettingsStatus(undefined);
                  setTrayBehaviorDraft(settings.trayBehavior ?? "exit");
                  setAutoUpdateEnabledDraft(settings.autoUpdateEnabled !== false);
                  setIsSettingsOpen(true);
                }}
                title="打开设置"
              >
                <Settings className="h-4 w-4" />
                设置
              </button>
          </div>
        </header>

        <CurrentAccountPanel
          selectedTool={selectedTool}
          currentProfile={currentProfile}
          displayName={currentProfileDisplayName}
          hasUnmatchedTarget={Boolean(result.targetHash && !currentProfile)}
          hasTargetOAuth={Boolean(result.targetHash)}
          lastSwitch={visibleLastSwitch}
          localDiagnostics={localDiagnostics}
        />

        <StatusBar status={status} visibility={statusVisibility} />

        <section className="mt-4 overflow-hidden rounded-md border border-neutral-300 bg-white shadow-sm">
          <div className="grid grid-cols-[minmax(260px,1fr)_320px_156px] items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-5 py-3 font-mono text-xs text-neutral-500">
            <span>账号</span>
            <span>{isGeminiTool ? "用量" : "登录凭据"}</span>
            <span className="w-[6.5rem] text-left">操作</span>
          </div>

          {result.profiles.length > 0 ? (
            <div className="divide-y divide-neutral-200">
              {result.profiles.map((profile) => (
                <ProfileRow
                  key={profile.name}
                  selectedTool={selectedTool}
                  profile={profile}
                  isSwitching={switchingProfile === profile.name}
                  isDeleting={deletingProfile === profile.name}
                  isSwitchDisabled={isProfileActionBusy || isSavingSettings}
                  isDeleteDisabled={isProfileActionBusy || isSavingSettings}
                  usage={usageByProfile[profile.name]}
                  nickname={profileNicknames[profile.name]}
                  isRefreshingUsage={refreshingUsageProfiles.has(profile.name) || isRefreshingAllUsage}
                  onSwitch={() => switchToProfile(profile)}
                  onDelete={() => deleteProfile(profile)}
                  onCopyName={() => copyProfileName(profile.name)}
                  onSetNickname={() => openProfileNicknameEditor(profile)}
                  onRefreshUsage={() => refreshUsage(profile.name)}
                />
              ))}
            </div>
          ) : (
            <div className="px-4 py-12 text-center text-sm text-neutral-500">
              {isLoading ? "正在扫描 profile..." : "还没有可显示的 profile。"}
            </div>
          )}
        </section>

        {isSettingsOpen ? (
          <SettingsDialog
            profilesRootDraft={profilesRootDraft}
            selectedTool={selectedTool}
            targetOAuthPath={result.targetOAuthPath || toolLabels.targetPathFallback}
            targetGeminiDir={result.targetGeminiDir}
            profilesRoot={settings.profilesRoot}
            trayBehavior={trayBehaviorDraft}
            autoUpdateEnabled={autoUpdateEnabledDraft}
            isSaving={isSavingSettings}
            isSavingTrayBehavior={isSavingTrayBehavior}
            isSavingAutoUpdate={isSavingAutoUpdate}
            status={settingsStatus}
            onProfilesRootChange={setProfilesRootDraft}
            onTrayBehaviorChange={saveTrayBehavior}
            onAutoUpdateEnabledChange={saveAutoUpdateEnabled}
            onSelectProfilesRoot={selectProfilesRoot}
            onSave={saveProfilesRoot}
            onReveal={reveal}
            onClose={() => setIsSettingsOpen(false)}
          />
        ) : null}

        {isOAuthLoginOpen ? (
          <OAuthLoginDialog
            selectedTool={selectedTool}
            profilesRoot={result.profilesRoot || settings.profilesRoot}
            session={oauthLoginSession}
            inspection={oauthLoginInspection}
            existingProfileNames={result.profiles.map((profile) => profile.name)}
            status={oauthLoginStatus}
            profileNameDraft={oauthProfileNameDraft}
            nicknameDraft={oauthNicknameDraft}
            isStarting={isStartingOAuthLogin}
            isInspecting={isInspectingOAuthLogin}
            isSaving={isSavingOAuthLogin}
            isCancelling={isCancellingOAuthLogin}
            onStart={startOAuthLogin}
            onInspect={inspectOAuthLogin}
            onProfileNameChange={setOAuthProfileNameDraft}
            onNicknameChange={setOAuthNicknameDraft}
            onSave={saveOAuthLogin}
            onClose={closeOAuthLoginDialog}
            onBackdropClick={onOAuthLoginBackdropClick}
          />
        ) : null}

        {nicknameEditorProfile ? (
          <NicknameDialog
            profile={nicknameEditorProfile}
            value={nicknameDraft}
            isSaving={isSavingNickname}
            onChange={setNicknameDraft}
            onSave={saveProfileNickname}
            onClose={() => setNicknameEditorProfile(undefined)}
          />
        ) : null}
      </div>
    </main>
  );
}

function TargetToolSwitch({
  selectedTool,
  disabled,
  onChange
}: {
  selectedTool: TargetTool;
  disabled: boolean;
  onChange: (targetTool: TargetTool) => void | Promise<void>;
}) {
  const tools: TargetTool[] = ["gemini", "antigravity-cli"];
  const currentIndex = tools.indexOf(selectedTool);
  const prevTool = tools[(currentIndex - 1 + tools.length) % tools.length];
  const nextTool = tools[(currentIndex + 1) % tools.length];

  return (
    <div className="flex items-center gap-1" aria-label="切换目标工具">
      <div className="flex flex-col">
        <button
          className="copy-icon-button h-4"
          onClick={() => void onChange(prevTool)}
          disabled={disabled}
          title={`切换到 ${TOOL_LABELS[prevTool].name}`}
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          className="copy-icon-button h-4"
          onClick={() => void onChange(nextTool)}
          disabled={disabled}
          title={`切换到 ${TOOL_LABELS[nextTool].name}`}
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
      <span>{TOOL_LABELS[selectedTool].shortName}</span>
    </div>
  );
}

function CurrentAccountPanel({
  selectedTool,
  currentProfile,
  displayName,
  hasUnmatchedTarget,
  hasTargetOAuth,
  lastSwitch,
  localDiagnostics
}: {
  selectedTool: TargetTool;
  currentProfile?: ProfileInfo;
  displayName?: string;
  hasUnmatchedTarget: boolean;
  hasTargetOAuth: boolean;
  lastSwitch?: LastSwitchResult;
  localDiagnostics?: LocalDiagnosticsResult;
}) {
  const toolLabels = TOOL_LABELS[selectedTool];
  const validationText = currentProfile
    ? `${toolLabels.targetLabel} 已与该 profile 匹配`
    : hasUnmatchedTarget
      ? `${toolLabels.targetLabel} 存在，但不属于账号列表`
      : `${toolLabels.targetLabel} 未设置`;
  const nextStepText = currentProfile ? `新开 PowerShell 后运行 ${toolLabels.command} 即使用该${toolLabels.fileLabel}` : "从下方列表选择账号并点击切换";

  return (
    <section className="py-3.5">
      <aside className="rounded-md border border-neutral-900/80 bg-neutral-950 px-6 py-4 text-sm text-neutral-100 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[minmax(360px,0.62fr)_minmax(420px,1fr)] md:items-center">
          <div className="min-w-0 md:py-1">
            {currentProfile ? (
              <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                当前生效
              </div>
            ) : (
              <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
                <TriangleAlert className="h-4 w-4" />
                当前生效
              </div>
            )}
            {currentProfile ? (
              <>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className="min-w-0 truncate font-mono text-[28px] font-semibold leading-tight text-white"
                    title={displayName ?? currentProfile.name}
                  >
                    {displayName ?? currentProfile.name}
                  </span>
                  <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                    已生效
                  </span>
                </div>
                {displayName !== currentProfile.name ? (
                  <div className="mt-1 truncate font-mono text-xs text-neutral-400" title={currentProfile.name}>
                    目录名：{currentProfile.name}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="mt-3 font-mono text-[24px] font-semibold leading-tight text-amber-100">
                {hasUnmatchedTarget ? "未匹配到账号" : "未设置账号"}
              </div>
            )}
            <div className="mt-3.5 flex items-center gap-2 text-sm font-semibold text-neutral-200">
              <span className={currentProfile ? "text-emerald-400" : "text-amber-300"}>{currentProfile ? "✓" : "!"}</span>
              {validationText}
            </div>
            <div className="mt-2 flex items-center gap-2 font-mono text-xs text-neutral-500">
              <span>&gt;_</span>
              <span>{nextStepText}</span>
            </div>
          </div>

          <SwitchReceiptPanel
            selectedTool={selectedTool}
            currentProfile={currentProfile}
            displayName={displayName}
            hasTargetOAuth={hasTargetOAuth}
            lastSwitch={lastSwitch}
            localDiagnostics={localDiagnostics}
          />
        </div>
      </aside>
    </section>
  );
}

function SwitchReceiptPanel({
  selectedTool,
  currentProfile,
  displayName,
  hasTargetOAuth,
  lastSwitch,
  localDiagnostics
}: {
  selectedTool: TargetTool;
  currentProfile?: ProfileInfo;
  displayName?: string;
  hasTargetOAuth: boolean;
  lastSwitch?: LastSwitchResult;
  localDiagnostics?: LocalDiagnosticsResult;
}) {
  const toolLabels = TOOL_LABELS[selectedTool];
  const lastSwitchName = lastSwitch
    ? lastSwitch.profileName === currentProfile?.name
      ? displayName ?? currentProfile.name
      : lastSwitch.profileName
    : undefined;
  const targetStatus = currentProfile
    ? `${toolLabels.targetLabel} 属于账号列表`
    : hasTargetOAuth
      ? `${toolLabels.targetLabel} 不属于账号列表`
      : `${toolLabels.targetLabel} 不存在`;
  const envRisks = localDiagnostics?.envRisks ?? [];

  return (
    <div className="min-w-0 border-neutral-800/70 md:border-l md:py-1 md:pl-6">
      <div className="flex items-center gap-2 font-mono text-[13px] font-semibold text-neutral-200">
        <Shuffle className="h-3.5 w-3.5 text-neutral-500" />
        切换回执
      </div>

      <div className="mt-2.5 rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2">
        <div className="text-xs font-semibold text-emerald-200">
          {lastSwitch && lastSwitchName ? `${formatSwitchRelativeTime(lastSwitch.switchedAt)}切换到 ${lastSwitchName}` : "暂无切换记录"}
        </div>
      </div>

      <div className="mt-2.5 space-y-1.5 border-b border-neutral-800/80 pb-2.5">
        <ReceiptLine
          tone={lastSwitch?.verified ? "success" : "muted"}
          text={
            lastSwitch?.verified
              ? selectedTool === "antigravity-cli"
                ? "源凭据与目标凭据 hash 一致"
                : "源文件与目标文件 hash 一致"
              : "尚无切换校验记录"
          }
        />
        <ReceiptLine tone={currentProfile ? "success" : "warning"} text={targetStatus} />
      </div>

      <div className="mt-2.5">
        <div className="text-[11px] font-semibold text-amber-200">本机风险</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {localDiagnostics ? (
            <>
              {envRisks.length > 0 ? (
                envRisks.map((risk) => <RiskChip key={risk} tone="warning" label={risk} />)
              ) : (
                <RiskChip tone="success" label="无环境变量风险" />
              )}
              {selectedTool === "gemini" ? (
                <RiskChip tone={localDiagnostics.geminiCommand.available ? "success" : "warning"} label={localDiagnostics.geminiCommand.available ? "gemini 可用" : "gemini 不可用"} />
              ) : null}
            </>
          ) : (
            <RiskChip tone="muted" label="本机检查中" />
          )}
        </div>
      </div>
    </div>
  );
}

function ReceiptLine({ tone, text }: { tone: "success" | "warning" | "muted"; text: string }) {
  const toneClass =
    tone === "success" ? "text-emerald-300" : tone === "warning" ? "text-amber-300" : "text-neutral-500";
  return (
    <div className="flex items-center gap-2 text-[11px] text-neutral-300">
      <span className={toneClass}>{tone === "success" ? "✓" : tone === "warning" ? "!" : "·"}</span>
      <span>{text}</span>
    </div>
  );
}

function RiskChip({ tone, label }: { tone: "success" | "warning" | "muted"; label: string }) {
  const className =
    tone === "success"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : tone === "warning"
        ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
        : "border-neutral-700 bg-white/[0.04] text-neutral-400";

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${className}`}>
      {label}
    </span>
  );
}

function TerminalLine({ label, value, valueClassName = "text-neutral-100" }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="mt-2 flex min-w-0 items-baseline gap-2">
      <span className="w-16 shrink-0 text-neutral-400">{label}</span>
      <span className="text-neutral-500">:</span>
      <span className={`min-w-0 truncate ${valueClassName}`} title={value}>
        {value}
      </span>
    </div>
  );
}

function OAuthLoginDialog({
  selectedTool,
  profilesRoot,
  session,
  inspection,
  existingProfileNames,
  status,
  profileNameDraft,
  nicknameDraft,
  isStarting,
  isInspecting,
  isSaving,
  isCancelling,
  onStart,
  onInspect,
  onProfileNameChange,
  onNicknameChange,
  onSave,
  onClose,
  onBackdropClick
}: {
  selectedTool: TargetTool;
  profilesRoot: string;
  session?: OAuthLoginSession;
  inspection?: OAuthLoginInspectResult;
  existingProfileNames: string[];
  status: StatusMessage;
  profileNameDraft: string;
  nicknameDraft: string;
  isStarting: boolean;
  isInspecting: boolean;
  isSaving: boolean;
  isCancelling: boolean;
  onStart: () => void;
  onInspect: () => void;
  onProfileNameChange: (value: string) => void;
  onNicknameChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
  onBackdropClick: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const isBusy = isStarting || isInspecting || isSaving || isCancelling;
  const toolLabels = TOOL_LABELS[selectedTool];
  const credentialLabel = selectedTool === "antigravity-cli" ? "登录凭据" : "OAuth 文件";
  const trimmedProfileName = profileNameDraft.trim();
  const hasExistingProfileName = Boolean(trimmedProfileName && existingProfileNames.includes(trimmedProfileName));
  const hasOriginalConflict = Boolean(inspection?.conflictProfileName && trimmedProfileName === inspection.conflictProfileName);
  const duplicateProfileName = hasExistingProfileName ? trimmedProfileName : hasOriginalConflict ? inspection?.conflictProfileName : undefined;
  const canSave = Boolean(session && inspection?.oauthExists && trimmedProfileName && !duplicateProfileName) && !isBusy;
  const savePathPreview = buildProfileLoginPreview(profilesRoot, trimmedProfileName, selectedTool);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/35 px-4 py-5"
      role="dialog"
      aria-modal="true"
      onMouseDown={onBackdropClick}
    >
      <section className="flex max-h-[calc(100vh-2.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-neutral-300 bg-[#f7f3ea] shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-300 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-950">新增 {toolLabels.shortName} 登录</h2>
            <p className="mt-1 text-sm text-neutral-600">先隔离登录，成功后检测 {credentialLabel} 并保存为 profile。</p>
          </div>
          <button className="copy-icon-button" onClick={onClose} disabled={isBusy} aria-label="关闭登录新账号" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          <section className="rounded-md border border-neutral-300 bg-white/75 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-neutral-900">开始登录</div>
                <p className="mt-1 text-sm leading-6 text-neutral-600">
                  会先创建临时登录目录，登录成功后再保存到账号列表。
                </p>
              </div>
              <button className="primary-button" onClick={onStart} disabled={isBusy || Boolean(session)}>
                <RefreshCw className={isStarting ? "h-4 w-4 animate-spin" : "hidden"} />
                {session ? "登录窗口已打开" : isStarting ? "打开中..." : "打开登录窗口"}
              </button>
            </div>
          </section>

          <section className="rounded-md border border-neutral-900/80 bg-neutral-950 px-4 py-3 font-mono text-sm text-neutral-100">
            <div className="text-emerald-400">&gt; 登录状态</div>
            <TerminalLine label="窗口" value={session ? "已打开" : "等待开始"} />
            <TerminalLine label="凭据" value={inspection?.oauthExists ? `已检测到 ${credentialLabel}` : "等待检测"} />
            <TerminalLine
              label="识别"
              value={inspection?.accountEmail ? inspection.accountEmail : inspection?.oauthExists ? "未识别邮箱" : `等待 ${credentialLabel}`}
              valueClassName={inspection?.accountEmail ? "text-emerald-300" : "text-neutral-100"}
            />
          </section>

          <SettingsStatusBar status={status} />

          {inspection?.oauthExists ? (
            <section className="rounded-md border border-neutral-300 bg-white/75 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-neutral-800" htmlFor="oauth-profile-name">
                    保存名称
                  </label>
                  <input
                    id="oauth-profile-name"
                    className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none transition focus:border-neutral-800 focus:ring-2 focus:ring-neutral-800/10"
                    value={profileNameDraft}
                    onChange={(event) => onProfileNameChange(event.target.value)}
                    disabled={isSaving}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-neutral-800" htmlFor="oauth-nickname">
                    昵称
                  </label>
                  <input
                    id="oauth-nickname"
                    className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-800 focus:ring-2 focus:ring-neutral-800/10"
                    value={nicknameDraft}
                    onChange={(event) => onNicknameChange(event.target.value)}
                    disabled={isSaving}
                    placeholder="可选"
                  />
                </div>
              </div>
              {inspection.accountEmail ? (
                <div className="mt-3 text-sm text-neutral-700">
                  识别到账号：<span className="font-mono font-semibold text-neutral-950">{inspection.accountEmail}</span>
                </div>
              ) : null}
              {duplicateProfileName ? (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  已存在同名账号目录：{duplicateProfileName}
                </div>
              ) : null}
              <PathLine label="保存到" value={savePathPreview || inspection.targetProfilePath || ""} />
            </section>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-300 px-5 py-4">
          <button className="tool-button" onClick={onClose} disabled={isBusy}>
            {isCancelling ? "清理中..." : "取消"}
          </button>
          <button className="tool-button" onClick={onInspect} disabled={!session || isBusy}>
            <RefreshCw className={isInspecting ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            重新检测
          </button>
          <button className="primary-button" onClick={onSave} disabled={!canSave}>
            <RefreshCw className={isSaving ? "h-4 w-4 animate-spin" : "hidden"} />
            {isSaving ? "保存中..." : "保存到账号列表"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsDialog({
  profilesRootDraft,
  selectedTool,
  targetOAuthPath,
  targetGeminiDir,
  profilesRoot,
  trayBehavior,
  autoUpdateEnabled,
  isSaving,
  isSavingTrayBehavior,
  isSavingAutoUpdate,
  status,
  onProfilesRootChange,
  onTrayBehaviorChange,
  onAutoUpdateEnabledChange,
  onSelectProfilesRoot,
  onSave,
  onReveal,
  onClose
}: {
  profilesRootDraft: string;
  selectedTool: TargetTool;
  targetOAuthPath: string;
  targetGeminiDir: string;
  profilesRoot: string;
  trayBehavior: TrayBehavior;
  autoUpdateEnabled: boolean;
  isSaving: boolean;
  isSavingTrayBehavior: boolean;
  isSavingAutoUpdate: boolean;
  status?: StatusMessage;
  onProfilesRootChange: (value: string) => void;
  onTrayBehaviorChange: (value: TrayBehavior) => void | Promise<void>;
  onAutoUpdateEnabledChange: (enabled: boolean) => void | Promise<void>;
  onSelectProfilesRoot: () => void;
  onSave: () => void;
  onReveal: (target: RevealTarget) => void;
  onClose: () => void;
}) {
  const toolLabels = TOOL_LABELS[selectedTool];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-950/35 px-4 py-10" role="dialog" aria-modal="true">
      <section className="w-full max-w-2xl rounded-md border border-neutral-300 bg-[#f7f3ea] p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-300 pb-4">
          <h2 className="text-lg font-semibold text-neutral-950">设置</h2>
          <button className="copy-icon-button" onClick={onClose} aria-label="关闭设置" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pt-4">
          <label className="text-sm font-semibold text-neutral-800" htmlFor="profiles-root">
            账号目录
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="profiles-root"
              className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none transition focus:border-neutral-800 focus:ring-2 focus:ring-neutral-800/10"
              placeholder="默认 C:\\Users\\<current-user>\\.gemini-homes"
              value={profilesRootDraft}
              onChange={(event) => onProfilesRootChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isSaving) {
                  onSave();
                }
                if (event.key === "Escape") {
                  onClose();
                }
              }}
            />
            <button className="tool-button" onClick={onSelectProfilesRoot} disabled={isSaving} title="选择账号目录">
              <FolderOpen className="h-4 w-4" />
              选择目录
            </button>
            <button className="primary-button" onClick={onSave} disabled={isSaving}>
              <RefreshCw className={isSaving ? "h-4 w-4 animate-spin" : "hidden"} />
              {isSaving ? "保存中..." : "保存并扫描"}
            </button>
          </div>

          <div className="mt-5">
            <div className="text-sm font-semibold text-neutral-800">关闭窗口时</div>
            <div className="mt-2 inline-flex overflow-hidden rounded-md border border-neutral-300 bg-white/70 p-1">
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  trayBehavior === "exit" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onTrayBehaviorChange("exit")}
                disabled={isSaving || isSavingTrayBehavior}
              >
                直接退出
              </button>
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  trayBehavior === "minimize_to_tray" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onTrayBehaviorChange("minimize_to_tray")}
                disabled={isSaving || isSavingTrayBehavior}
              >
                隐藏到托盘
              </button>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-sm font-semibold text-neutral-800">自动更新</div>
            <div className="mt-2 inline-flex overflow-hidden rounded-md border border-neutral-300 bg-white/70 p-1">
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  autoUpdateEnabled ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onAutoUpdateEnabledChange(true)}
                disabled={isSaving || isSavingAutoUpdate}
              >
                开启
              </button>
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  !autoUpdateEnabled ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"
                }`}
                onClick={() => void onAutoUpdateEnabledChange(false)}
                disabled={isSaving || isSavingAutoUpdate}
              >
                关闭
              </button>
            </div>
          </div>

          {status ? <SettingsStatusBar status={status} /> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="tool-button" onClick={() => onReveal("profilesRoot")} disabled={!profilesRoot} title="打开账号目录">
              <FolderOpen className="h-4 w-4" />
              打开账号目录
            </button>
            <button className="tool-button" onClick={() => onReveal(toolLabels.targetReveal)} disabled={!targetGeminiDir} title={`打开 ${toolLabels.name} 目标目录`}>
              <FolderOpen className="h-4 w-4" />
              打开 {toolLabels.shortName} 目录
            </button>
          </div>

          <PathLine label={toolLabels.targetLabel} value={targetOAuthPath} />
        </div>
      </section>
    </div>
  );
}

function NicknameDialog({
  profile,
  value,
  isSaving,
  onChange,
  onSave,
  onClose
}: {
  profile: ProfileInfo;
  value: string;
  isSaving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-950/35 px-4 py-10" role="dialog" aria-modal="true">
      <section className="w-full max-w-lg rounded-md border border-neutral-300 bg-[#f7f3ea] p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-300 pb-4">
          <h2 className="text-lg font-semibold text-neutral-950">设置昵称</h2>
          <button className="copy-icon-button" onClick={onClose} disabled={isSaving} aria-label="关闭昵称设置" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          className="pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isSaving) {
              onSave();
            }
          }}
        >
          <label className="text-sm font-semibold text-neutral-800" htmlFor="profile-nickname">
            昵称
          </label>
          <input
            id="profile-nickname"
            autoFocus
            className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-800 focus:ring-2 focus:ring-neutral-800/10"
            placeholder="例如 Work、Personal、公司账号"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isSaving) {
                onClose();
              }
            }}
          />
          <div className="mt-2 truncate font-mono text-xs text-neutral-500" title={profile.name}>
            {profile.name}
          </div>
          <p className="mt-3 text-sm leading-6 text-neutral-600">昵称只影响界面显示。留空保存会恢复为原始 profile 目录名。</p>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="tool-button" onClick={onClose} disabled={isSaving}>
              取消
            </button>
            <button type="submit" className="primary-button" disabled={isSaving}>
              <RefreshCw className={isSaving ? "h-4 w-4 animate-spin" : "hidden"} />
              {isSaving ? "保存中..." : value.trim() ? "保存昵称" : "恢复目录名"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ProfileRow({
  selectedTool,
  profile,
  nickname,
  isSwitching,
  isDeleting,
  isSwitchDisabled,
  isDeleteDisabled,
  usage,
  isRefreshingUsage,
  onSwitch,
  onDelete,
  onCopyName,
  onSetNickname,
  onRefreshUsage
}: {
  selectedTool: TargetTool;
  profile: ProfileInfo;
  nickname?: string;
  isSwitching: boolean;
  isDeleting: boolean;
  isSwitchDisabled: boolean;
  isDeleteDisabled: boolean;
  usage?: ProfileUsageResult;
  isRefreshingUsage: boolean;
  onSwitch: () => void;
  onDelete: () => void;
  onCopyName: () => void;
  onSetNickname: () => void;
  onRefreshUsage: () => void;
}) {
  const displayName = nickname || profile.name;
  const isGeminiTool = selectedTool === "gemini";
  const toolLabels = TOOL_LABELS[selectedTool];

  return (
    <div className="grid grid-cols-[minmax(260px,1fr)_320px_156px] items-center gap-3 px-5 py-4 text-sm">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${profile.isCurrent ? "bg-emerald-500" : "bg-neutral-300"}`}
          title={profile.isCurrent ? "当前账号" : "可切换账号"}
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate font-semibold text-neutral-950" title={profile.oauthPath}>
              {displayName}
            </span>
            <button className="copy-icon-button" onClick={onCopyName} aria-label={`复制 ${profile.name}`} title="复制完整 profile 名称">
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button className="copy-icon-button" onClick={onSetNickname} aria-label={`设置 ${profile.name} 的昵称`} title="设置昵称">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {profile.isCurrent ? <span className="status-pill bg-emerald-100 text-emerald-800">当前</span> : null}
            {!profile.exists ? <span className="status-pill bg-amber-100 text-amber-800">{toolLabels.missingLabel}</span> : null}
          </div>
          {nickname ? (
            <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-500" title={profile.name}>
              {profile.name}
            </div>
          ) : null}
          {profile.oauthPath ? (
            <div className="mt-1 flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-[11px] text-neutral-400" title={profile.oauthPath}>
                {profile.oauthPath}
              </span>
              <button
                className="copy-icon-button shrink-0"
                aria-label="复制路径"
                title={`复制路径：${profile.oauthPath}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyText(profile.oauthPath).catch(() => null);
                }}
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {isGeminiTool ? (
        <UsageCell profile={profile} usage={usage} isRefreshing={isRefreshingUsage} onRefresh={onRefreshUsage} />
      ) : (
        <ProfileFileCell profile={profile} />
      )}
      <div className="flex justify-start gap-2">
        <button className="switch-button" onClick={onSwitch} disabled={!profile.exists || profile.isCurrent || isSwitchDisabled}>
          <Shuffle className={isSwitching ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
          {profile.isCurrent ? "已使用" : isSwitching ? "切换中" : "切换"}
        </button>
        {isGeminiTool ? (
          <button
            className="danger-icon-button"
            onClick={onDelete}
            disabled={profile.isCurrent || isDeleteDisabled}
            aria-label={`删除 ${profile.name}`}
            title={profile.isCurrent ? "当前账号不能删除，请先切换到其他账号" : "删除 profile 到回收站"}
          >
            <Trash2 className={isDeleting ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function UsageCell({
  profile,
  usage,
  isRefreshing,
  onRefresh
}: {
  profile: ProfileInfo;
  usage?: ProfileUsageResult;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  if (!profile.exists) {
    return <div className="text-xs text-neutral-500">无 OAuth 文件</div>;
  }

  if (isRefreshing) {
    return (
      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        查询中
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {usage ? (
        <UsageSummary usage={usage} onRefresh={onRefresh} />
      ) : (
        <div className="flex items-center justify-start gap-3">
          <UsageRefreshButton label="查询用量" onRefresh={onRefresh} />
          <span className="text-xs text-neutral-500">未查询</span>
        </div>
      )}
    </div>
  );
}

function ProfileFileCell({ profile }: { profile: ProfileInfo }) {
  if (!profile.exists) {
    return <div className="text-xs text-neutral-500">无登录凭据</div>;
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        登录凭据已就绪
      </div>
      {profile.updatedAtMs ? (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-neutral-500">
          <Clock className="h-3 w-3" />
          更新于 {formatProfileUpdatedTime(profile.updatedAtMs)}
        </div>
      ) : null}
    </div>
  );
}

function UsageSummary({ usage, onRefresh }: { usage: ProfileUsageResult; onRefresh: () => void }) {
  if (!usage.success) {
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-semibold text-red-600" title={usage.error}>
          {describeUsageFailure(usage)}
        </div>
        <UsageRefreshButton label="重试" onRefresh={onRefresh} />
      </div>
    );
  }

  if (usage.tiers.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-500">暂无用量数据</span>
        <UsageRefreshButton label="重新查询" onRefresh={onRefresh} />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="space-y-2">
        {usage.tiers.map((tier) => (
          <UsageTierBar key={tier.name} tier={tier} />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 whitespace-nowrap">
        <UsageRefreshButton label="重新查询" onRefresh={onRefresh} />
        {usage.queriedAt ? (
          <div className="flex items-center gap-1 text-[11px] text-neutral-500">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(usage.queriedAt)}
          </div>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

function UsageRefreshButton({ label, onRefresh }: { label: string; onRefresh: () => void }) {
  return (
    <button className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-600 hover:text-neutral-950" onClick={onRefresh}>
      <RefreshCw className="h-3 w-3" />
      {label}
    </button>
  );
}

function UsageTierBar({ tier }: { tier: UsageTier }) {
  const percentage = clampPercentage(tier.utilization);
  const resetText = formatResetTime(tier.resetsAt);

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-[78px_minmax(96px,1fr)_36px] items-center gap-2 font-mono text-[11px] leading-none text-neutral-700">
        <span className="whitespace-nowrap" title={tier.label}>
          {tier.label}
        </span>
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200">
          <div
            className={`h-full rounded-full ${usageBarClass(tier.utilization)}`}
            style={{ width: `${percentage}%` }}
            role="progressbar"
            aria-label={`${tier.label} ${percentage}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
          />
        </div>
        <span className="text-right text-neutral-500" title={resetText ? `${percentage}% · ${resetText}` : `${percentage}%`}>
          <span className="font-semibold text-neutral-800">{percentage}%</span>
        </span>
      </div>
    </div>
  );
}

function StatusBar({ status, visibility }: { status: StatusMessage; visibility: StatusVisibility }) {
  const className =
    status.tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : status.tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-neutral-300 bg-white/70 text-neutral-600";
  const visibilityClass =
    visibility === "visible"
      ? "max-h-20 py-3 opacity-100"
      : visibility === "fading"
        ? "max-h-20 py-3 opacity-0"
        : "max-h-0 border-transparent py-0 opacity-0";

  return (
    <div
      className={`overflow-hidden rounded-md border px-4 text-sm transition-[opacity,max-height,padding,border-color] duration-700 ease-in-out ${className} ${visibilityClass}`}
    >
      {status.text}
    </div>
  );
}

function SettingsStatusBar({ status }: { status: StatusMessage }) {
  const className =
    status.tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : status.tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-neutral-300 bg-white/70 text-neutral-700";

  return <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${className}`}>{status.text}</div>;
}

function PathLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 flex flex-col gap-1 text-xs text-neutral-500">
      <span className="font-semibold uppercase">{label}</span>
      <span className="break-all font-mono text-neutral-700">{value}</span>
    </div>
  );
}

function formatRelativeTime(value: number): string {
  const diffMs = Math.max(0, Date.now() - value);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "刚刚查询";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前查询`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前查询`;
  }

  return `${Math.floor(hours / 24)} 天前查询`;
}

function formatProfileUpdatedTime(value: number): string {
  const diffMs = Math.max(0, Date.now() - value);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }

  return `${Math.floor(hours / 24)} 天前`;
}

function formatSwitchRelativeTime(value: number): string {
  const diffMs = Math.max(0, Date.now() - value);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }

  return `${Math.floor(hours / 24)} 天前`;
}

function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function formatResetTime(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}


function buildProfileLoginPreview(profilesRoot: string, profileName: string, selectedTool: TargetTool): string {
  if (!profilesRoot || !profileName) {
    return "";
  }

  if (selectedTool === "antigravity-cli") {
    return `Windows Credential Manager：${profileName} 的 Antigravity 登录凭据`;
  }

  const relativePath = ".gemini\\oauth_creds.json";
  return `${profilesRoot.replace(/[\\/]+$/, "")}\\${profileName}\\${relativePath}`;
}

function usageBarClass(utilization: number): string {
  if (utilization >= 90) {
    return "bg-red-500";
  }
  if (utilization >= 70) {
    return "bg-amber-500";
  }

  return "bg-emerald-500";
}

function getProfileDisplayName(profile: ProfileInfo, nicknames: Record<string, string>): string {
  return nicknames[profile.name] || profile.name;
}

function describeUsageFailure(usage: ProfileUsageResult): string {
  if (usage.credentialStatus === "not_found") {
    return "无 OAuth 文件";
  }
  if (usage.credentialStatus === "parse_error") {
    return "OAuth 文件无法读取";
  }
  if (usage.credentialStatus === "expired") {
    return "登录已失效";
  }
  if (usage.error?.includes("HTTP 403")) {
    return "权限不足或账号不可用";
  }
  if (usage.error?.includes("HTTP 401")) {
    return "登录已失效";
  }
  if (usage.error?.startsWith("Network error")) {
    return "网络请求失败";
  }

  return "查询失败";
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("复制失败");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getApi() {
  if (!window.geminiSwitcher) {
    throw new Error("Electron preload API 不可用，请通过 pnpm dev 启动 Electron 窗口。");
  }

  return window.geminiSwitcher;
}
