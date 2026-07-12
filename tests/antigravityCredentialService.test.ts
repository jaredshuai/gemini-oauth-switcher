import { randomUUID } from "node:crypto";
import koffi from "koffi";
import { describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET,
  createAntigravityCredentialStore,
  nativeAntigravityCredentialStore,
  type WinCredentialBindings
} from "../src/main/antigravityCredentialService";

function createMemoryBindings(): WinCredentialBindings & {
  entries: Map<string, Buffer>;
  writes: Array<{ target: string; username: string }>;
} {
  const entries = new Map<string, Buffer>();
  const writes: Array<{ target: string; username: string }> = [];
  return {
    entries,
    writes,
    read(target) {
      const payload = entries.get(target);
      return payload ? Buffer.from(payload) : undefined;
    },
    write(target, username, payload) {
      writes.push({ target, username });
      entries.set(target, Buffer.from(payload));
    },
    delete(target) {
      entries.delete(target);
    }
  };
}

describe("antigravityCredentialService", () => {
  it("round-trips Antigravity UTF-8 JSON without changing its bytes", async () => {
    const bindings = createMemoryBindings();
    const store = createAntigravityCredentialStore(bindings);
    const payload = JSON.stringify({ email: "用户@example.com", refresh_token: "redacted" });

    await store.set(ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET, payload);

    await expect(store.get(ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET)).resolves.toBe(payload);
    expect(bindings.entries.get(ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET)).toEqual(Buffer.from(payload, "utf8"));
    expect(bindings.writes).toEqual([
      { target: ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET, username: "antigravity" }
    ]);
  });

  it("uses an app-owned username for profile credentials and deletes them idempotently", async () => {
    const bindings = createMemoryBindings();
    const store = createAntigravityCredentialStore(bindings);
    const target = "gemini-oauth-switcher:antigravity-cli:test";

    await store.set(target, "{\"token\":\"redacted\"}");
    await store.delete(target);
    await store.delete(target);

    expect(bindings.writes).toEqual([{ target, username: "antigravity-cli" }]);
    await expect(store.get(target)).resolves.toBeUndefined();
  });

  it("rejects empty credential payloads", async () => {
    const store = createAntigravityCredentialStore(createMemoryBindings());

    await expect(store.set("gemini-oauth-switcher:test", "")).rejects.toThrow(/payload is empty/);
  });

  it.runIf(process.platform === "win32")("round-trips a disposable Windows Credential Manager entry", async () => {
    const target = `gemini-oauth-switcher:test:${randomUUID()}`;
    const payload = JSON.stringify({ test: true, nonce: randomUUID() });

    try {
      await nativeAntigravityCredentialStore.set(target, payload);
      await expect(nativeAntigravityCredentialStore.get(target)).resolves.toBe(payload);
      expect(readWindowsCredentialPersist(target)).toBe(2);
    } finally {
      await nativeAntigravityCredentialStore.delete(target);
    }

    await expect(nativeAntigravityCredentialStore.get(target)).resolves.toBeUndefined();
  });
});

function readWindowsCredentialPersist(target: string): number {
  const fileTime = koffi.struct(`TestFILETIME${randomUUID().replaceAll("-", "")}`, {
    dwLowDateTime: "uint32_t",
    dwHighDateTime: "uint32_t"
  });
  const credentialName = `TestCREDENTIALW${randomUUID().replaceAll("-", "")}`;
  const credential = koffi.struct(credentialName, {
    Flags: "uint32_t",
    Type: "uint32_t",
    TargetName: "str16",
    Comment: "str16",
    LastWritten: fileTime,
    CredentialBlobSize: "uint32_t",
    CredentialBlob: "void *",
    Persist: "uint32_t",
    AttributeCount: "uint32_t",
    Attributes: "void *",
    TargetAlias: "str16",
    UserName: "str16"
  });
  const advapi32 = koffi.load("advapi32.dll");
  const credRead = advapi32.func(
    `bool __stdcall CredReadW(str16 target, uint32_t type, uint32_t flags, _Out_ ${credentialName} **credential)`
  );
  const credFree = advapi32.func("void __stdcall CredFree(void *buffer)");
  const output: unknown[] = [null];
  if (!credRead(target, 1, 0, output)) {
    throw new Error(`Test credential was not found: ${target}`);
  }

  try {
    return (koffi.decode(output[0], credential) as { Persist: number }).Persist;
  } finally {
    credFree(output[0]);
  }
}
