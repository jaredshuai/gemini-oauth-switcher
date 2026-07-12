import { createReadStream } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CLIENT_ID_PATTERN = /[0-9]{6,}-[A-Za-z0-9_-]{20,}\.apps\.googleusercontent\.com/g;
const CLIENT_SECRET_PATTERN = /GOCSPX-[A-Za-z0-9_-]{28}/g;
const STREAM_OVERLAP = 256;

export interface AntigravityOAuthClient {
  clientId: string;
  clientSecret: string;
}

interface ResolveAntigravityOAuthClientOptions {
  binaryPaths?: string[];
}

let installedClientsPromise: Promise<AntigravityOAuthClient[]> | undefined;

export function resolveInstalledAntigravityOAuthClients(
  options: ResolveAntigravityOAuthClientOptions = {}
): Promise<AntigravityOAuthClient[]> {
  if (options.binaryPaths) {
    return scanOAuthClients(options.binaryPaths);
  }

  installedClientsPromise ??= scanOAuthClients(findInstalledAgyBinaryPaths());
  return installedClientsPromise;
}

async function scanOAuthClients(binaryPaths: string[]): Promise<AntigravityOAuthClient[]> {
  const clientIds = new Set<string>();
  const clientSecrets = new Set<string>();

  for (const binaryPath of binaryPaths) {
    await scanBinary(binaryPath, clientIds, clientSecrets);
  }

  return Array.from(clientIds).flatMap((clientId) =>
    Array.from(clientSecrets).map((clientSecret) => ({ clientId, clientSecret }))
  );
}

async function scanBinary(
  binaryPath: string,
  clientIds: Set<string>,
  clientSecrets: Set<string>
): Promise<void> {
  let carry = "";
  try {
    for await (const chunk of createReadStream(binaryPath, { highWaterMark: 1024 * 1024 })) {
      const text = carry + (chunk as Buffer).toString("latin1");
      collectMatches(text, CLIENT_ID_PATTERN, clientIds);
      collectMatches(text, CLIENT_SECRET_PATTERN, clientSecrets);
      carry = text.slice(-STREAM_OVERLAP);
    }
  } catch {
    // Missing or unreadable installations are handled as no available OAuth clients.
  }
}

function collectMatches(value: string, pattern: RegExp, target: Set<string>): void {
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    target.add(match[0]);
  }
}

function findInstalledAgyBinaryPaths(): string[] {
  const paths = new Set<string>();
  const whereResult = spawnSync("where.exe", ["agy.exe"], { encoding: "utf8", windowsHide: true });
  if (whereResult.status === 0) {
    for (const value of whereResult.stdout.split(/\r?\n/)) {
      if (value.trim()) {
        paths.add(path.resolve(value.trim()));
      }
    }
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    paths.add(path.join(localAppData, "agy", "bin", "agy.exe"));
    paths.add(path.join(localAppData, "Programs", "Antigravity", "resources", "bin", "language_server.exe"));
  }

  return Array.from(paths);
}
