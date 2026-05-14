import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

describe("packaged renderer config", () => {
  it("uses relative asset paths so file:// packaged windows can load the app", () => {
    expect((viteConfig as { base?: string }).base).toBe("./");
  });
});
