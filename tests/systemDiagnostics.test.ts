import { describe, expect, it } from "vitest";
import { collectLocalDiagnostics } from "../src/main/systemDiagnostics";

describe("systemDiagnostics", () => {
  it("reports environment risks by variable name and checks whether gemini is on PATH", async () => {
    const result = await collectLocalDiagnostics({
      env: {
        GOOGLE_API_KEY: "secret-api-key",
        GEMINI_CLI_HOME: "C:\\Users\\jared\\.gemini-homes\\work",
        GOOGLE_VERTEX_BASE_URL: "https://example.invalid",
        SAFE_VARIABLE: "ignored"
      },
      resolveGeminiCommand: async () => "C:\\Users\\jared\\AppData\\Roaming\\npm\\gemini.cmd",
      now: () => 123456
    });

    expect(result.envRisks).toEqual(["GEMINI_CLI_HOME", "GOOGLE_API_KEY", "GOOGLE_VERTEX_BASE_URL"]);
    expect(result.envRisks).not.toContain("secret-api-key");
    expect(result.geminiCommand).toEqual({
      available: true,
      path: "C:\\Users\\jared\\AppData\\Roaming\\npm\\gemini.cmd"
    });
    expect(result.checkedAt).toBe(123456);
  });

  it("marks gemini as unavailable when the command cannot be resolved", async () => {
    const result = await collectLocalDiagnostics({
      env: {},
      resolveGeminiCommand: async () => undefined,
      now: () => 1
    });

    expect(result.envRisks).toEqual([]);
    expect(result.geminiCommand).toEqual({ available: false });
  });
});
