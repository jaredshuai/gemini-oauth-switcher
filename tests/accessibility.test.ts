import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRendererFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), "src", "renderer", relativePath), "utf8");
}

describe("renderer accessibility contracts", () => {
  it("announces asynchronous status changes", () => {
    const source = readRendererFile(path.join("components", "StatusBar.tsx"));

    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
  });

  it("uses shared focus containment for every modal", () => {
    for (const fileName of ["SettingsDialog.tsx", "NicknameDialog.tsx", "OAuthLoginDialog.tsx"]) {
      const source = readRendererFile(path.join("components", fileName));
      expect(source, fileName).toContain("useModalBehavior");
      expect(source, fileName).toContain("ref={dialogRef}");
    }

    const hook = readRendererFile(path.join("components", "useModalBehavior.ts"));
    expect(hook).toContain("element.inert = true");
    expect(hook).toContain('event.key === "Escape"');
    expect(hook).toContain('event.key !== "Tab"');
    expect(hook).toContain("previousFocus?.focus()");
  });

  it("blocks every settings close path during mutations and focuses the nickname input", () => {
    const settingsDialog = readRendererFile(path.join("components", "SettingsDialog.tsx"));
    expect(settingsDialog).toContain("const isBusy =");
    expect(settingsDialog).toContain("closeDisabled: isBusy");
    expect(settingsDialog).toContain('disabled={isBusy} aria-label="关闭设置"');

    const nicknameDialog = readRendererFile(path.join("components", "NicknameDialog.tsx"));
    expect(nicknameDialog).toContain("data-dialog-autofocus");
  });

  it("bounds every editable nickname field", () => {
    const nicknameDialog = readRendererFile(path.join("components", "NicknameDialog.tsx"));
    const oauthLoginDialog = readRendererFile(path.join("components", "OAuthLoginDialog.tsx"));

    expect(nicknameDialog).toContain("maxLength={160}");
    expect(oauthLoginDialog).toContain("maxLength={160}");
  });
});
