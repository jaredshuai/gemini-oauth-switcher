import { readFile, stat } from "node:fs/promises";
import type { CredentialStatus, ProfileUsageResult, UsageTier } from "../shared/types";

const GEMINI_OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
// Installed-app OAuth clients ship their client secret in the desktop app; this is not a user credential.
const GEMINI_OAUTH_CLIENT_SECRET = "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";

const LOAD_CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const RETRIEVE_USER_QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const TIER_GEMINI_PRO = "gemini_pro";
const TIER_GEMINI_FLASH = "gemini_flash";
const TIER_GEMINI_FLASH_LITE = "gemini_flash_lite";

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<ResponseLike>;

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface QueryUsageOptions {
  profileName: string;
  oauthPath: string;
  fetchImpl?: FetchLike;
  nowMs?: () => number;
}

interface GeminiOAuthCredsFile {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
}

interface ParsedGeminiCredentials {
  accessToken?: string;
  refreshToken?: string;
  status: CredentialStatus;
  message?: string;
}

export async function queryGeminiUsageFromOAuthFile(options: QueryUsageOptions): Promise<ProfileUsageResult> {
  const nowMs = options.nowMs ?? Date.now;
  const fetchImpl = options.fetchImpl ?? createTimeoutFetch(10_000);
  const credentials = await readGeminiCredentials(options.oauthPath, nowMs);

  if (credentials.status === "not_found") {
    return makeResult(options.profileName, false, "not_found", [], undefined, undefined);
  }

  if (credentials.status === "parse_error") {
    return makeResult(options.profileName, false, "parse_error", [], credentials.message, nowMs());
  }

  if (credentials.status === "expired" && credentials.refreshToken) {
    const refreshedToken = await refreshGeminiToken(credentials.refreshToken, fetchImpl);
    if (refreshedToken) {
      return queryGeminiQuota(options.profileName, refreshedToken, fetchImpl, nowMs);
    }
  }

  if (credentials.accessToken) {
    const result = await queryGeminiQuota(options.profileName, credentials.accessToken, fetchImpl, nowMs);
    if (credentials.status !== "expired" || result.success) {
      return result;
    }
  }

  if (credentials.status === "expired") {
    return makeResult(
      options.profileName,
      false,
      "expired",
      [],
      credentials.message ?? "Gemini OAuth access token is missing or expired.",
      nowMs()
    );
  }

  return makeResult(
    options.profileName,
    false,
    credentials.status,
    [],
    credentials.message ?? "Gemini OAuth access token is missing or expired.",
    nowMs()
  );
}

async function readGeminiCredentials(oauthPath: string, nowMs: () => number): Promise<ParsedGeminiCredentials> {
  try {
    const oauthStat = await stat(oauthPath);
    if (!oauthStat.isFile()) {
      return { status: "not_found" };
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return { status: "not_found" };
    }
    return { status: "parse_error", message: `Unable to read OAuth file metadata: ${getErrorMessage(error)}` };
  }

  let parsed: GeminiOAuthCredsFile;
  try {
    parsed = JSON.parse(await readFile(oauthPath, "utf8")) as GeminiOAuthCredsFile;
  } catch (error) {
    return { status: "parse_error", message: `Failed to parse Gemini OAuth file: ${getErrorMessage(error)}` };
  }

  if (!parsed.access_token?.trim()) {
    return {
      refreshToken: parsed.refresh_token,
      status: "parse_error",
      message: "Gemini OAuth access_token is missing."
    };
  }

  if (typeof parsed.expiry_date === "number" && parsed.expiry_date < nowMs()) {
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      status: "expired",
      message: "Gemini OAuth access token has expired."
    };
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    status: "valid"
  };
}

async function refreshGeminiToken(refreshToken: string, fetchImpl: FetchLike): Promise<string | undefined> {
  const body = new URLSearchParams({
    client_id: GEMINI_OAUTH_CLIENT_ID,
    client_secret: GEMINI_OAUTH_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    body: body.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    }
  }).catch(() => undefined);

  if (!response?.ok) {
    return undefined;
  }

  const data = (await response.json()) as { access_token?: unknown };
  return typeof data.access_token === "string" && data.access_token.trim() ? data.access_token : undefined;
}

