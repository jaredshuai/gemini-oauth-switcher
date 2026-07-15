import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

describe("packaged renderer config", () => {
  it("uses relative asset paths so file:// packaged windows can load the app", () => {
    expect((viteConfig as { base?: string }).base).toBe("./");
  });

  it("restricts the packaged renderer with a content security policy", () => {
    const html = readFileSync(path.join(process.cwd(), "index.html"), "utf8");

    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("default-src 'self'");
    expect(html).toContain("object-src 'none'");
  });

  it("accepts only a release tag matching the package version", () => {
    const scriptPath = path.join(process.cwd(), "scripts", "verify-release-tag.mjs");
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };
    const releaseTag = `v${packageJson.version}`;
    const output = execFileSync(process.execPath, [scriptPath, releaseTag], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(output).toContain(releaseTag);
    expect(() => execFileSync(process.execPath, [scriptPath, "v999.0.0"], {
      cwd: process.cwd(),
      stdio: "pipe"
    })).toThrow();
  });

  it("allows unsigned releases and verifies Authenticode only when signing is configured", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "windows-build.yml"), "utf8");

    expect(workflow).toContain("node scripts/verify-release-tag.mjs");
    expect(workflow).toContain("WINDOWS_CSC_LINK");
    expect(workflow).toContain("id: signing");
    expect(workflow).toContain("$hasLink -xor $hasPassword");
    expect(workflow).toContain('"enabled=false"');
    expect(workflow).toContain("steps.signing.outputs.enabled == 'true'");
    expect(workflow).toContain("Get-AuthenticodeSignature");
    expect(workflow).toContain("pnpm verify:windows-artifacts");
    expect(workflow).not.toContain("Refusing to publish unsigned release binaries");
  });

  it("gates artifact publication on the NSIS installer lifecycle smoke test", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "windows-build.yml"), "utf8");
    const verifyIndex = workflow.indexOf("Verify Windows release artifacts");
    const smokeIndex = workflow.indexOf("Smoke test NSIS installer lifecycle");
    const cleanupIndex = workflow.indexOf("Cleanup NSIS smoke directory");
    const uploadIndex = workflow.indexOf("Upload build artifacts");
    const releaseIndex = workflow.indexOf("Create GitHub Release");

    expect(verifyIndex).toBeGreaterThanOrEqual(0);
    expect(smokeIndex).toBeGreaterThan(verifyIndex);
    expect(cleanupIndex).toBeGreaterThan(smokeIndex);
    expect(uploadIndex).toBeGreaterThan(cleanupIndex);
    expect(releaseIndex).toBeGreaterThan(cleanupIndex);
    expect(workflow).toContain("./scripts/smoke-test-windows-installer.ps1");
    expect(workflow).toContain("Custom Install With Spaces");
    expect(workflow).toContain("$expectedDefaultInstallDirectory = Join-Path $env:LOCALAPPDATA 'Programs\\Gemini OAuth Switcher'");
    expect(workflow).toContain("-ExpectedDefaultInstallDirectory $expectedDefaultInstallDirectory");

    const smokeBlock = workflow.slice(smokeIndex, cleanupIndex);
    const cleanupBlock = workflow.slice(cleanupIndex, uploadIndex);

    expect(smokeBlock).not.toContain("finally");
    expect(smokeBlock).not.toContain("Remove-Item -LiteralPath $temporaryRoot");
    expect(smokeBlock).toContain("NSIS_SMOKE_TEMPORARY_ROOT=$temporaryRoot");
    expect(smokeBlock).toContain("$env:GITHUB_ENV");
    expect(cleanupBlock).toContain("if: always()");
    expect(cleanupBlock).toContain("$env:NSIS_SMOKE_TEMPORARY_ROOT");
    expect(cleanupBlock).toContain("$env:RUNNER_TEMP");
    expect(cleanupBlock).toContain("strict descendant");
    expect(cleanupBlock).toContain("[System.IO.FileAttributes]::ReparsePoint");
    expect(cleanupBlock).not.toContain("Remove-Item -LiteralPath $temporaryRoot -Recurse");

    const script = readFileSync(path.join(process.cwd(), "scripts", "smoke-test-windows-installer.ps1"), "utf8");

    expect(script).toContain("TemporaryRoot");
    expect(script).toContain("ProcessTimeoutSeconds = 120");
    expect(script).toContain("ExpectedDefaultInstallDirectory");
    expect(script).toContain("function Get-ExistingItem");
    expect(script).toContain("Get-Item -LiteralPath $Path -Force -ErrorAction Stop");
    expect(script).toContain("ItemNotFoundException");
    expect(script).toContain("Unable to inspect path");
    expect(script).not.toContain("Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue");
    expect(script).toContain("Assert-PathAncestorsHaveNoReparsePoints");
    expect(script).toContain("function Invoke-BoundedProcess");
    expect(script).toContain(".WaitForExit(");
    expect(script).toContain("Stop-Process");
    expect(script).toContain("taskkill.exe");
    expect(script).toContain("/T /F");
    expect(script).toContain("ArgumentList @('/S', \"/D=$InstallDirectory\")");
    expect(script).toContain("Get-MatchingUninstallEntries");
    expect(script).toContain("UninstallString");
    expect(script).toContain('[Environment]::GetFolderPath("Programs")');
    expect(script).toContain("[System.IO.FileAttributes]::ReparsePoint");
    expect(script).toContain("Remove-ReparsePoint");
    expect(script).toContain("LikelyDefaultInstallDirectory");
    expect(script).toContain("$env:LOCALAPPDATA");
    expect(script).toContain("Test-Path -LiteralPath");
    expect(script).toContain('$displayName.StartsWith("$ExpectedProductName ", [System.StringComparison]::OrdinalIgnoreCase)');
  });

  it.runIf(process.platform === "win32")("refuses an existing install directory before starting the installer", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-installer-smoke-"));
    const installDirectory = path.join(temporaryRoot, "Existing Install");
    const sentinelPath = path.join(installDirectory, "sentinel.txt");
    const probe = makeLaunchProbe(temporaryRoot, ["exit /b 17"]);

    mkdirSync(installDirectory);
    writeFileSync(sentinelPath, "unchanged", "utf8");

    try {
      expect(() => invokeInstallerSmoke({
        installerPath: probe.path,
        temporaryRoot,
        installDirectory
      })).toThrow("Install directory already exists");

      expect(readFileSync(sentinelPath, "utf8")).toBe("unchanged");
      expect(existsSync(probe.markerPath)).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("reports a missing installer with the contract error", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-installer-missing-"));
    const installerPath = path.join(temporaryRoot, "missing-installer.exe");

    try {
      expect(() => invokeInstallerSmoke({
        installerPath,
        temporaryRoot,
        installDirectory: path.join(temporaryRoot, "Install")
      })).toThrow(`Installer does not exist: ${installerPath}`);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("fails closed when an installer path cannot be inspected", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-inspection-error-"));
    const installerPath = `MissingProvider${randomUUID().replace(/-/g, "")}::installer.exe`;

    try {
      expect(() => invokeInstallerSmoke({
        installerPath,
        temporaryRoot,
        installDirectory: path.join(temporaryRoot, "Install")
      })).toThrow(`Unable to inspect path '${installerPath}'`);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("terminates an installer process tree that exceeds ProcessTimeoutSeconds", async () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-installer-timeout-"));
    const delayedMarkerPath = path.join(temporaryRoot, "delayed-child-marker.txt");
    const childProbePath = path.join(temporaryRoot, "delayed-child.cmd");
    writeFileSync(childProbePath, [
      "@echo off",
      "ping -n 4 127.0.0.1 >nul",
      `> "${delayedMarkerPath}" echo child-survived`,
      ""
    ].join("\r\n"), "utf8");
    const probe = makeLaunchProbe(temporaryRoot, [
      `start "" /b "${childProbePath}"`,
      "ping -n 8 127.0.0.1 >nul",
      "exit /b 0"
    ]);

    try {
      expect(() => invokeInstallerSmoke({
        installerPath: probe.path,
        temporaryRoot,
        installDirectory: path.join(temporaryRoot, "Timed Install"),
        processTimeoutSeconds: 1
      })).toThrow("Installer timed out after 1 seconds");

      expect(existsSync(probe.markerPath)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 4_500));
      expect(existsSync(delayedMarkerPath)).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 12_000);

  it.runIf(process.platform === "win32")("rejects a TemporaryRoot reparse point before starting the installer", () => {
    const outerRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-root-reparse-"));
    const actualRoot = path.join(outerRoot, "actual-root");
    const linkedRoot = path.join(outerRoot, "linked-root");
    const probe = makeLaunchProbe(outerRoot, ["exit /b 17"]);

    mkdirSync(actualRoot);
    symlinkSync(actualRoot, linkedRoot, "junction");

    try {
      expect(() => invokeInstallerSmoke({
        installerPath: probe.path,
        temporaryRoot: linkedRoot,
        installDirectory: path.join(linkedRoot, "Install")
      })).toThrow("TemporaryRoot must not be a reparse point");

      expect(existsSync(probe.markerPath)).toBe(false);
    } finally {
      unlinkJunctionIfPresent(linkedRoot);
      rmSync(outerRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("rejects an existing reparse component beneath TemporaryRoot", () => {
    const outerRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-component-reparse-"));
    const temporaryRoot = path.join(outerRoot, "temporary-root");
    const outsideTarget = path.join(outerRoot, "outside-target");
    const linkedComponent = path.join(temporaryRoot, "linked-component");
    const probe = makeLaunchProbe(outerRoot, ["exit /b 17"]);

    mkdirSync(temporaryRoot);
    mkdirSync(outsideTarget);
    symlinkSync(outsideTarget, linkedComponent, "junction");

    try {
      expect(() => invokeInstallerSmoke({
        installerPath: probe.path,
        temporaryRoot,
        installDirectory: path.join(linkedComponent, "Install")
      })).toThrow("Install path component is a reparse point");

      expect(existsSync(probe.markerPath)).toBe(false);
    } finally {
      unlinkJunctionIfPresent(linkedComponent);
      rmSync(outerRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("rejects a TemporaryRoot whose ancestor is a reparse point", ({ skip }) => {
    const outerRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-ancestor-reparse-"));
    const ancestorTarget = path.join(outerRoot, "ancestor-target");
    const linkedAncestor = path.join(outerRoot, "linked-ancestor");
    const probe = makeLaunchProbe(outerRoot, ["exit /b 17"]);

    mkdirSync(ancestorTarget);
    try {
      symlinkSync(ancestorTarget, linkedAncestor, "junction");
    } catch (error) {
      rmSync(outerRoot, { recursive: true, force: true });
      skip(`Windows could not create the ancestor junction: ${formatError(error)}`);
      return;
    }

    const temporaryRoot = path.join(linkedAncestor, "temporary-root");
    mkdirSync(temporaryRoot);

    try {
      expect(() => invokeInstallerSmoke({
        installerPath: probe.path,
        temporaryRoot,
        installDirectory: path.join(temporaryRoot, "Install")
      })).toThrow("TemporaryRoot ancestor is a reparse point");

      expect(existsSync(probe.markerPath)).toBe(false);
    } finally {
      unlinkJunctionIfPresent(linkedAncestor);
      rmSync(outerRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("rejects a dangling reparse component when PowerShell exposes it", ({ skip }) => {
    const outerRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-dangling-reparse-"));
    const temporaryRoot = path.join(outerRoot, "temporary-root");
    const missingTarget = path.join(outerRoot, "missing-target");
    const danglingComponent = path.join(temporaryRoot, "dangling-component");
    const probe = makeLaunchProbe(outerRoot, ["exit /b 17"]);

    mkdirSync(temporaryRoot);
    try {
      symlinkSync(missingTarget, danglingComponent, "junction");
    } catch (error) {
      rmSync(outerRoot, { recursive: true, force: true });
      skip(`Windows could not create the dangling junction: ${formatError(error)}`);
      return;
    }

    if (!canPowerShellExposeReparsePoint(danglingComponent)) {
      unlinkJunctionIfPresent(danglingComponent);
      rmSync(outerRoot, { recursive: true, force: true });
      skip("PowerShell Get-Item cannot expose dangling reparse points on this Windows host");
      return;
    }

    try {
      expect(() => invokeInstallerSmoke({
        installerPath: probe.path,
        temporaryRoot,
        installDirectory: path.join(danglingComponent, "Install")
      })).toThrow("Install path component is a reparse point");

      expect(existsSync(probe.markerPath)).toBe(false);
    } finally {
      unlinkJunctionIfPresent(danglingComponent);
      rmSync(outerRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("removes a leftover junction without recursing into its target", () => {
    const outerRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-leftover-reparse-"));
    const temporaryRoot = path.join(outerRoot, "temporary-root");
    const outsideTarget = path.join(outerRoot, "outside-target");
    const targetSentinel = path.join(outsideTarget, "sentinel.txt");
    const installDirectory = path.join(temporaryRoot, "leftover-link");
    const probe = makeLaunchProbe(outerRoot, [
      `mklink /J "${installDirectory}" "${outsideTarget}" >nul`,
      "if errorlevel 1 exit /b 23",
      "exit /b 17"
    ]);

    mkdirSync(temporaryRoot);
    mkdirSync(outsideTarget);
    writeFileSync(targetSentinel, "unchanged", "utf8");

    try {
      expect(() => invokeInstallerSmoke({
        installerPath: probe.path,
        temporaryRoot,
        installDirectory
      })).toThrow("Reparse point remains after cleanup");

      expect(existsSync(installDirectory)).toBe(false);
      expect(readFileSync(targetSentinel, "utf8")).toBe("unchanged");
    } finally {
      unlinkJunctionIfPresent(installDirectory);
      rmSync(outerRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("removes a dangling leftover link without recursing", ({ skip }) => {
    const outerRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-dangling-leftover-"));
    const temporaryRoot = path.join(outerRoot, "temporary-root");
    const missingTarget = path.join(outerRoot, "missing-target");
    const capabilityLink = path.join(outerRoot, "capability-link");
    const installDirectory = path.join(temporaryRoot, "dangling-leftover");

    mkdirSync(temporaryRoot);
    try {
      symlinkSync(missingTarget, capabilityLink, "junction");
    } catch (error) {
      rmSync(outerRoot, { recursive: true, force: true });
      skip(`Windows could not create the dangling junction: ${formatError(error)}`);
      return;
    }

    if (!canPowerShellExposeReparsePoint(capabilityLink)) {
      unlinkJunctionIfPresent(capabilityLink);
      rmSync(outerRoot, { recursive: true, force: true });
      skip("PowerShell Get-Item cannot expose dangling reparse points on this Windows host");
      return;
    }
    unlinkJunctionIfPresent(capabilityLink);

    const probe = makeLaunchProbe(outerRoot, [
      `mklink /J "${installDirectory}" "${missingTarget}" >nul`,
      "if errorlevel 1 exit /b 23",
      "exit /b 17"
    ]);

    try {
      expect(() => invokeInstallerSmoke({
        installerPath: probe.path,
        temporaryRoot,
        installDirectory
      })).toThrow("Reparse point remains after cleanup");

      expect(pathExistsByLstat(installDirectory)).toBe(false);
    } finally {
      unlinkJunctionIfPresent(installDirectory);
      rmSync(outerRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("refuses a preexisting likely default install directory", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-default-preflight-"));
    const productName = `Gemini OAuth Switcher Smoke ${randomUUID()}`;
    const likelyDefaultDirectory = getLikelyDefaultInstallDirectory(productName);
    const sentinelPath = path.join(likelyDefaultDirectory, "sentinel.txt");
    const probe = makeLaunchProbe(temporaryRoot, ["exit /b 17"]);

    mkdirSync(likelyDefaultDirectory, { recursive: true });
    writeFileSync(sentinelPath, "unchanged", "utf8");

    try {
      expect(() => invokeInstallerSmoke({
        installerPath: probe.path,
        temporaryRoot,
        installDirectory: path.join(temporaryRoot, "Install"),
        productName
      })).toThrow("Likely default install directory already exists");

      expect(existsSync(probe.markerPath)).toBe(false);
      expect(readFileSync(sentinelPath, "utf8")).toBe("unchanged");
    } finally {
      rmSync(likelyDefaultDirectory, { recursive: true, force: true });
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("honors ExpectedDefaultInstallDirectory during preflight", () => {
    const outerRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-explicit-default-"));
    const temporaryRoot = path.join(outerRoot, "temporary-root");
    const expectedDefaultInstallDirectory = path.join(outerRoot, "explicit-default");
    const sentinelPath = path.join(expectedDefaultInstallDirectory, "sentinel.txt");
    const probe = makeLaunchProbe(outerRoot, ["exit /b 17"]);

    mkdirSync(temporaryRoot);
    mkdirSync(expectedDefaultInstallDirectory);
    writeFileSync(sentinelPath, "unchanged", "utf8");

    try {
      expect(() => invokeInstallerSmoke({
        installerPath: probe.path,
        temporaryRoot,
        installDirectory: path.join(temporaryRoot, "Install"),
        expectedDefaultInstallDirectory
      })).toThrow("Likely default install directory already exists");

      expect(existsSync(probe.markerPath)).toBe(false);
      expect(readFileSync(sentinelPath, "utf8")).toBe("unchanged");
    } finally {
      rmSync(outerRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("reports a likely default directory created by a partial install", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "gemini-switcher-default-leftover-"));
    const productName = `Gemini OAuth Switcher Smoke ${randomUUID()}`;
    const likelyDefaultDirectory = getLikelyDefaultInstallDirectory(productName);
    const sentinelPath = path.join(likelyDefaultDirectory, "sentinel.txt");
    const probe = makeLaunchProbe(temporaryRoot, [
      `mkdir "${likelyDefaultDirectory}"`,
      `> "${sentinelPath}" echo leftover`,
      "exit /b 17"
    ]);

    try {
      expect(() => invokeInstallerSmoke({
        installerPath: probe.path,
        temporaryRoot,
        installDirectory: path.join(temporaryRoot, "Requested Install"),
        productName
      })).toThrow(`Likely default install directory remains after cleanup: ${likelyDefaultDirectory}`);

      expect(readFileSync(sentinelPath, "utf8").trim()).toBe("leftover");
    } finally {
      rmSync(likelyDefaultDirectory, { recursive: true, force: true });
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("documents optional signing and the Windows warning shown for unsigned builds", () => {
    const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");

    expect(readme).toContain("代码签名是可选的");
    expect(readme).toContain("Windows SmartScreen");
  });

  it("documents repeatable clean-install, upgrade, and failure-recovery checks", () => {
    const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");
    const smokeTest = readFileSync(path.join(process.cwd(), "docs", "release-smoke-test.md"), "utf8");

    expect(readme).toContain("docs/release-smoke-test.md");
    expect(smokeTest).toContain("干净安装");
    expect(smokeTest).toContain("覆盖升级");
    expect(smokeTest).toContain("设置损坏恢复");
    expect(smokeTest).toContain("pnpm verify:windows-artifacts");
    expect(smokeTest).toContain("不会修改任何账号凭据");
  });

  it("verifies installer, portable, blockmap, and update metadata as one release set", () => {
    const releaseDir = makeFakeReleaseDirectory();
    const scriptPath = path.join(process.cwd(), "scripts", "verify-windows-artifacts.mjs");

    try {
      const output = execFileSync(process.execPath, [
        scriptPath,
        "--release-dir",
        releaseDir,
        "--minimum-exe-bytes",
        "2"
      ], {
        cwd: process.cwd(),
        encoding: "utf8"
      });

      expect(output).toContain("Verified Windows artifacts for");
      expect(output).toContain("setup-x64.exe");
      expect(output).toContain("portable-x64.exe");
    } finally {
      rmSync(releaseDir, { recursive: true, force: true });
    }
  });

  it("rejects update metadata that points at a stale installer", () => {
    const releaseDir = makeFakeReleaseDirectory({ latestInstaller: "Gemini-OAuth-Switcher-0.0.0-setup-x64.exe" });
    const scriptPath = path.join(process.cwd(), "scripts", "verify-windows-artifacts.mjs");

    try {
      expect(() => execFileSync(process.execPath, [
        scriptPath,
        "--release-dir",
        releaseDir,
        "--minimum-exe-bytes",
        "2"
      ], {
        cwd: process.cwd(),
        stdio: "pipe"
      })).toThrow();
    } finally {
      rmSync(releaseDir, { recursive: true, force: true });
    }
  });

  it("resolves the default release directory from a file URL on Windows", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts", "verify-windows-artifacts.mjs"), "utf8");

    expect(script).toContain("fileURLToPath(new URL(\"../release\", import.meta.url))");
  });

  it("exposes the Windows artifact verifier as a package script", () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:windows-artifacts"]).toBe("node scripts/verify-windows-artifacts.mjs");
  });
});

function makeFakeReleaseDirectory(options: { latestInstaller?: string } = {}): string {
  const releaseDir = mkdtempSync(path.join(tmpdir(), "gemini-switcher-release-"));
  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };
  const installer = `Gemini-OAuth-Switcher-${packageJson.version}-setup-x64.exe`;
  const portable = `Gemini-OAuth-Switcher-${packageJson.version}-portable-x64.exe`;
  const blockmap = `${installer}.blockmap`;
  const executable = Buffer.from([0x4d, 0x5a]);

  writeFileSync(path.join(releaseDir, installer), executable);
  writeFileSync(path.join(releaseDir, portable), executable);
  writeFileSync(path.join(releaseDir, blockmap), "blockmap");
  writeFileSync(path.join(releaseDir, "latest.yml"), [
    `version: ${packageJson.version}`,
    "files:",
    `  - url: ${options.latestInstaller ?? installer}`,
    `    sha512: ${"A".repeat(88)}`,
    "    size: 2",
    `path: ${options.latestInstaller ?? installer}`,
    `sha512: ${"A".repeat(88)}`,
    "releaseDate: '2026-07-15T00:00:00.000Z'",
    ""
  ].join("\n"), "utf8");

  return releaseDir;
}

interface InstallerSmokeOptions {
  installerPath: string;
  temporaryRoot: string;
  installDirectory: string;
  productName?: string;
  expectedDefaultInstallDirectory?: string;
  processTimeoutSeconds?: number;
}

function invokeInstallerSmoke(options: InstallerSmokeOptions): void {
  const productName = options.productName ?? `Gemini OAuth Switcher Smoke ${randomUUID()}`;
  const scriptPath = path.join(process.cwd(), "scripts", "smoke-test-windows-installer.ps1");
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-File",
    scriptPath,
    "-InstallerPath",
    options.installerPath,
    "-TemporaryRoot",
    options.temporaryRoot,
    "-InstallDirectory",
    options.installDirectory,
    "-ProductName",
    productName,
    "-ExecutableName",
    `${productName}.exe`,
    "-UninstallerName",
    `Uninstall ${productName}.exe`,
    "-ShortcutName",
    productName
  ];

  if (options.expectedDefaultInstallDirectory !== undefined) {
    args.push("-ExpectedDefaultInstallDirectory", options.expectedDefaultInstallDirectory);
  }

  if (options.processTimeoutSeconds !== undefined) {
    args.push("-ProcessTimeoutSeconds", String(options.processTimeoutSeconds));
  }

  try {
    execFileSync("pwsh.exe", args, {
      cwd: process.cwd(),
      stdio: "pipe",
      timeout: 15_000,
      windowsHide: true
    });
  } catch (error) {
    const failure = error as Error & { stderr?: Buffer | string; stdout?: Buffer | string };
    const output = [failure.message, failure.stdout?.toString(), failure.stderr?.toString()]
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .replace(/\s*\|\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    throw new Error(output);
  }
}

function makeLaunchProbe(directory: string, commands: string[]): { path: string; markerPath: string } {
  const id = randomUUID();
  const probePath = path.join(directory, `installer-probe-${id}.cmd`);
  const markerPath = path.join(directory, `launch-marker-${id}.txt`);

  writeFileSync(probePath, [
    "@echo off",
    `> "${markerPath}" echo launched`,
    ...commands,
    ""
  ].join("\r\n"), "utf8");

  return { path: probePath, markerPath };
}

function unlinkJunctionIfPresent(junctionPath: string): void {
  if (pathExistsByLstat(junctionPath) && lstatSync(junctionPath).isSymbolicLink()) {
    unlinkSync(junctionPath);
  }
}

function pathExistsByLstat(itemPath: string): boolean {
  try {
    lstatSync(itemPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function canPowerShellExposeReparsePoint(itemPath: string): boolean {
  const escapedPath = itemPath.replace(/'/g, "''");
  const command = [
    `$item = Get-Item -LiteralPath '${escapedPath}' -Force -ErrorAction SilentlyContinue`,
    "if ($null -eq $item) { exit 1 }",
    "if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) { exit 2 }"
  ].join("; ");

  try {
    execFileSync("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      stdio: "pipe",
      timeout: 5_000,
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getLikelyDefaultInstallDirectory(productName: string): string {
  if (!process.env.LOCALAPPDATA) {
    throw new Error("LOCALAPPDATA is required for Windows installer tests");
  }

  return path.join(process.env.LOCALAPPDATA, "Programs", productName);
}
