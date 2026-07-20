import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRendererFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), "src", "renderer", relativePath), "utf8");
}

describe("main layout contracts", () => {
  it("fixes the top strip and scopes scrolling to the content region", () => {
    const app = readRendererFile("App.tsx");

    expect(app).toContain("flex h-screen flex-col overflow-hidden");
    expect(app).toContain("app-scroll-region");
    expect(app.indexOf("app-header")).toBeLessThan(app.indexOf("app-scroll-region"));
    expect(app).not.toContain("min-h-[calc(100vh-2.25rem)]");
  });

  it("keeps modal dialogs outside the scroll region so inert still covers the header", () => {
    const app = readRendererFile("App.tsx");

    expect(app.indexOf("app-scroll-region")).toBeLessThan(app.indexOf("<SettingsDialog"));
  });

  it("declares the scroll region in styles with contained overscroll", () => {
    const styles = readRendererFile("styles.css");

    expect(styles).toContain(".app-scroll-region");
    expect(styles).toContain("overscroll-behavior: contain");
  });
});
