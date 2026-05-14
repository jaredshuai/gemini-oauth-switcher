import { execFile } from "node:child_process";
import type { LocalDiagnosticsResult } from "../shared/types";

const ENV_RISK_KEYS = [
  "GEMINI_CLI_HOME",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GEMINI_BASE_URL",
  "GOOGLE_VERTEX_BASE_URL"
];

interface CollectLocalDiagnosticsOptions {
  env?: Record<string, string | undefined>;
  resolveGeminiCommand?: () => Promise<string | undefined>;
  now?: () => number;
}

export async function collectLocalDiagnostics(options: CollectLocalDiagnosticsOptions = {}): Promise<LocalDiagnosticsResult> {
  const env = options.env ?? process.env;
  const envRisks = ENV_RISK_KEYS.filter((key) => Boolean(env[key]?.trim()));
  const geminiPath = await (options.resolveGeminiCommand ?? resolveGeminiCommand)();

  return {
    envRisks,
    geminiCommand: geminiPath
      ? {
          available: true,
          path: geminiPath
        }
      : {
          available: false
        },
    checkedAt: options.now?.() ?? Date.now()
  };
}

async function resolveGeminiCommand(): Promise<string | undefined> {
  const command = process.platform === "win32" ? "where.exe" : "which";

  try {
    const stdout = await execFileText(command, ["gemini"]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });
}
