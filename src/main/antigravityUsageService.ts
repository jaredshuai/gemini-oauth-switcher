import type { CredentialStore } from "./antigravityCredentialService";
import {
  resolveInstalledAntigravityOAuthClients,
  type AntigravityOAuthClient
} from "./antigravityOAuthClientService";
import type { CredentialStatus, ProfileUsageResult, UsageGroup, UsageTier } from "../shared/types";

const ANTIGRAVITY_QUOTA_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANTIGRAVITY_USER_AGENT = "antigravity/2.1.4";
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 30_000;

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<ResponseLike>;

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface QueryAntigravityUsageOptions {
  profileName: string;
  credentialTarget: string;
  credentialStore: CredentialStore;
  oauthClients?: AntigravityOAuthClient[];
  fetchImpl?: FetchLike;
  nowMs?: () => number;
}

interface AntigravityCredential {
  token?: {
    access_token?: unknown;
    refresh_token?: unknown;
    expiry?: unknown;
  };
}

let preferredOAuthClient: AntigravityOAuthClient | undefined;

export async function queryAntigravityUsage(
  options: QueryAntigravityUsageOptions
): Promise<ProfileUsageResult> {
  const nowMs = options.nowMs ?? Date.now;
  const payload = await options.credentialStore.get(options.credentialTarget);
  if (!payload) {
    return makeResult(options.profileName, false, "not_found", [], undefined, nowMs());
  }

  const credential = parseCredential(payload);
  if (!credential) {
    return makeResult(options.profileName, false, "parse_error", [], "Antigravity credential is invalid.", nowMs());
  }

  const fetchImpl = options.fetchImpl ?? createTimeoutFetch(10_000);
  const refreshToken = readRefreshToken(credential);
  const resolveOAuthClients = () => options.oauthClients
    ? Promise.resolve(options.oauthClients)
    : resolveInstalledAntigravityOAuthClients();
  let accessToken = readFreshAccessToken(credential, nowMs());
  if (!accessToken) {
    accessToken = refreshToken
      ? await refreshAccessToken(refreshToken, await resolveOAuthClients(), fetchImpl)
      : undefined;
    if (!accessToken) {
      return makeResult(
        options.profileName,
        false,
        "expired",
        [],
        "Antigravity access token is expired and could not be refreshed.",
        nowMs()
      );
    }
  }

  try {
    let response = await fetchQuota(accessToken, fetchImpl);
    if (response.status === 401 && refreshToken) {
      const refreshedToken = await refreshAccessToken(refreshToken, await resolveOAuthClients(), fetchImpl);
      if (!refreshedToken) {
        return makeResult(
          options.profileName,
          false,
          "expired",
          [],
          "Antigravity access token was rejected and could not be refreshed.",
          nowMs()
        );
      }
      response = await fetchQuota(refreshedToken, fetchImpl);
    }

    if (!response.ok) {
      return makeResult(
        options.profileName,
        false,
        "valid",
        [],
        `Antigravity quota request failed: HTTP ${response.status}`,
        nowMs()
      );
    }

    const groups = mapQuotaGroups(await response.json());
    if (groups.length === 0) {
      return makeResult(
        options.profileName,
        false,
        "valid",
        [],
        "Antigravity quota response did not contain any quota groups.",
        nowMs()
      );
    }
    return makeResult(options.profileName, true, "valid", groups, undefined, nowMs());
  } catch (error) {
    return makeResult(
      options.profileName,
      false,
      "valid",
      [],
      `Network error: ${getErrorMessage(error)}`,
      nowMs()
    );
  }
}

function readRefreshToken(credential: AntigravityCredential): string | undefined {
  const refreshToken = credential.token?.refresh_token;
  return typeof refreshToken === "string" && refreshToken ? refreshToken : undefined;
}