async function queryGeminiQuota(
  profileName: string,
  accessToken: string,
  fetchImpl: FetchLike,
  nowMs: () => number
): Promise<ProfileUsageResult> {
  let loadResponse: ResponseLike;
  try {
    loadResponse = await fetchImpl(LOAD_CODE_ASSIST_URL, {
      method: "POST",
      headers: quotaHeaders(accessToken),
      body: JSON.stringify({
        metadata: {
          ideType: "GEMINI_CLI",
          pluginType: "GEMINI"
        }
      })
    });
  } catch (error) {
    return makeResult(profileName, false, "valid", [], `Network error (loadCodeAssist): ${getErrorMessage(error)}`, nowMs());
  }

  if (loadResponse.status === 401 || loadResponse.status === 403) {
    return makeResult(profileName, false, "expired", [], `Authentication failed (HTTP ${loadResponse.status}).`, nowMs());
  }
  if (!loadResponse.ok) {
    return makeResult(
      profileName,
      false,
      "valid",
      [],
      `loadCodeAssist failed (HTTP ${loadResponse.status}): ${await safeResponseMessage(loadResponse)}`,
      nowMs()
    );
  }

  let loadBody: { cloudaicompanionProject?: unknown };
  try {
    loadBody = (await loadResponse.json()) as { cloudaicompanionProject?: unknown };
  } catch (error) {
    return makeResult(profileName, false, "valid", [], `Failed to parse loadCodeAssist response: ${getErrorMessage(error)}`, nowMs());
  }
  const projectId = extractProjectId(loadBody.cloudaicompanionProject);
  const quotaBody = projectId ? { project: projectId } : {};

  let quotaResponse: ResponseLike;
  try {
    quotaResponse = await fetchImpl(RETRIEVE_USER_QUOTA_URL, {
      method: "POST",
      headers: quotaHeaders(accessToken),
      body: JSON.stringify(quotaBody)
    });
  } catch (error) {
    return makeResult(profileName, false, "valid", [], `Network error (retrieveUserQuota): ${getErrorMessage(error)}`, nowMs());
  }

  if (quotaResponse.status === 401 || quotaResponse.status === 403) {
    return makeResult(profileName, false, "expired", [], `Authentication failed (HTTP ${quotaResponse.status}).`, nowMs());
  }
  if (!quotaResponse.ok) {
    return makeResult(
      profileName,
      false,
      "valid",
      [],
      `retrieveUserQuota failed (HTTP ${quotaResponse.status}): ${await safeResponseMessage(quotaResponse)}`,
      nowMs()
    );
  }

  let quotaData: { buckets?: unknown };
  try {
    quotaData = (await quotaResponse.json()) as { buckets?: unknown };
  } catch (error) {
    return makeResult(profileName, false, "valid", [], `Failed to parse quota response: ${getErrorMessage(error)}`, nowMs());
  }
  const tiers = mapGeminiQuotaBuckets(quotaData.buckets);

  return makeResult(profileName, true, "valid", tiers, undefined, nowMs());
}

function createTimeoutFetch(timeoutMs: number): FetchLike {
  return async (url, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await globalThis.fetch(url, {
        ...init,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

function mapGeminiQuotaBuckets(bucketsValue: unknown): UsageTier[] {
  if (!Array.isArray(bucketsValue)) {
    return [];
  }

  const categoryMap = new Map<string, { remaining: number; resetsAt?: string }>();

  for (const bucket of bucketsValue) {
    if (!bucket || typeof bucket !== "object") {
      continue;
    }

    const raw = bucket as { modelId?: unknown; remainingFraction?: unknown; resetTime?: unknown };
    const modelId = typeof raw.modelId === "string" ? raw.modelId : "unknown";
    const category = classifyGeminiModel(modelId);
    const remaining = clamp01(typeof raw.remainingFraction === "number" ? raw.remainingFraction : 1);
    const resetsAt = typeof raw.resetTime === "string" ? raw.resetTime : undefined;
    const existing = categoryMap.get(category);

    if (!existing || remaining < existing.remaining) {
      categoryMap.set(category, { remaining, resetsAt });
    }
  }

  return Array.from(categoryMap.entries())
    .map(([name, value]) => ({
      name,
      label: usageTierLabel(name),
      utilization: roundPercent((1 - value.remaining) * 100),
      resetsAt: value.resetsAt
    }))
    .sort((a, b) => usageTierOrder(a.name) - usageTierOrder(b.name));
}

function classifyGeminiModel(modelId: string): string {
  if (modelId.includes("flash-lite")) {
    return TIER_GEMINI_FLASH_LITE;
  }
  if (modelId.includes("flash")) {
    return TIER_GEMINI_FLASH;
  }
  if (modelId.includes("pro")) {
    return TIER_GEMINI_PRO;
  }
  return modelId;
}

function usageTierLabel(name: string): string {
  switch (name) {
    case TIER_GEMINI_PRO:
      return "Pro";
    case TIER_GEMINI_FLASH:
      return "Flash";
    case TIER_GEMINI_FLASH_LITE:
      return "Flash Lite";
    default:
      return name;
  }
}

function usageTierOrder(name: string): number {
  switch (name) {
    case TIER_GEMINI_PRO:
      return 0;
    case TIER_GEMINI_FLASH:
      return 1;
    case TIER_GEMINI_FLASH_LITE:
      return 2;
    default:
      return 3;
  }
}

function extractProjectId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const objectValue = value as { id?: unknown; projectId?: unknown };
  if (typeof objectValue.id === "string" && objectValue.id.trim()) {
    return objectValue.id;
  }
  if (typeof objectValue.projectId === "string" && objectValue.projectId.trim()) {
    return objectValue.projectId;
  }

  return undefined;
}

function quotaHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
}

function makeResult(
  profileName: string,
  success: boolean,
  credentialStatus: CredentialStatus,
  tiers: UsageTier[],
  error?: string,
  queriedAt?: number
): ProfileUsageResult {
  return {
    profileName,
    success,
    credentialStatus,
    tiers,
    error,
    queriedAt
  };
}

async function safeResponseMessage(response: ResponseLike): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return "empty response";
  }

  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  } catch {
    // Fall through to a bounded text fragment.
  }

  return text.slice(0, 300);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
