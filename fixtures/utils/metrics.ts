import fs from "fs";
import path from "path";
import type { TestInfo } from "@playwright/test";

export interface Metric {
  name: string;
  app?: string;
  template?: string;
  ms: number;
}

export const METRICS_DIR = path.join(process.cwd(), "test-data/metrics");

export function metricFileName(m: Pick<Metric, "name" | "app" | "template">) {
  return (
    [m.name, m.app, m.template]
      .filter(Boolean)
      .join("-")
      .replace(/[^a-zA-Z0-9._-]+/g, "_") + ".json"
  );
}

/** Environment name is the landing page hostname, as in EduIDE-deployment. */
export function environmentName(url = process.env.LANDINGPAGE_URL ?? "") {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Shows up in the HTML report and as a JSON file for later comparison. */
export function recordMetric(testInfo: TestInfo | undefined, m: Metric) {
  const ms = Math.round(m.ms);
  const record = {
    ...m,
    ms,
    env: environmentName(),
    timestamp: new Date().toISOString(),
  };
  testInfo?.annotations.push({
    type: "metric",
    description: `${metricFileName(m).replace(/\.json$/, "")}: ${ms} ms`,
  });
  fs.mkdirSync(METRICS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(METRICS_DIR, metricFileName(m)),
    JSON.stringify(record, null, 2),
  );
  return record;
}

/** Runs `fn` and records how long it took, also when it throws. */
export async function timed<T>(
  testInfo: TestInfo | undefined,
  m: Omit<Metric, "ms">,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const result = await fn();
  recordMetric(testInfo, { ...m, ms: Date.now() - start });
  return result;
}
