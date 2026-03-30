import fs from "fs";
import path from "path";

export type BenchmarkLatencyRecord = {
  timestamp: string;
  architecture: string;
  mode: string;
  run: number;
  probe: number;
  latencyMs: number;
  timedOut: boolean;
  signal: string;
  ideUrl: string;
  file: string;
};

export function appendBenchmarkLatencyRecord(
  outputDir: string,
  record: BenchmarkLatencyRecord,
): string {
  const rawDir = path.join(process.cwd(), outputDir, "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  const rawFile = path.join(rawDir, "latency-raw.jsonl");
  fs.appendFileSync(rawFile, `${JSON.stringify(record)}\n`, "utf8");
  return rawFile;
}
