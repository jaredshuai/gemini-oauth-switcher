import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function rendererSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return rendererSourceFiles(entryPath);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe("Electron security boundaries", () => {
  it("keeps Node and Electron imports out of the renderer", () => {
    const rendererRoot = path.join(process.cwd(), "src", "renderer");

    for (const filePath of rendererSourceFiles(rendererRoot)) {
      const source = readFileSync(filePath, "utf8");
      const fileLabel = path.relative(process.cwd(), filePath);
      const forbiddenModule = "(?:electron|node:[^\"']+|fs(?:/promises)?)";
      expect(source, fileLabel).not.toMatch(new RegExp(`\\bfrom\\s+["']${forbiddenModule}["']`));
      expect(source, fileLabel).not.toMatch(new RegExp(`\\bimport\\s*["']${forbiddenModule}["']`));
      expect(source, fileLabel).not.toMatch(new RegExp(`\\bimport\\s*\\(\\s*["']${forbiddenModule}["']`));
      expect(source, fileLabel).not.toMatch(new RegExp(`\\brequire\\s*\\(\\s*["']${forbiddenModule}["']`));
    }
  });

  it("runs the renderer with isolation, sandboxing, and Node integration disabled", () => {
    const mainSource = readFileSync(path.join(process.cwd(), "src", "main", "main.ts"), "utf8");

    expect(mainSource).toContain("contextIsolation: true");
    expect(mainSource).toContain("nodeIntegration: false");
    expect(mainSource).toContain("sandbox: true");
    expect(mainSource).not.toContain("webSecurity: false");
    expect(mainSource).not.toContain("allowRunningInsecureContent: true");
  });
});
