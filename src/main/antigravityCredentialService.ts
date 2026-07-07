import { createHash } from "node:crypto";
import { Entry } from "@napi-rs/keyring";

export const ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET = "gemini:antigravity";
const OFFICIAL_SERVICE = "gemini";
const OFFICIAL_USERNAME = "antigravity";
const APP_SERVICE = "gemini-oauth-switcher";
const APP_USERNAME = "antigravity-cli";

export interface CredentialStore {
  get(target: string): Promise<string | undefined>;
  set(target: string, payload: string): Promise<void>;
  delete(target: string): Promise<void>;
}

export const nativeAntigravityCredentialStore: CredentialStore = {
  async get(target) {
    const secret = getEntry(target).getSecret();
    return secret ? Buffer.from(secret).toString("utf8") : undefined;
  },
  async set(target, payload) {
    const entry = getEntry(target);
    try {
      entry.deleteCredential();
    } catch {
      // Missing previous credentials are fine.
    }
    entry.setSecret(Buffer.from(payload, "utf8"));
  },
  async delete(target) {
    try {
      getEntry(target).deleteCredential();
    } catch {
      // Missing credentials are fine.
    }
  }
};

export function getAntigravityProfileCredentialTarget(profilesRoot: string, profileName: string): string {
  const id = createHash("sha256").update(`${profilesRoot}\0${profileName}`).digest("hex").slice(0, 32);
  return `gemini-oauth-switcher:antigravity-cli:${id}`;
}

export function hashCredentialPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

function getEntry(target: string): Entry {
  if (target === ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET) {
    return Entry.withTarget(target, OFFICIAL_SERVICE, OFFICIAL_USERNAME);
  }

  return Entry.withTarget(target, APP_SERVICE, APP_USERNAME);
}
