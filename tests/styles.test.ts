import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer styles", () => {
  it("replaces the native Windows scrollbar with a narrow themed scrollbar", () => {
    const styles = readFileSync(path.join(process.cwd(), "src", "renderer", "styles.css"), "utf8");

    expect(styles).toContain("--scrollbar-thumb-color");
    expect(styles).toContain(":root:has([data-theme=\"rpg-parchment\"])");
    expect(styles).toContain("*::-webkit-scrollbar");
    expect(styles).toContain("width: 10px");
    expect(styles).toContain("background-clip: padding-box");
    expect(styles).toContain("*::-webkit-scrollbar-button");
    expect(styles).toContain("*::-webkit-scrollbar-button:single-button");
    expect(styles).not.toContain("scrollbar-width: thin");
    expect(styles).not.toContain("scrollbar-color: var(--scrollbar-thumb-color) transparent");
  });
});
