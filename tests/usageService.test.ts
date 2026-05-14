import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryGeminiUsageFromOAuthFile } from "../src/main/usageService";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gemini-oauth-switcher-usage-"));
  tempRoots.push(root);
  return root;
}

async function writeOAuth(root: string, value: unknown): Promise<string> {
  const oauthPath = path.join(root, ".gemini", "oauth_creds.json");
  await mkdir(path.dirname(oauthPath), { recursive: true });
  await writeFile(oauthPath, `${JSON.stringify(value)}\n`, "utf8");
  return oauthPath;
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

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("usageService", () => {
  it("refreshes expired Gemini OAuth tokens and maps quota buckets to Gemini tiers", async () => {
    const root = await makeTempRoot();
    const oauthPath = await writeOAuth(root, {
      access_token: "old-access-token",
      refresh_token: "refresh-token",
      expiry_date: 1
    });

    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://oauth2.googleapis.com/token") {
        expect(String(init?.body)).toContain("refresh_token=refresh-token");
        return response(200, { access_token: "new-access-token" });
      }

      expect(init?.headers).toMatchObject({
        Authorization: "Bearer new-access-token",
        "Content-Type": "application/json"
      });

      if (href.endsWith("/v1internal:loadCodeAssist")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          metadata: {
            ideType: "GEMINI_CLI",
            pluginType: "GEMINI"
          }
        });
        return response(200, {
          cloudaicompanionProject: {
            projectId: "project-from-load-code-assist"
          }
        });
      }

      if (href.endsWith("/v1internal:retrieveUserQuota")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          project: "project-from-load-code-assist"
        });
        return response(200, {
          buckets: [
            { modelId: "gemini-3-pro-preview", remainingFraction: 0.82, resetTime: "2026-05-13T12:00:00Z" },
            { modelId: "gemini-3-pro-preview", remainingFraction: 0.74, resetTime: "2026-05-13T11:00:00Z" },
            { modelId: "gemini-3-flash-preview", remainingFraction: 1 },
            { modelId: "gemini-2.5-flash-lite", remainingFraction: 0.91 }
          ]
        });
      }

      throw new Error(`Unexpected URL: ${href}`);
    });

    const usage = await queryGeminiUsageFromOAuthFile({
      profileName: "alice",
      oauthPath,
      fetchImpl,
      nowMs: () => 1_000
    });

    expect(usage).toMatchObject({
      profileName: "alice",
      success: true,
      credentialStatus: "valid",
      queriedAt: 1_000
    });
    expect(usage.tiers).toEqual([
      {
        name: "gemini_pro",
        label: "Pro",
        utilization: 26,
        resetsAt: "2026-05-13T11:00:00Z"
      },
      {
        name: "gemini_flash",
        label: "Flash",
        utilization: 0
      },
      {
        name: "gemini_flash_lite",
        label: "Flash Lite",
        utilization: 9
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("returns not_found without reading OAuth content when the profile has no oauth file", async () => {
    const root = await makeTempRoot();

    await expect(
      queryGeminiUsageFromOAuthFile({
        profileName: "missing",
        oauthPath: path.join(root, ".gemini", "oauth_creds.json"),
        fetchImpl: vi.fn(),
        nowMs: () => 1_000
      })
    ).resolves.toMatchObject({
      profileName: "missing",
      success: false,
      credentialStatus: "not_found",
      tiers: []
    });
  });

  it("falls back to the existing access token when refresh fails", async () => {
    const root = await makeTempRoot();
    const oauthPath = await writeOAuth(root, {
      access_token: "old-access-token",
      refresh_token: "refresh-token",
      expiry_date: 1
    });

    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://oauth2.googleapis.com/token") {
        return response(400, { error: "invalid_grant" });
      }

      expect(init?.headers).toMatchObject({
        Authorization: "Bearer old-access-token"
      });

      if (href.endsWith("/v1internal:loadCodeAssist")) {
        return response(200, {
          cloudaicompanionProject: "project-from-old-token"
        });
      }

      if (href.endsWith("/v1internal:retrieveUserQuota")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          project: "project-from-old-token"
        });
        return response(200, {
          buckets: [{ modelId: "gemini-3-pro-preview", remainingFraction: 0.25 }]
        });
      }

      throw new Error(`Unexpected URL: ${href}`);
    });

    await expect(
      queryGeminiUsageFromOAuthFile({
        profileName: "old-token",
        oauthPath,
        fetchImpl,
        nowMs: () => 1_000
      })
    ).resolves.toMatchObject({
      profileName: "old-token",
      success: true,
      credentialStatus: "valid",
      tiers: [
        {
          name: "gemini_pro",
          label: "Pro",
          utilization: 75
        }
      ]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("returns a query error when the quota request fails before an HTTP response", async () => {
    const root = await makeTempRoot();
    const oauthPath = await writeOAuth(root, {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expiry_date: 9_999
    });

    await expect(
      queryGeminiUsageFromOAuthFile({
        profileName: "network-error",
        oauthPath,
        fetchImpl: vi.fn(async () => {
          throw new Error("network down");
        }),
        nowMs: () => 1_000
      })
    ).resolves.toMatchObject({
      profileName: "network-error",
      success: false,
      credentialStatus: "valid",
      tiers: [],
      error: "Network error (loadCodeAssist): network down",
      queriedAt: 1_000
    });
  });
});
