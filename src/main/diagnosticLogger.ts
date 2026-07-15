import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const DIAGNOSTIC_LOG_MAX_BYTES = 256 * 1024;
export const DIAGNOSTIC_LOG_FILE_COUNT = 3;

type DiagnosticLevel = "info" | "warn" | "error";
type DiagnosticMetadata = Record<string, unknown>;

export interface DiagnosticLogger {
  readonly directory: string;
  info(event: string, metadata?: DiagnosticMetadata): Promise<void>;
  warn(event: string, metadata?: DiagnosticMetadata): Promise<void>;
  error(event: string, metadata?: DiagnosticMetadata): Promise<void>;
  flush(): Promise<void>;
}

interface CreateDiagnosticLoggerOptions {
  directory: string;
  maxBytes?: number;
  maxFiles?: number;
  now?: () => number;
}

const MAX_METADATA_KEYS = 24;
const MAX_ARRAY_ITEMS = 20;
const MAX_VALUE_DEPTH = 3;
const MAX_STRING_LENGTH = 512;
const MAX_LINE_BYTES = 8 * 1024;
const SENSITIVE_KEY = /(?:authorization|credential|oauth|password|secret|token|api[_-]?key)/iu;

export function createDiagnosticLogger(options: CreateDiagnosticLoggerOptions): DiagnosticLogger {
  const directory = path.resolve(options.directory);
  const activePath = path.join(directory, "diagnostics.log");
  const maxBytes = Math.max(128, Math.floor(options.maxBytes ?? DIAGNOSTIC_LOG_MAX_BYTES));
  const maxFiles = Math.max(1, Math.floor(options.maxFiles ?? DIAGNOSTIC_LOG_FILE_COUNT));
  const now = options.now ?? Date.now;
  let queue = Promise.resolve();

  function log(level: DiagnosticLevel, event: string, metadata?: DiagnosticMetadata): Promise<void> {
    const next = queue
      .catch(() => undefined)
      .then(async () => {
        const line = createDiagnosticLine(level, event, metadata, now());
        const lineBytes = Buffer.byteLength(line, "utf8");
        await mkdir(directory, { recursive: true });
        const currentSize = await getFileSize(activePath);
        if (currentSize > 0 && currentSize + lineBytes > maxBytes) {
          await rotateLogs(activePath, maxFiles);
        }
        await appendFile(activePath, line, "utf8");
      });
    queue = next;
    return next;
  }

  return {
    directory,
    info: (event, metadata) => log("info", event, metadata),
    warn: (event, metadata) => log("warn", event, metadata),
    error: (event, metadata) => log("error", event, metadata),
    flush: () => queue
  };
}

function createDiagnosticLine(
  level: DiagnosticLevel,
  rawEvent: string,
  metadata: DiagnosticMetadata | undefined,
  timestamp: number
): string {
  const event = sanitizeEventName(rawEvent);
  const sanitizedMetadata = metadata ? sanitizeMetadata(metadata) : undefined;
  const entry = {
    timestamp: new Date(timestamp).toISOString(),
    level,
    event,
    ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {})
  };
  let line = `${JSON.stringify(entry)}\n`;
  if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
    line = `${JSON.stringify({
      timestamp: entry.timestamp,
      level,
      event,
      metadata: { truncated: true }
    })}\n`;
  }
  return line;
}

function sanitizeEventName(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_.:-]+/gu, "_").slice(0, 80);
  return sanitized || "diagnostic.event";
}

function sanitizeMetadata(metadata: DiagnosticMetadata): DiagnosticMetadata {
  const entries = Object.entries(metadata).slice(0, MAX_METADATA_KEYS);
  return Object.fromEntries(entries.map(([key, value]) => [key, sanitizeValue(value, key, 0)]));
}

function sanitizeValue(value: unknown, key: string, depth: number): unknown {
  if (SENSITIVE_KEY.test(key)) {
    return "[REDACTED]";
  }
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
    return value ?? null;
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (depth >= MAX_VALUE_DEPTH) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, "item", depth + 1));
  }
  if (value instanceof Error) {
    return {
      name: redactString(value.name),
      message: redactString(value.message)
    };
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_METADATA_KEYS)
        .map(([nestedKey, nestedValue]) => [nestedKey, sanitizeValue(nestedValue, nestedKey, depth + 1)])
    );
  }

  return redactString(String(value));
}

function redactString(value: string): string {
  return value
    .replace(
      /\b((?:access|refresh|id)[_-]?token|client[_-]?secret|api[_-]?key|password)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/giu,
      "$1=[REDACTED]"
    )
    .replace(/Bearer\s+[^\s,;"']+/giu, "Bearer [REDACTED]")
    .replace(/\beyJ[a-zA-Z0-9_-]{8,}(?:\.[a-zA-Z0-9_-]{8,}){1,2}\b/gu, "[REDACTED_JWT]")
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/gu, "[REDACTED_KEY]")
    .replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gu, "[REDACTED_EMAIL]")
    .replace(/\b[a-zA-Z0-9_-]{64,}\b/gu, "[REDACTED_LONG_VALUE]")
    .slice(0, MAX_STRING_LENGTH);
}

async function rotateLogs(activePath: string, maxFiles: number): Promise<void> {
  if (maxFiles === 1) {
    await rm(activePath, { force: true });
    return;
  }

  await rm(`${activePath}.${maxFiles - 1}`, { force: true });
  for (let index = maxFiles - 2; index >= 1; index -= 1) {
    await renameIfExists(`${activePath}.${index}`, `${activePath}.${index + 1}`);
  }
  await renameIfExists(activePath, `${activePath}.1`);
}

async function renameIfExists(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (isNotFoundError(error)) {
      return 0;
    }
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
