import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    expect(workflow).not.toContain("Refusing to publish unsigned release binaries");
  });

  it("documents optional signing and the Windows warning shown for unsigned builds", () => {
    const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");

    expect(readme).toContain("代码签名是可选的");
    expect(readme).toContain("Windows SmartScreen");
  });
});
