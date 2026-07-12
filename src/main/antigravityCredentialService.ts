import { createHash } from "node:crypto";
import koffi from "koffi";

export const ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET = "gemini:antigravity";
const OFFICIAL_USERNAME = "antigravity";
const APP_USERNAME = "antigravity-cli";
const CREDENTIAL_TYPE_GENERIC = 1;
const CREDENTIAL_PERSIST_LOCAL_MACHINE = 2;
const ERROR_NOT_FOUND = 1168;

export interface CredentialStore {
  get(target: string): Promise<string | undefined>;
  set(target: string, payload: string): Promise<void>;
  delete(target: string): Promise<void>;
}

export interface WinCredentialBindings {
  read(target: string): Buffer | undefined;
  write(target: string, username: string, payload: Buffer): void;
  delete(target: string): void;
}

interface NativeCredentialRecord {
  CredentialBlobSize: number;
  CredentialBlob: unknown;
}

let nativeBindings: WinCredentialBindings | undefined;

export function createAntigravityCredentialStore(bindings: WinCredentialBindings): CredentialStore {
  return {
    async get(target) {
      const payload = bindings.read(target);
      return payload?.length ? payload.toString("utf8") : undefined;
    },
    async set(target, payload) {
      const bytes = Buffer.from(payload, "utf8");
      if (bytes.length === 0) {
        throw new Error(`Antigravity credential payload is empty for target: ${target}`);
      }

      bindings.write(target, getCredentialUsername(target), bytes);
    },
    async delete(target) {
      bindings.delete(target);
    }
  };
}

export const nativeAntigravityCredentialStore: CredentialStore = {
  get(target) {
    return getNativeCredentialStore().get(target);
  },
  set(target, payload) {
    return getNativeCredentialStore().set(target, payload);
  },
  delete(target) {
    return getNativeCredentialStore().delete(target);
  }
};

export function getAntigravityProfileCredentialTarget(profileId: string): string {
  return `gemini-oauth-switcher:antigravity-cli:${profileId}`;
}

export function getAntigravityLoginBackupCredentialTarget(profilesRoot: string, sessionId: string): string {
  const id = createHash("sha256").update(`${profilesRoot}\0pending-login\0${sessionId}`).digest("hex").slice(0, 32);
  return `gemini-oauth-switcher:antigravity-cli:pending:${id}`;
}

export function hashCredentialPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function hashCredentialIdentity(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { token?: { refresh_token?: unknown } };
    const refreshToken = parsed.token?.refresh_token;
    if (typeof refreshToken === "string" && refreshToken) {
      return createHash("sha256").update("refresh-token\0").update(refreshToken).digest("hex");
    }
  } catch {
    // Fall back to the full payload for unknown credential formats.
  }

  return hashCredentialPayload(payload);
}

function getNativeCredentialStore(): CredentialStore {
  nativeBindings ??= createNativeWinCredentialBindings();
  return createAntigravityCredentialStore(nativeBindings);
}

function createNativeWinCredentialBindings(): WinCredentialBindings {
  if (process.platform !== "win32") {
    throw new Error("Antigravity Credential Manager support is only available on Windows.");
  }

  const fileTime = koffi.struct("AntigravityFILETIME", {
    dwLowDateTime: "uint32_t",
    dwHighDateTime: "uint32_t"
  });
  const credential = koffi.struct("AntigravityCREDENTIALW", {
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
  const kernel32 = koffi.load("kernel32.dll");
  const credRead = advapi32.func(
    "bool __stdcall CredReadW(str16 target, uint32_t type, uint32_t flags, _Out_ AntigravityCREDENTIALW **credential)"
  );
  const credWrite = advapi32.func(
    "bool __stdcall CredWriteW(const AntigravityCREDENTIALW *credential, uint32_t flags)"
  );
  const credDelete = advapi32.func(
    "bool __stdcall CredDeleteW(str16 target, uint32_t type, uint32_t flags)"
  );
  const credFree = advapi32.func("void __stdcall CredFree(void *buffer)");
  const getLastError = kernel32.func("uint32_t __stdcall GetLastError()");

  return {
    read(target) {
      const output: unknown[] = [null];
      if (!credRead(target, CREDENTIAL_TYPE_GENERIC, 0, output)) {
        const errorCode = getLastError();
        if (errorCode === ERROR_NOT_FOUND) {
          return undefined;
        }
        throw createCredentialError("read", target, errorCode);
      }

      try {
        const value = koffi.decode(output[0], credential) as NativeCredentialRecord;
        if (!value.CredentialBlobSize) {
          return Buffer.alloc(0);
        }

        return Buffer.from(koffi.decode(value.CredentialBlob, "uint8_t", value.CredentialBlobSize));
      } finally {
        credFree(output[0]);
      }
    },
    write(target, username, payload) {
      const success = credWrite(
        {
          Flags: 0,
          Type: CREDENTIAL_TYPE_GENERIC,
          TargetName: target,
          Comment: null,
          LastWritten: { dwLowDateTime: 0, dwHighDateTime: 0 },
          CredentialBlobSize: payload.length,
          CredentialBlob: payload,
          Persist: CREDENTIAL_PERSIST_LOCAL_MACHINE,
          AttributeCount: 0,
          Attributes: null,
          TargetAlias: null,
          UserName: username
        },
        0
      );
      if (!success) {
        throw createCredentialError("write", target, getLastError());
      }
    },
    delete(target) {
      if (credDelete(target, CREDENTIAL_TYPE_GENERIC, 0)) {
        return;
      }

      const errorCode = getLastError();
      if (errorCode !== ERROR_NOT_FOUND) {
        throw createCredentialError("delete", target, errorCode);
      }
    }
  };
}

function getCredentialUsername(target: string): string {
  return target === ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET ? OFFICIAL_USERNAME : APP_USERNAME;
}

function createCredentialError(operation: string, target: string, errorCode: number): Error {
  return new Error(`Failed to ${operation} Windows credential ${target} (Win32 error ${errorCode}).`);
}
