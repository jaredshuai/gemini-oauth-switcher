import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiagnosticLogger } from "../src/main/diagnosticLogger";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("diagnosticLogger", () => {
  it("redacts credential-shaped keys, tokens, and account emails", async () => {
    const directory = await makeTempRoot();
    const logger = createDiagnosticLogger({ directory, now: () => 123 });

    await logger.error("renderer.failure", {
      accessToken: "secret-access-token",
      message: "refresh_token=embedded-secret Authorization: Bearer eyJhbGciOi.secret.signature for user@example.com",
      safeCode: -105
    });

    const contents = await readFile(path.join(directory, "diagnostics.log"), "utf8");
    expect(contents).toContain('"event":"renderer.failure"');
    expect(contents).toContain('"safeCode":-105');
    expect(contents).toContain("[REDACTED]");
    expect(contents).toContain("[REDACTED_EMAIL]");
    expect(contents).not.toContain("secret-access-token");
    expect(contents).not.toContain("embedded-secret");
    expect(contents).not.toContain("eyJhbGciOi.secret.signature");
    expect(contents).not.toContain("user@example.com");
  });

  it("rotates to a fixed number of bounded files", async () => {
    const directory = await makeTempRoot();
    const logger = createDiagnosticLogger({
      directory,
      maxBytes: 320,
      maxFiles: 3,
      now: () => 123
    });

    for (let index = 0; index < 30; index += 1) {
      await logger.info("rotation.test", { index, detail: "x".repeat(48) });
    }
    await logger.flush();

    const files = (await readdir(directory)).filter((name) => name.startsWith("diagnostics.log"));
    const sizes = await Promise.all(files.map(async (name) => (await stat(path.join(directory, name))).size));

    expect(files.sort()).toEqual(["diagnostics.log", "diagnostics.log.1", "diagnostics.log.2"]);
    expect(sizes.every((size) => size <= 420)).toBe(true);
  });

  it("serializes concurrent writes in call order", async () => {
    const directory = await makeTempRoot();
    const logger = createDiagnosticLogger({ directory, now: () => 123 });

    await Promise.all([
      logger.info("ordered", { sequence: 1 }),
      logger.info("ordered", { sequence: 2 }),
      logger.info("ordered", { sequence: 3 })
    ]);

    const lines = (await readFile(path.join(directory, "diagnostics.log"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { metadata: { sequence: number } });
    expect(lines.map((line) => line.metadata.sequence)).toEqual([1, 2, 3]);
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gemini-switcher-diagnostics-"));
  tempRoots.push(root);
  return root;
}
