import { Activity, Plus, RefreshCw, Settings } from "lucide-react";
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
  TrayBehavior
} from "../shared/types";
import { CurrentAccountPanel } from "./components/CurrentAccountPanel";
import { NicknameDialog } from "./components/NicknameDialog";
import { OAuthLoginDialog } from "./components/OAuthLoginDialog";
import { ProfileRow } from "./components/ProfileRow";
import { SettingsDialog } from "./components/SettingsDialog";
import { StatusBar } from "./components/StatusBar";
import { TargetToolSwitch } from "./components/TargetToolSwitch";
import { emptyResult, TOOL_LABELS } from "./constants";
import type { StatusMessage, StatusVisibility } from "./types";
import { copyText, describeUsageFailure, getApi, getErrorMessage, getProfileDisplayName } from "./utils";

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
