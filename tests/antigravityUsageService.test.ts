import { describe, expect, it, vi } from "vitest";
import { queryAntigravityUsage } from "../src/main/antigravityUsageService";
import type { CredentialStore } from "../src/main/antigravityCredentialService";

function createMemoryCredentialStore(payload?: string): CredentialStore {
  return {
    async get() {
      return payload;
    },
    async set() {},
    async delete() {}
  };
}

function response(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}

describe("antigravityUsageService", () => {
  it("queries and maps grouped Antigravity quota with a valid access token", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary");
      expect(init).toMatchObject({
        method: "POST",
        headers: {
          Authorization: "Bearer fresh-access-token",
          "Content-Type": "application/json",
          "User-Agent": "antigravity/2.1.4"
        },
        body: "{}"
      });

      return response(200, {
        groups: [
          {
            displayName: "Gemini Models",
            description: "Gemini model quota",
            buckets: [
              {
                bucketId: "gemini-weekly",
                displayName: "Weekly Limit",
                window: "weekly",
                remainingFraction: 1,
                resetTime: "2026-07-19T10:19:43Z"
              },
              {
                bucketId: "gemini-5h",
                displayName: "Five Hour Limit",
                window: "5h",
                remainingFraction: 0.8544279,
                resetTime: "2026-07-12T14:47:31Z"
              }
            ]
          },
          {
            displayName: "Claude and GPT models",
            buckets: [
              {
                bucketId: "3p-weekly",
                displayName: "Weekly Limit",
                window: "weekly",
                remainingFraction: 0.4
              },
              {
                bucketId: "3p-5h",
                displayName: "Five Hour Limit",
                window: "5h",
                remainingFraction: 1
              }
            ]
          }
        ]
      });
    });

    const usage = await queryAntigravityUsage({
      profileName: "agy-work",
      credentialTarget: "gemini-oauth-switcher:antigravity-cli:agy-work",
      credentialStore: createMemoryCredentialStore(JSON.stringify({
        token: {
          access_token: "fresh-access-token",
          refresh_token: "refresh-token",
          expiry: "2026-07-12T11:00:00.000Z"
        }
      })),
      fetchImpl,
      nowMs: () => new Date("2026-07-12T10:00:00.000Z").getTime()
    });

    expect(usage).toEqual({
      profileName: "agy-work",
      success: true,
      credentialStatus: "valid",
      tiers: [],
      groups: [
        {
          name: "gemini_models",
          label: "Gemini",
          description: "Gemini model quota",
          tiers: [
            {
              name: "gemini-weekly",
              label: "周",
              utilization: 0,
              resetsAt: "2026-07-19T10:19:43Z"
            },
            {
              name: "gemini-5h",
              label: "5h",
              utilization: 14.6,
              resetsAt: "2026-07-12T14:47:31Z"
            }
          ]
        },
        {
          name: "claude_and_gpt_models",
          label: "Claude / GPT",
          tiers: [
            {
              name: "3p-weekly",
              label: "周",
              utilization: 60
            },
            {
              name: "3p-5h",
              label: "5h",
              utilization: 0
            }
          ]
        }
      ],
      queriedAt: new Date("2026-07-12T10:00:00.000Z").getTime()
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes an expired Antigravity access token before querying quota", async () => {
    const oauthClient = {
      clientId: "test-client-id",
      clientSecret: "test-client-secret"
    };
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("client_id")).toBe(oauthClient.clientId);
        expect(body.get("client_secret")).toBe(oauthClient.clientSecret);
        expect(body.get("refresh_token")).toBe("refresh-token");
        expect(body.get("grant_type")).toBe("refresh_token");
        return response(200, { access_token: "refreshed-access-token", expires_in: 3599 });
      }

      expect(href).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer refreshed-access-token" });
      return response(200, {
        groups: [{
          displayName: "Gemini Models",
          buckets: [{ bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.75 }]
        }]
      });
    });

    const usage = await queryAntigravityUsage({
      profileName: "expired-profile",
      credentialTarget: "profile-target",
      credentialStore: createMemoryCredentialStore(JSON.stringify({
        token: {
          access_token: "expired-access-token",
          refresh_token: "refresh-token",
          expiry: "2026-07-12T09:00:00.000Z"
        }
      })),
      oauthClients: [oauthClient],
      fetchImpl,
      nowMs: () => new Date("2026-07-12T10:00:00.000Z").getTime()
    });

    expect(usage).toMatchObject({
      success: true,
      credentialStatus: "valid",
      groups: [{ tiers: [{ utilization: 25 }] }]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refreshes once and retries when a fresh access token receives HTTP 401", async () => {
    let quotaAttempts = 0;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://oauth2.googleapis.com/token") {
        return response(200, { access_token: "retry-access-token" });
      }

      quotaAttempts += 1;
      if (quotaAttempts === 1) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer rejected-access-token" });
        return response(401, { error: { message: "invalid token" } });
      }

      expect(init?.headers).toMatchObject({ Authorization: "Bearer retry-access-token" });
      return response(200, {
        groups: [{
          displayName: "Claude and GPT models",
          buckets: [{ bucketId: "3p-5h", window: "5h", remainingFraction: 1 }]
        }]
      });
    });

    await expect(queryAntigravityUsage({
      profileName: "retry-profile",
      credentialTarget: "profile-target",
      credentialStore: createMemoryCredentialStore(JSON.stringify({
        token: {
          access_token: "rejected-access-token",
          refresh_token: "refresh-token",
          expiry: "2026-07-12T11:00:00.000Z"
        }
      })),
      oauthClients: [{ clientId: "test-client-id", clientSecret: "test-client-secret" }],
      fetchImpl,
      nowMs: () => new Date("2026-07-12T10:00:00.000Z").getTime()
    })).resolves.toMatchObject({ success: true, credentialStatus: "valid" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("reports missing and malformed Antigravity credentials without making requests", async () => {
    const fetchImpl = vi.fn();

    await expect(queryAntigravityUsage({
      profileName: "missing",
      credentialTarget: "missing-target",
      credentialStore: createMemoryCredentialStore(),
      fetchImpl,
      nowMs: () => 1_000
    })).resolves.toMatchObject({
      success: false,
      credentialStatus: "not_found",
      tiers: []
    });

    await expect(queryAntigravityUsage({
      profileName: "malformed",
      credentialTarget: "malformed-target",
      credentialStore: createMemoryCredentialStore("not-json"),
      fetchImpl,
      nowMs: () => 1_000
    })).resolves.toMatchObject({
      success: false,
      credentialStatus: "parse_error",
      tiers: []
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a safe failure for an invalid quota response", async () => {
    const usage = await queryAntigravityUsage({
      profileName: "invalid-response",
      credentialTarget: "profile-target",
      credentialStore: createMemoryCredentialStore(JSON.stringify({
        token: {
          access_token: "fresh-access-token",
          refresh_token: "refresh-token",
          expiry: "2026-07-12T11:00:00.000Z"
        }
      })),
      fetchImpl: vi.fn(async () => response(200, { unexpected: true })),
      nowMs: () => new Date("2026-07-12T10:00:00.000Z").getTime()
    });

    expect(usage).toMatchObject({
      success: false,
      credentialStatus: "valid",
      tiers: [],
      error: "Antigravity quota response did not contain any quota groups."
    });
  });
});
