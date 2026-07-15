import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
