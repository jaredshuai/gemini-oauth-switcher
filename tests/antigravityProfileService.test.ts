import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CredentialStore } from "../src/main/antigravityCredentialService";
import {
  deleteAntigravityProfile,
  listAntigravityProfiles,
  registerCurrentAntigravityProfile,
  switchAntigravityProfile,
  type AntigravityProfileRecord
} from "../src/main/antigravityProfileService";

function createMemoryCredentialStore(initialEntries: Record<string, string> = {}): CredentialStore & { entries: Map<string, string> } {
  const entries = new Map(Object.entries(initialEntries));
  return {
    entries,
    async get(target) {
      return entries.get(target);
    },
    async set(target, payload) {
      entries.set(target, payload);
    },
    async delete(target) {
      entries.delete(target);
    }
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function agyCredential(accessToken: string, refreshToken: string, expiry: string): string {
  return JSON.stringify({
    token: {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expiry
    },
    auth_method: "consumer"
  });
}

const profiles: AntigravityProfileRecord[] = [
  {
    id: "agy-alice",
    name: "alice@example.com",
    accountEmail: "alice@example.com",
    createdAt: 100,
    updatedAt: 200
  },
  {
    id: "agy-bob",
    name: "bob@example.com",
    accountEmail: "bob@example.com",
    createdAt: 300,
    updatedAt: 400
  }
];

describe("antigravityProfileService", () => {
  it("lists only registered Antigravity accounts and matches the official credential", async () => {
    const store = createMemoryCredentialStore({
      "gemini-oauth-switcher:antigravity-cli:agy-alice": "alice-secret",
      "gemini-oauth-switcher:antigravity-cli:agy-bob": "bob-secret",
      "gemini:antigravity": "bob-secret"
    });

    const result = await listAntigravityProfiles({ profiles, credentialStore: store });

    expect(result.profilesRoot).toBe("");
    expect(result.targetOAuthPath).toBe("gemini:antigravity");
    expect(result.profiles).toEqual([
      expect.objectContaining({ id: "agy-alice", name: "alice@example.com", exists: true, isCurrent: false }),
      expect.objectContaining({ id: "agy-bob", name: "bob@example.com", exists: true, isCurrent: true })
    ]);
    expect(result.profiles.every((profile) => profile.profilePath === "" && profile.oauthPath === "")).toBe(true);
  });

  it("switches a registered account through Credential Manager and verifies the hash", async () => {
    const store = createMemoryCredentialStore({
      "gemini-oauth-switcher:antigravity-cli:agy-alice": "alice-secret",
      "gemini:antigravity": "old-secret"
    });

    const result = await switchAntigravityProfile({ profileId: "agy-alice", profiles, credentialStore: store });

    expect(store.entries.get("gemini:antigravity")).toBe("alice-secret");
    expect(result.profileName).toBe("alice@example.com");
    expect(result.sourceHash).toBe(sha256("alice-secret"));
    expect(result.targetHash).toBe(sha256("alice-secret"));
  });

  it("keeps the current account matched after agy refreshes its access token", async () => {
    const store = createMemoryCredentialStore({
      "gemini-oauth-switcher:antigravity-cli:agy-alice": agyCredential("old-access", "stable-refresh", "2026-01-01"),
      "gemini:antigravity": agyCredential("new-access", "stable-refresh", "2026-02-01")
    });

    const result = await listAntigravityProfiles({ profiles, credentialStore: store });

    expect(result.profiles.find((profile) => profile.id === "agy-alice")?.isCurrent).toBe(true);
    expect(store.entries.get("gemini-oauth-switcher:antigravity-cli:agy-alice")).toBe(
      store.entries.get("gemini:antigravity")
    );
  });

  it("registers the current official credential without creating a filesystem profile", async () => {
    const store = createMemoryCredentialStore({ "gemini:antigravity": "new-secret" });

    const result = await registerCurrentAntigravityProfile({
      profileId: "agy-new",
      name: "new@example.com",
      accountEmail: "new@example.com",
      profiles: [],
      credentialStore: store,
      now: () => 1234
    });

    expect(result.profile).toEqual({
      id: "agy-new",
      name: "new@example.com",
      accountEmail: "new@example.com",
      createdAt: 1234,
      updatedAt: 1234
    });
    expect(result.profiles).toEqual([result.profile]);
    expect(store.entries.get("gemini-oauth-switcher:antigravity-cli:agy-new")).toBe("new-secret");
  });

  it("rejects a duplicate account email instead of creating another entry", async () => {
    const store = createMemoryCredentialStore({ "gemini:antigravity": "new-secret" });

    await expect(
      registerCurrentAntigravityProfile({
        profileId: "agy-duplicate",
        name: "Alice copy",
        accountEmail: "ALICE@example.com",
        profiles,
        credentialStore: store
      })
    ).rejects.toThrow(/already exists/i);
  });

  it("rejects registering the same refresh credential twice when no email is available", async () => {
    const store = createMemoryCredentialStore({
      "gemini-oauth-switcher:antigravity-cli:agy-alice": agyCredential("old-access", "stable-refresh", "2026-01-01"),
      "gemini:antigravity": agyCredential("new-access", "stable-refresh", "2026-02-01")
    });

    await expect(
      registerCurrentAntigravityProfile({
        profileId: "agy-copy",
        name: "different-generated-name",
        profiles,
        credentialStore: store
      })
    ).rejects.toThrow(/already exists/i);
  });

  it("deletes a non-current Agy account without touching other credentials", async () => {
    const store = createMemoryCredentialStore({
      "gemini-oauth-switcher:antigravity-cli:agy-alice": "alice-secret",
      "gemini-oauth-switcher:antigravity-cli:agy-bob": "bob-secret",
      "gemini:antigravity": "bob-secret"
    });

    const result = await deleteAntigravityProfile({ profileId: "agy-alice", profiles, credentialStore: store });

    expect(result.profile.name).toBe("alice@example.com");
    expect(result.profiles.map((profile) => profile.id)).toEqual(["agy-bob"]);
    expect(store.entries.has("gemini-oauth-switcher:antigravity-cli:agy-alice")).toBe(false);
    expect(store.entries.get("gemini-oauth-switcher:antigravity-cli:agy-bob")).toBe("bob-secret");
    expect(store.entries.get("gemini:antigravity")).toBe("bob-secret");
  });

  it("does not delete the currently active Agy account", async () => {
    const store = createMemoryCredentialStore({
      "gemini-oauth-switcher:antigravity-cli:agy-bob": "bob-secret",
      "gemini:antigravity": "bob-secret"
    });

    await expect(deleteAntigravityProfile({ profileId: "agy-bob", profiles, credentialStore: store })).rejects.toThrow(
      /current profile/i
    );
  });

  it("does not delete the current account after its access token was refreshed", async () => {
    const store = createMemoryCredentialStore({
      "gemini-oauth-switcher:antigravity-cli:agy-alice": agyCredential("old-access", "stable-refresh", "2026-01-01"),
      "gemini:antigravity": agyCredential("new-access", "stable-refresh", "2026-02-01")
    });

    await expect(deleteAntigravityProfile({ profileId: "agy-alice", profiles, credentialStore: store })).rejects.toThrow(
      /current profile/i
    );
  });
});
