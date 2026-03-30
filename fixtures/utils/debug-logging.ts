import fs from "fs";
import path from "path";

const DEFAULT_LOG_FILE = "test-data/debug/playwright-debug.log";

export function isDebugLoggingEnabled(): boolean {
  return process.env.BENCH_DEBUG_LOG === "1";
}

function getLogFilePath(): string {
  const configuredPath = process.env.BENCH_DEBUG_LOG_FILE || DEFAULT_LOG_FILE;
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(process.cwd(), configuredPath);
}

function toSafeJson(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export function debugLog(
  scope: string,
  message: string,
  metadata?: unknown,
): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  const now = new Date().toISOString();
  const suffix = metadata === undefined ? "" : ` | ${toSafeJson(metadata)}`;
  const line = `[${now}] [${scope}] ${message}${suffix}`;

  console.log(line);

  const logFile = getLogFilePath();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${line}\n`, "utf8");
}