async function refreshAccessToken(
  refreshToken: string,
  oauthClients: AntigravityOAuthClient[],
  fetchImpl: FetchLike
): Promise<string | undefined> {
  const candidates = orderOAuthClients(oauthClients);
  for (const oauthClient of candidates) {
    const body = new URLSearchParams({
      client_id: oauthClient.clientId,
      client_secret: oauthClient.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    });
    try {
      const response = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body
      });
      if (!response.ok) {
        continue;
      }

      const parsed = await response.json() as { access_token?: unknown };
      if (typeof parsed.access_token === "string" && parsed.access_token) {
        preferredOAuthClient = oauthClient;
        return parsed.access_token;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function orderOAuthClients(oauthClients: AntigravityOAuthClient[]): AntigravityOAuthClient[] {
  if (!preferredOAuthClient) {
    return oauthClients;
  }

  const preferredIndex = oauthClients.findIndex((candidate) =>
    candidate.clientId === preferredOAuthClient?.clientId &&
    candidate.clientSecret === preferredOAuthClient.clientSecret
  );
  if (preferredIndex <= 0) {
    return oauthClients;
  }

  return [oauthClients[preferredIndex], ...oauthClients.slice(0, preferredIndex), ...oauthClients.slice(preferredIndex + 1)];
}

function fetchQuota(accessToken: string, fetchImpl: FetchLike): Promise<ResponseLike> {
  return fetchImpl(ANTIGRAVITY_QUOTA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_USER_AGENT
    },
    body: "{}"
  });
}

function parseCredential(payload: string): AntigravityCredential | undefined {
  try {
    const parsed = JSON.parse(payload) as AntigravityCredential;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readFreshAccessToken(credential: AntigravityCredential, nowMs: number): string | undefined {
  const accessToken = credential.token?.access_token;
  const expiry = credential.token?.expiry;
  if (typeof accessToken !== "string" || !accessToken || typeof expiry !== "string") {
    return undefined;
  }

  const expiryMs = Date.parse(expiry);
  return Number.isFinite(expiryMs) && expiryMs > nowMs + ACCESS_TOKEN_EXPIRY_SKEW_MS
    ? accessToken
    : undefined;
}

function mapQuotaGroups(value: unknown): UsageGroup[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const groups = (value as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) {
    return [];
  }

  return groups.flatMap((group): UsageGroup[] => {
    if (!group || typeof group !== "object") {
      return [];
    }

    const raw = group as { displayName?: unknown; description?: unknown; buckets?: unknown };
    const displayName = typeof raw.displayName === "string" && raw.displayName.trim()
      ? raw.displayName.trim()
      : "Model quota";
    const description = typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim()
      : undefined;
    const tiers = mapQuotaBuckets(raw.buckets);
    if (tiers.length === 0) {
      return [];
    }

    return [{
      name: normalizeName(displayName),
      label: groupLabel(displayName),
      ...(description ? { description } : {}),
      tiers
    }];
  });
}

function mapQuotaBuckets(value: unknown): UsageTier[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((bucket): UsageTier[] => {
    if (!bucket || typeof bucket !== "object") {
      return [];
    }

    const raw = bucket as {
      bucketId?: unknown;
      displayName?: unknown;
      window?: unknown;
      remainingFraction?: unknown;
      resetTime?: unknown;
    };
    if (typeof raw.bucketId !== "string" || !raw.bucketId.trim()) {
      return [];
    }

    const remaining = clamp01(typeof raw.remainingFraction === "number" ? raw.remainingFraction : 1);
    const resetsAt = typeof raw.resetTime === "string" && raw.resetTime.trim() ? raw.resetTime : undefined;
    return [{
      name: raw.bucketId,
      label: bucketLabel(raw.window, raw.displayName),
      utilization: roundPercent((1 - remaining) * 100),
      ...(resetsAt ? { resetsAt } : {})
    }];
  });
}

function groupLabel(displayName: string): string {
  const normalized = displayName.toLowerCase();
  if (normalized.includes("gemini")) {
    return "Gemini";
  }
  if (normalized.includes("claude") || normalized.includes("gpt")) {
    return "Claude / GPT";
  }
  return displayName;
}

function bucketLabel(windowValue: unknown, displayName: unknown): string {
  if (windowValue === "weekly") {
    return "周";
  }
  if (windowValue === "5h") {
    return "5h";
  }
  return typeof displayName === "string" && displayName.trim() ? displayName.trim() : "配额";
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function makeResult(
  profileName: string,
  success: boolean,
  credentialStatus: CredentialStatus,
  groups: UsageGroup[],
  error?: string,
  queriedAt?: number
): ProfileUsageResult {
  return {
    profileName,
    success,
    credentialStatus,
    tiers: [],
    ...(groups.length > 0 ? { groups } : {}),
    ...(error ? { error } : {}),
    queriedAt
  };
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
