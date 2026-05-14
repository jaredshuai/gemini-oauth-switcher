import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPowerShellLaunchCommand,
  buildPowerShellLoginScript,
  cleanupOAuthLoginSession,
  cleanupStaleOAuthLoginSessions,
  createOAuthLoginSession,
  inspectOAuthLoginSession,
  saveOAuthLoginSession
} from "../src/main/oauthLoginService";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gemini-oauth-switcher-login-"));
  tempRoots.push(root);
  return root;
}

async function writeOAuth(profilePath: string, content: unknown): Promise<string> {
  const geminiDir = path.join(profilePath, ".gemini");
  await mkdir(geminiDir, { recursive: true });
  const oauthPath = path.join(geminiDir, "oauth_creds.json");
  await writeFile(oauthPath, `${JSON.stringify(content)}\n`, "utf8");
  return oauthPath;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("oauthLoginService", () => {
  it("creates a pending login profile and launches Gemini with an isolated GEMINI_CLI_HOME", async () => {
    const root = await makeTempRoot();
    const launchedScripts: string[] = [];

    const session = await createOAuthLoginSession({
      profilesRoot: root,
      launchPowerShell: async (script) => {
        launchedScripts.push(script);
      },
      now: () => new Date("2026-05-14T08:00:00.000Z"),
      randomId: () => "abc123"
    });

    expect(session.sessionId).toBe("20260514-080000-abc123");
    const expectedPidFilePath = path.join(root, ".pending-login-20260514-080000-abc123.pid");
    expect(session.pendingProfilePath).toBe(path.join(root, ".pending-login-20260514-080000-abc123"));
    expect(session.pidFilePath).toBe(expectedPidFilePath);
    await expect(stat(session.pendingProfilePath)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    expect(launchedScripts).toHaveLength(1);
    expect(launchedScripts[0]).toContain(`$profile = '${session.pendingProfilePath.replace(/'/g, "''")}'`);
    expect(launchedScripts[0]).toContain(`$workspace = '${root.replace(/'/g, "''")}'`);
    expect(launchedScripts[0]).toContain(`$pidFile = '${expectedPidFilePath.replace(/'/g, "''")}'`);
    expect(launchedScripts[0]).toContain("Set-Content -LiteralPath $pidFile -Value $PID");
    expect(launchedScripts[0]).toContain("$env:GEMINI_CLI_HOME = $profile");
    expect(launchedScripts[0]).toContain("Remove-Item Env:\\GEMINI_API_KEY");
    expect(launchedScripts[0]).toContain("Remove-Item Env:\\GOOGLE_API_KEY");
    expect(launchedScripts[0]).toContain("Remove-Item Env:\\GOOGLE_GEMINI_BASE_URL");
    expect(launchedScripts[0]).toContain("Remove-Item Env:\\GOOGLE_VERTEX_BASE_URL");
    expect(launchedScripts[0]).toContain("Set-Location -LiteralPath $workspace");
    expect(launchedScripts[0]).toContain("gemini --skip-trust");
  });

  it("detects the OAuth file and reports a duplicate profile name from the recognized email", async () => {
    const root = await makeTempRoot();
    await mkdir(path.join(root, "user_gmail_com"), { recursive: true });
    const pendingProfilePath = path.join(root, ".pending-login-manual");
    await writeOAuth(pendingProfilePath, {
      email: "User@Gmail.com",
      access_token: "redacted"
    });

    const result = await inspectOAuthLoginSession({
      profilesRoot: root,
      sessionId: "manual",
      pendingProfilePath
    });

    expect(result.oauthExists).toBe(true);
    expect(result.accountEmail).toBe("user@gmail.com");
    expect(result.proposedProfileName).toBe("user_gmail_com");
    expect(result.proposedNickname).toBe("user@gmail.com");
    expect(result.conflictProfileName).toBe("user_gmail_com");
    expect(result.targetProfilePath).toBe(path.join(root, "user_gmail_com"));
    expect(result.shortHash).toHaveLength(8);
  });

  it("reports a duplicate profile name when the exact recognized email directory already exists", async () => {
    const root = await makeTempRoot();
    await mkdir(path.join(root, "user@gmail.com"), { recursive: true });
    const pendingProfilePath = path.join(root, ".pending-login-exact-email");
    await writeOAuth(pendingProfilePath, {
      email: "User@Gmail.com",
      access_token: "redacted"
    });

    const result = await inspectOAuthLoginSession({
      profilesRoot: root,
      sessionId: "exact-email",
      pendingProfilePath
    });

    expect(result.proposedProfileName).toBe("user_gmail_com");
    expect(result.conflictProfileName).toBe("user@gmail.com");
  });

  it("saves a detected pending login as a direct child profile without overwriting existing profiles", async () => {
    const root = await makeTempRoot();
    const pendingProfilePath = path.join(root, ".pending-login-save");
    await writeOAuth(pendingProfilePath, {
      account: "alice@example.com",
      access_token: "redacted"
    });

    const result = await saveOAuthLoginSession({
      profilesRoot: root,
      sessionId: "save",
      pendingProfilePath,
      profileName: "alice@example.com",
      nickname: "Alice"
    });

    expect(result.profileName).toBe("alice@example.com");
    expect(result.nickname).toBe("Alice");
    expect(result.accountEmail).toBe("alice@example.com");
    expect(result.oauthPath).toBe(path.join(root, "alice@example.com", ".gemini", "oauth_creds.json"));
    const savedOAuth = await readFile(result.oauthPath, "utf8");
    expect(savedOAuth).toContain("alice@example.com");
    expect(result.sha256).toBe(sha256(savedOAuth));
    await expect(stat(pendingProfilePath)).rejects.toThrow();

    const secondPendingPath = path.join(root, ".pending-login-duplicate");
    await writeOAuth(secondPendingPath, { account: "alice@example.com", access_token: "redacted" });
    await expect(
      saveOAuthLoginSession({
        profilesRoot: root,
        sessionId: "duplicate",
        pendingProfilePath: secondPendingPath,
        profileName: "alice@example.com"
      })
    ).rejects.toThrow(/already exists/);
  });

  it("cleans up a pending login session when the user cancels", async () => {
    const root = await makeTempRoot();
    const pendingProfilePath = path.join(root, ".pending-login-cancel");
    await mkdir(pendingProfilePath, { recursive: true });

    await cleanupOAuthLoginSession({
      profilesRoot: root,
      sessionId: "cancel",
      pendingProfilePath,
      terminateProcessTree: async () => undefined
    });

    await expect(stat(pendingProfilePath)).rejects.toThrow();
  });

  it("cleans up only the pid file when a saved pending directory was already renamed away", async () => {
    const root = await makeTempRoot();
    const sessionId = "saved";
    const pendingProfilePath = path.join(root, `.pending-login-${sessionId}`);
    const pidFilePath = path.join(root, `.pending-login-${sessionId}.pid`);
    await writeFile(pidFilePath, "4321", "utf8");

    await cleanupOAuthLoginSession({
      profilesRoot: root,
      sessionId,
      pendingProfilePath,
      pidFilePath,
      terminateProcessTree: async () => undefined
    });

    await expect(stat(pidFilePath)).rejects.toThrow();
  });

  it("sweeps stale pending login directories and pid files", async () => {
    const root = await makeTempRoot();
    const oldPendingPath = path.join(root, ".pending-login-old");
    const freshPendingPath = path.join(root, ".pending-login-fresh");
    const oldPidPath = path.join(root, ".pending-login-old.pid");
    await mkdir(oldPendingPath, { recursive: true });
    await mkdir(freshPendingPath, { recursive: true });
    await writeFile(oldPidPath, "4321", "utf8");
    const oldDate = new Date("2026-05-14T08:00:00.000Z");
    const freshDate = new Date("2026-05-14T09:50:00.000Z");
    await touch(oldPendingPath, oldDate);
    await touch(oldPidPath, oldDate);
    await touch(freshPendingPath, freshDate);

    const result = await cleanupStaleOAuthLoginSessions({
      profilesRoot: root,
      olderThanMs: 60 * 60 * 1000,
      nowMs: () => new Date("2026-05-14T10:00:00.000Z").getTime(),
      terminateProcessTree: async () => undefined
    });

    expect(result.removed).toEqual([".pending-login-old", ".pending-login-old.pid"]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
    await expect(stat(oldPendingPath)).rejects.toThrow();
    await expect(stat(oldPidPath)).rejects.toThrow();
    await expect(stat(freshPendingPath)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("terminates a stale login process before sweeping its pending directory", async () => {
    const root = await makeTempRoot();
    const oldPendingPath = path.join(root, ".pending-login-stale-process");
    const oldPidPath = path.join(root, ".pending-login-stale-process.pid");
    const terminatedPids: number[] = [];
    await mkdir(oldPendingPath, { recursive: true });
    await writeFile(oldPidPath, "8765", "utf8");
    const oldDate = new Date("2026-05-14T08:00:00.000Z");
    await touch(oldPendingPath, oldDate);
    await touch(oldPidPath, oldDate);

    const result = await cleanupStaleOAuthLoginSessions({
      profilesRoot: root,
      olderThanMs: 60 * 60 * 1000,
      nowMs: () => new Date("2026-05-14T10:00:00.000Z").getTime(),
      terminateProcessTree: async (pid) => {
        terminatedPids.push(pid);
      }
    });

    expect(terminatedPids).toEqual([8765]);
    expect(result.removed).toEqual([".pending-login-stale-process", ".pending-login-stale-process.pid"]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("keeps sweeping other stale login entries when one pending directory is busy", async () => {
    const root = await makeTempRoot();
    const busyPendingPath = path.join(root, ".pending-login-busy-sweep");
    const oldPidPath = path.join(root, ".pending-login-orphan.pid");
    await mkdir(busyPendingPath, { recursive: true });
    await writeFile(oldPidPath, "4321", "utf8");
    const oldDate = new Date("2026-05-14T08:00:00.000Z");
    await touch(busyPendingPath, oldDate);
    await touch(oldPidPath, oldDate);

    const result = await cleanupStaleOAuthLoginSessions({
      profilesRoot: root,
      olderThanMs: 60 * 60 * 1000,
      nowMs: () => new Date("2026-05-14T10:00:00.000Z").getTime(),
      terminateProcessTree: async () => undefined,
      removeDirectory: async () => {
        throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
      }
    });

    expect(result.removed).toEqual([".pending-login-orphan.pid"]);
    expect(result.failed).toEqual([".pending-login-busy-sweep"]);
    expect(result.skipped).toEqual([]);
    await expect(stat(oldPidPath)).rejects.toThrow();
    await expect(stat(busyPendingPath)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("removes stale pending directories with legacy session names that do not have valid pid file names", async () => {
    const root = await makeTempRoot();
    const legacyPendingPath = path.join(root, ".pending-login-old.copy");
    await mkdir(legacyPendingPath, { recursive: true });
    await touch(legacyPendingPath, new Date("2026-05-14T08:00:00.000Z"));

    const result = await cleanupStaleOAuthLoginSessions({
      profilesRoot: root,
      olderThanMs: 60 * 60 * 1000,
      nowMs: () => new Date("2026-05-14T10:00:00.000Z").getTime()
    });

    expect(result.removed).toEqual([".pending-login-old.copy"]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
    await expect(stat(legacyPendingPath)).rejects.toThrow();
  });

  it("reports but does not remove stale pending directories that are symlinks or junctions", async () => {
    const root = await makeTempRoot();
    const externalRoot = await makeTempRoot();
    const externalPendingTarget = path.join(externalRoot, "pending-target");
    await mkdir(externalPendingTarget, { recursive: true });
    const linkedPendingPath = path.join(root, ".pending-login-linked");
    await symlink(externalPendingTarget, linkedPendingPath, "junction");

    const result = await cleanupStaleOAuthLoginSessions({
      profilesRoot: root,
      olderThanMs: 0,
      nowMs: () => Date.now() + 1000
    });

    expect(result.removed).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([".pending-login-linked"]);
    await expect(stat(externalPendingTarget)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("terminates the login process before removing a canceled pending session", async () => {
    const root = await makeTempRoot();
    const sessionId = "cancel-with-process";
    const pendingProfilePath = path.join(root, `.pending-login-${sessionId}`);
    const pidFilePath = path.join(root, `.pending-login-${sessionId}.pid`);
    const terminatedPids: number[] = [];
    await mkdir(pendingProfilePath, { recursive: true });
    await writeFile(pidFilePath, "4321", "utf8");

    await cleanupOAuthLoginSession({
      profilesRoot: root,
      sessionId,
      pendingProfilePath,
      terminateProcessTree: async (pid) => {
        terminatedPids.push(pid);
      }
    });

    expect(terminatedPids).toEqual([4321]);
    await expect(stat(pendingProfilePath)).rejects.toThrow();
    await expect(stat(pidFilePath)).rejects.toThrow();
  });

  it("explains that the login window must be closed before cleaning a busy pending directory", async () => {
    const root = await makeTempRoot();
    const pendingProfilePath = path.join(root, ".pending-login-busy");
    await mkdir(pendingProfilePath, { recursive: true });

    await expect(
      cleanupOAuthLoginSession({
        profilesRoot: root,
        sessionId: "busy",
        pendingProfilePath,
        terminateProcessTree: async () => undefined,
        removeDirectory: async () => {
          throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
        }
      })
    ).rejects.toThrow(/请先关闭 PowerShell 登录窗口/);
  });

  it("builds a PowerShell script matching the manual isolated-login flow", () => {
    const script = buildPowerShellLoginScript({
      profilePath: "C:\\Users\\jared\\.gemini-homes\\.pending-login-work",
      workingDirectory: "C:\\Users\\jared\\.gemini-homes"
    });

    expect(script).toContain("$profile = 'C:\\Users\\jared\\.gemini-homes\\.pending-login-work'");
    expect(script).toContain("$workspace = 'C:\\Users\\jared\\.gemini-homes'");
    expect(script).toContain("New-Item -ItemType Directory -Force -Path $profile");
    expect(script).toContain("$env:GEMINI_CLI_HOME = $profile");
    expect(script).toContain("Remove-Item Env:\\GEMINI_API_KEY");
    expect(script).toContain("Remove-Item Env:\\GOOGLE_API_KEY");
    expect(script).toContain("Remove-Item Env:\\GOOGLE_GEMINI_BASE_URL");
    expect(script).toContain("Remove-Item Env:\\GOOGLE_VERTEX_BASE_URL");
    expect(script).toContain("Set-Location -LiteralPath $workspace");
    expect(script).toContain("gemini --skip-trust");
  });

  it("launches PowerShell through Windows start so Electron opens a visible console window", () => {
    const command = buildPowerShellLaunchCommand("Write-Output 'hello'");

    expect(command.file).toBe("cmd.exe");
    expect(command.args.slice(0, 4)).toEqual(["/d", "/c", "start", "Gemini OAuth Login"]);
    expect(command.args).toContain("powershell.exe");
    expect(command.args).toContain("-NoExit");
    expect(command.args).toContain("-EncodedCommand");
  });
});

async function touch(targetPath: string, date: Date): Promise<void> {
  const { utimes } = await import("node:fs/promises");
  await utimes(targetPath, date, date);
}
