import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveInstalledAntigravityOAuthClients } from "../src/main/antigravityOAuthClientService";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("antigravityOAuthClientService", () => {
  it("extracts installed-app OAuth client candidates from an Agy binary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gemini-oauth-switcher-agy-client-"));
    tempRoots.push(root);
    const binaryPath = path.join(root, "agy.exe");
    const clientId = ["123456789012", "-", "abcdefghijklmnopqrstuvwxyz", ".apps.googleusercontent.com"].join("");
    const secondClientId = ["987654321098", "-", "zyxwvutsrqponmlkjihgfedcba", ".apps.googleusercontent.com"].join("");
    const clientSecret = ["GOC", "SPX-", "abcdefghijklmnopqrstuvwx1234"].join("");
    const secondClientSecret = ["GOC", "SPX-", "4321xwvutsrqponmlkjihgfedcba"].join("");
    await writeFile(binaryPath, Buffer.from(`prefix${clientId}middle${secondClientId}suffix${clientSecret}${secondClientSecret}`));

    const clients = await resolveInstalledAntigravityOAuthClients({ binaryPaths: [binaryPath] });

    expect(clients).toEqual([
      { clientId, clientSecret },
      { clientId, clientSecret: secondClientSecret },
      { clientId: secondClientId, clientSecret },
      { clientId: secondClientId, clientSecret: secondClientSecret }
    ]);
  });
});
