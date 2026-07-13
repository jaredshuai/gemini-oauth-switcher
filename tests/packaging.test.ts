import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

describe("packaged renderer config", () => {
  it("uses relative asset paths so file:// packaged windows can load the app", () => {
    expect((viteConfig as { base?: string }).base).toBe("./");
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

  it("runs release version and Authenticode checks before publishing", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "windows-build.yml"), "utf8");

    expect(workflow).toContain("node scripts/verify-release-tag.mjs");
    expect(workflow).toContain("WINDOWS_CSC_LINK");
    expect(workflow).toContain("Get-AuthenticodeSignature");
  });
});
