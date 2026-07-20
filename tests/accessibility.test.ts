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
    for (const fileName of ["SettingsDialog.tsx", "NicknameDialog.tsx", "OAuthLoginDialog.tsx", "ConfirmDialog.tsx"]) {
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

  it("gives the primary action visual priority and keeps labels visible at the default width", () => {
    const app = readRendererFile("App.tsx");

    expect(app).toContain("primary-button");
    expect(app).not.toContain("min-[1180px]");
    expect(app).toContain("min-[900px]:inline");
    expect(app).toContain("Gauge");
    expect(app).not.toContain("Activity");
  });

  it("keeps the compact identity panel free of redundant confirmations", () => {
    const panel = readRendererFile(path.join("components", "CurrentAccountPanel.tsx"));

    expect(panel).not.toContain("状态正常");
    expect(panel).not.toContain("环境正常");
    expect(panel).toContain("lastSwitch && lastSwitchName ? (");
  });

  it("routes destructive confirmation through the app dialog system", () => {
    const app = readRendererFile("App.tsx");
    expect(app).not.toContain("window.confirm");
    expect(app).toContain("<ConfirmDialog");

    const dialog = readRendererFile(path.join("components", "ConfirmDialog.tsx"));
    expect(dialog).toContain("useModalBehavior");
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain("data-dialog-autofocus");
  });

  it("exposes the current target tool to assistive technology", () => {
    const source = readRendererFile(path.join("components", "TargetToolSwitch.tsx"));

    expect(source).toContain('role="group"');
    expect(source).toContain("当前为");
    expect(source).toContain('aria-current="true"');
  });

  it("keeps the page heading truthful instead of naming an action", () => {
    const app = readRendererFile("App.tsx");

    expect(app).toContain('<h1 className="sr-only">当前工具:');
  });

  it("treats partial usage-query failures as a warning, not an error", () => {
    const app = readRendererFile("App.tsx");

    expect(app).toContain('tone: failedCount > 0 ? "warning" : "success"');
    expect(app).toContain("失败账号已在列表中标出");
    expect(app).toContain("autoFade: true");
  });

  it("bounds every editable nickname field", () => {
    const nicknameDialog = readRendererFile(path.join("components", "NicknameDialog.tsx"));
    const oauthLoginDialog = readRendererFile(path.join("components", "OAuthLoginDialog.tsx"));

    expect(nicknameDialog).toContain("maxLength={160}");
    expect(oauthLoginDialog).toContain("maxLength={160}");
  });
});
