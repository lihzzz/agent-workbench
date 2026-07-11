import path from "path";
import fs from "fs";
import { app } from "electron";

const logsDir = app.isPackaged
  ? path.join(app.getPath("userData"), "logs")
  : path.join(__dirname, "..", "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });

const logFile = path.join(logsDir, `main-${Date.now()}.log`);
const logStream = fs.createWriteStream(logFile, { flags: "a" });

const REDACTED = "[REDACTED]";
const MAX_STRING_LENGTH = 2_048;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_NESTING_DEPTH = 8;
const MAX_FORMATTED_BYTES = 64 * 1_024;
const SENSITIVE_KEY_RE =
  /^(authorization|proxy-authorization|api[-_]?key|token|access[-_]?token|refresh[-_]?token|id[-_]?token|secret|client[-_]?secret|password|passwd|cookie|set-cookie|code[-_]?verifier)$/i;

function sanitizeString(value: string): string {
  const sanitized = value
    .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;"]+/gi, `$1${REDACTED}`)
    .replace(/((?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|api[_-]?key|apikey|password|code(?:[_-]?verifier)?)=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/(:\/\/)([^/\s:@]+):([^/\s@]+)@/g, `$1${REDACTED}@`);

  if (sanitized.length <= MAX_STRING_LENGTH) return sanitized;
  return `${sanitized.slice(0, MAX_STRING_LENGTH)}... [truncated ${sanitized.length - MAX_STRING_LENGTH} chars]`;
}

function sanitizeValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value === "function") return "[function]";
  if (!(value instanceof Object)) return value;
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_NESTING_DEPTH) return `[truncated: max depth ${MAX_NESTING_DEPTH}]`;
  seen.add(value);

  if (Array.isArray(value)) {
    const limited = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, seen, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      limited.push(`[truncated ${value.length - MAX_ARRAY_ITEMS} items]`);
    }
    return limited;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }

  const sanitized: Record<string, unknown> = {};
  const entries = Object.entries(value);
  for (const [key, nested] of entries.slice(0, MAX_OBJECT_KEYS)) {
    sanitized[key] = SENSITIVE_KEY_RE.test(key)
      ? REDACTED
      : sanitizeValue(nested, seen, depth + 1);
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    sanitized.__truncated__ = `${entries.length - MAX_OBJECT_KEYS} keys omitted`;
  }
  return sanitized;
}

export function formatLogData(data: unknown): string {
  const sanitized = sanitizeValue(data);
  const formatted = typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized, null, 2);
  if (Buffer.byteLength(formatted, "utf8") <= MAX_FORMATTED_BYTES) return formatted;

  const marker = "... [truncated: log exceeded 64KB]";
  const maxContentBytes = MAX_FORMATTED_BYTES - Buffer.byteLength(marker, "utf8");
  let end = Math.min(formatted.length, maxContentBytes);
  while (end > 0 && Buffer.byteLength(formatted.slice(0, end), "utf8") > maxContentBytes) {
    end -= Math.max(1, Math.ceil((Buffer.byteLength(formatted.slice(0, end), "utf8") - maxContentBytes) / 2));
  }
  return formatted.slice(0, end) + marker;
}

export function log(label: string, data: unknown): void {
  const ts = new Date().toISOString();
  const line = formatLogData(data);
  logStream.write(`[${ts}] [${label}] ${line}\n`);
}

export function logDebug(label: string, data: unknown): void {
  if (process.env.HARNSS_EVENT_FULL !== "1" && process.env.HARNSS_LOG_LEVEL !== "debug") return;
  log(label, data);
}
