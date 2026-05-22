import fs from "fs";
import path from "path";

export type BenchmarkLatencyRecord = {
  timestamp: string;
  architecture: string;
  mode: string;
  scenario?: string;
  run: number;
  runId?: string;
  probe: number;
  latencyMs: number;
  timedOut: boolean;
  signal?: string;
  ideUrl: string;
  file: string;
  targetApp?: string;
  hoverTarget?: string;
};

export function appendBenchmarkLatencyRecord(
  outputDir: string,
  record: BenchmarkLatencyRecord,
): string {
  const baseDir = path.isAbsolute(outputDir)
    ? outputDir
    : path.join(process.cwd(), outputDir);
  const rawDir = path.join(baseDir, "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  const rawFile = path.join(rawDir, "latency-raw.jsonl");
  fs.appendFileSync(rawFile, `${JSON.stringify(record)}\n`, "utf8");
  return rawFile;
}
