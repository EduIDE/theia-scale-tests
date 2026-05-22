import fs from "fs";
import path from "path";

function assertNonEmpty(values, fnName) {
  if (values.length === 0) {
    throw new Error(`${fnName} requires at least one value`);
  }
}

function sorted(values) {
  return [...values].sort((a, b) => a - b);
}

function median(values) {
  assertNonEmpty(values, "median");
  const arr = sorted(values);
  const middle = Math.floor(arr.length / 2);
  if (arr.length % 2 === 0) {
    return (arr[middle - 1] + arr[middle]) / 2;
  }
  return arr[middle];
}

function p95(values) {
  assertNonEmpty(values, "p95");
  const arr = sorted(values);
  const index = Math.ceil(0.95 * arr.length) - 1;
  const boundedIndex = Math.min(Math.max(index, 0), arr.length - 1);
  return arr[boundedIndex];
}

function avg(values) {
  assertNonEmpty(values, "avg");
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function max(values) {
  assertNonEmpty(values, "max");
  return Math.max(...values);
}

function parseNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseCpuMillicores(rawValue) {
  if (!rawValue) {
    return 0;
  }
  if (rawValue.endsWith("m")) {
    return parseNumber(rawValue.slice(0, -1), 0);
  }
  return parseNumber(rawValue, 0) * 1000;
}

export function parseMemoryMiB(rawValue) {
  if (!rawValue) {
    return 0;
  }
  const units = [
    ["Ki", 1 / 1024],
    ["Mi", 1],
    ["Gi", 1024],
    ["Ti", 1024 * 1024],
    ["K", 1 / 1000 / 1024],
    ["M", 1 / 1024],
    ["G", 1000 / 1024],
  ];
  for (const [suffix, factor] of units) {
    if (rawValue.endsWith(suffix)) {
      return parseNumber(rawValue.slice(0, -suffix.length), 0) * factor;
    }
  }
  return parseNumber(rawValue, 0);
}

function stableRunId(record) {
  if (record.runId) {
    return record.runId;
  }
  const run = Number.isFinite(Number(record.run)) ? Number(record.run) : 1;
  return `${record.architecture || "unknown"}-${record.mode || "unknown"}-run-${run}`;
}

function stableLatencyRunKey(record) {
  const architecture = record.architecture || "unknown";
  const mode = record.mode || "unknown";
  const scenario = record.scenario || "default";
  return `${architecture}|${mode}|${scenario}|${stableRunId(record)}`;
}

function stableResourceRunKey(row) {
  const architecture = row.architecture || "unknown";
  const mode = row.mode || "unknown";
  const scenario = row.scenario || "default";
  const runId = row.run_id || "unknown-run";
  return `${architecture}|${mode}|${scenario}|${runId}`;
}

function requiredSignalsForMode(mode, scenario = "default") {
  if (mode === "warm") {
    if (scenario === "hover-context") {
      return [
        "startup-session-ready",
        "first-hover-latency",
        "warm-hover-latency",
      ];
    }
    return [
      "startup-session-ready",
      "first-error-latency",
      "clean-state-latency",
      "warm-error-latency",
    ];
  }
  return ["startup-session-ready"];
}

export function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function readJsonLinesFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return parseJsonLines(fs.readFileSync(filePath, "utf8"));
}

export function parseResourceCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [];
  }
  const [header, ...rows] = lines;
  const columns = header.split(",");
  return rows.map((row) => {
    const values = row.split(",");
    const result = {};
    columns.forEach((column, index) => {
      result[column] = values[index] ?? "";
    });
    return result;
  });
}

export function readResourceCsvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return parseResourceCsv(fs.readFileSync(filePath, "utf8"));
}

export function collectCompleteLatencyRunKeys(records) {
  const runs = new Map();

  for (const record of records) {
    const key = stableLatencyRunKey(record);
    if (!runs.has(key)) {
      runs.set(key, {
        mode: record.mode || "unknown",
        scenario: record.scenario || "default",
        signals: new Set(),
        timedOut: false,
      });
    }

    const run = runs.get(key);
    if (record.signal) {
      run.signals.add(record.signal);
    }
    run.timedOut ||= Boolean(record.timedOut);
  }

  return new Set(
    [...runs.entries()]
      .filter(([, run]) => {
        if (run.timedOut) {
          return false;
        }
        return requiredSignalsForMode(run.mode, run.scenario).every((signal) => run.signals.has(signal));
      })
      .map(([key]) => key),
  );
}

export function filterLatencyRecordsToCompleteRuns(records, completeRunKeys) {
  if (!completeRunKeys || completeRunKeys.size === 0) {
    return [];
  }
  return records.filter((record) => completeRunKeys.has(stableLatencyRunKey(record)));
}

export function filterResourceRowsToCompleteRuns(rows, completeRunKeys) {
  if (!completeRunKeys || completeRunKeys.size === 0) {
    return [];
  }
  return rows.filter((row) => completeRunKeys.has(stableResourceRunKey(row)));
}

export function aggregateLatencyRecords(records) {
  const groups = new Map();

  for (const rawRecord of records) {
    const signal = rawRecord.signal || "unknown";
    const architecture = rawRecord.architecture || "unknown";
    const mode = rawRecord.mode || "unknown";
    const scenario = rawRecord.scenario || "default";
    const runId = stableRunId(rawRecord);
    const targetApp = rawRecord.targetApp || "";
    const key = `${architecture}|${mode}|${scenario}|${signal}`;

    if (!groups.has(key)) {
      groups.set(key, {
        architecture,
        mode,
        scenario,
        signal,
        sampleCount: 0,
        timedOutCount: 0,
        runIds: new Set(),
        targetApps: new Set(),
        latencies: [],
      });
    }

    const group = groups.get(key);
    group.sampleCount += 1;
    group.timedOutCount += rawRecord.timedOut ? 1 : 0;
    group.runIds.add(runId);
    if (targetApp) {
      group.targetApps.add(targetApp);
    }

    const latency = Number(rawRecord.latencyMs);
    if (Number.isFinite(latency)) {
      group.latencies.push(latency);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      architecture: group.architecture,
      mode: group.mode,
      scenario: group.scenario,
      signal: group.signal,
      sampleCount: group.sampleCount,
      runCount: group.runIds.size,
      targetApps: [...group.targetApps].sort(),
      timedOutCount: group.timedOutCount,
      medianLatencyMs: group.latencies.length ? median(group.latencies) : null,
      p95LatencyMs: group.latencies.length ? p95(group.latencies) : null,
      avgLatencyMs: group.latencies.length ? avg(group.latencies) : null,
      maxLatencyMs: group.latencies.length ? max(group.latencies) : null,
    }))
    .sort((a, b) =>
      `${a.architecture}|${a.mode}|${a.scenario}|${a.signal}`.localeCompare(
        `${b.architecture}|${b.mode}|${b.scenario}|${b.signal}`,
      ),
    );
}

export function aggregateResourceRows(rows) {
  const perRoleGroups = new Map();
  const combinedByTimestamp = new Map();

  for (const row of rows) {
    const architecture = row.architecture || "unknown";
    const mode = row.mode || "unknown";
    const scenario = row.scenario || "default";
    const role = row.role || "unknown";
    const runId = row.run_id || "unknown-run";
    const targetApp = row.target_app || "";
    const cpuMillicores = parseCpuMillicores(row.cpu_raw || "");
    const memoryMiB = parseMemoryMiB(row.memory_raw || "");
    const timestamp = row.timestamp || "";

    const roleKey = `${architecture}|${mode}|${scenario}|${role}`;
    if (!perRoleGroups.has(roleKey)) {
      perRoleGroups.set(roleKey, {
        architecture,
        mode,
        scenario,
        role,
        sampleCount: 0,
        runIds: new Set(),
        targetApps: new Set(),
        cpuValues: [],
        memoryValues: [],
      });
    }

    const roleGroup = perRoleGroups.get(roleKey);
    roleGroup.sampleCount += 1;
    roleGroup.runIds.add(runId);
    if (targetApp) {
      roleGroup.targetApps.add(targetApp);
    }
    roleGroup.cpuValues.push(cpuMillicores);
    roleGroup.memoryValues.push(memoryMiB);

    const combinedKey = `${architecture}|${mode}|${scenario}|${runId}|${timestamp}`;
    if (!combinedByTimestamp.has(combinedKey)) {
      combinedByTimestamp.set(combinedKey, {
        architecture,
        mode,
        scenario,
        role: "combined",
        runId,
        targetApp,
        cpuMillicores: 0,
        memoryMiB: 0,
      });
    }
    const combined = combinedByTimestamp.get(combinedKey);
    combined.cpuMillicores += cpuMillicores;
    combined.memoryMiB += memoryMiB;
  }

  for (const combined of combinedByTimestamp.values()) {
    const key = `${combined.architecture}|${combined.mode}|${combined.scenario}|${combined.role}`;
    if (!perRoleGroups.has(key)) {
      perRoleGroups.set(key, {
        architecture: combined.architecture,
        mode: combined.mode,
        scenario: combined.scenario,
        role: combined.role,
        sampleCount: 0,
        runIds: new Set(),
        targetApps: new Set(),
        cpuValues: [],
        memoryValues: [],
      });
    }
    const group = perRoleGroups.get(key);
    group.sampleCount += 1;
    group.runIds.add(combined.runId);
    if (combined.targetApp) {
      group.targetApps.add(combined.targetApp);
    }
    group.cpuValues.push(combined.cpuMillicores);
    group.memoryValues.push(combined.memoryMiB);
  }

  return [...perRoleGroups.values()]
    .map((group) => ({
      architecture: group.architecture,
      mode: group.mode,
      scenario: group.scenario,
      role: group.role,
      sampleCount: group.sampleCount,
      runCount: group.runIds.size,
      targetApps: [...group.targetApps].sort(),
      avgCpuMillicores: group.cpuValues.length ? avg(group.cpuValues) : null,
      peakCpuMillicores: group.cpuValues.length ? max(group.cpuValues) : null,
      avgMemoryMiB: group.memoryValues.length ? avg(group.memoryValues) : null,
      peakMemoryMiB: group.memoryValues.length ? max(group.memoryValues) : null,
    }))
    .sort((a, b) =>
      `${a.architecture}|${a.mode}|${a.scenario}|${a.role}`.localeCompare(
        `${b.architecture}|${b.mode}|${b.scenario}|${b.role}`,
      ),
    );
}

export function buildSummaryRows(latencyGroups, resourceGroups) {
  const latencyByKey = new Map(
    latencyGroups.map((group) => [
      `${group.architecture}|${group.mode}|${group.scenario}|${group.signal}`,
      group,
    ]),
  );
  const resourceByKey = new Map(
    resourceGroups.map((group) => [
      `${group.architecture}|${group.mode}|${group.scenario}|${group.role}`,
      group,
    ]),
  );

  const architectureModeScenarios = new Set([
    ...latencyGroups.map((group) => `${group.architecture}|${group.mode}|${group.scenario}`),
    ...resourceGroups.map((group) => `${group.architecture}|${group.mode}|${group.scenario}`),
  ]);

  return [...architectureModeScenarios]
    .sort()
    .map((key) => {
      const [architecture, mode, scenario] = key.split("|");
      const startup = latencyByKey.get(`${key}|startup-session-ready`);
      const firstError = latencyByKey.get(`${key}|first-error-latency`);
      const warmError = latencyByKey.get(`${key}|warm-error-latency`);
      const cleanState = latencyByKey.get(`${key}|clean-state-latency`);
      const firstHover = latencyByKey.get(`${key}|first-hover-latency`);
      const warmHover = latencyByKey.get(`${key}|warm-hover-latency`);
      const ide = resourceByKey.get(`${key}|ide`);
      const sidecar = resourceByKey.get(`${key}|sidecar`);
      const combined = resourceByKey.get(`${key}|combined`);
      const targetApps = new Set([
        ...(startup?.targetApps || []),
        ...(firstError?.targetApps || []),
        ...(warmError?.targetApps || []),
        ...(cleanState?.targetApps || []),
        ...(firstHover?.targetApps || []),
        ...(warmHover?.targetApps || []),
        ...(ide?.targetApps || []),
        ...(sidecar?.targetApps || []),
        ...(combined?.targetApps || []),
      ]);

      return {
        architecture,
        mode,
        scenario,
        targetApps: [...targetApps].sort(),
        runCount: Math.max(
          warmError?.runCount || 0,
          warmHover?.runCount || 0,
          firstError?.runCount || 0,
          firstHover?.runCount || 0,
          startup?.runCount || 0,
          cleanState?.runCount || 0,
          combined?.runCount || 0,
          ide?.runCount || 0,
          sidecar?.runCount || 0,
        ),
        warmProbeCount: warmError?.sampleCount || warmHover?.sampleCount || 0,
        startupMedianMs: startup?.medianLatencyMs ?? null,
        firstErrorMedianMs: firstError?.medianLatencyMs ?? null,
        warmErrorMedianMs: warmError?.medianLatencyMs ?? null,
        warmErrorP95Ms: warmError?.p95LatencyMs ?? null,
        cleanStateMedianMs: cleanState?.medianLatencyMs ?? null,
        firstHoverMedianMs: firstHover?.medianLatencyMs ?? null,
        warmHoverMedianMs: warmHover?.medianLatencyMs ?? null,
        warmHoverP95Ms: warmHover?.p95LatencyMs ?? null,
        ideAvgCpuMillicores: ide?.avgCpuMillicores ?? null,
        idePeakCpuMillicores: ide?.peakCpuMillicores ?? null,
        ideAvgMemoryMiB: ide?.avgMemoryMiB ?? null,
        idePeakMemoryMiB: ide?.peakMemoryMiB ?? null,
        sidecarAvgCpuMillicores: sidecar?.avgCpuMillicores ?? null,
        sidecarPeakCpuMillicores: sidecar?.peakCpuMillicores ?? null,
        sidecarAvgMemoryMiB: sidecar?.avgMemoryMiB ?? null,
        sidecarPeakMemoryMiB: sidecar?.peakMemoryMiB ?? null,
        combinedAvgCpuMillicores: combined?.avgCpuMillicores ?? null,
        combinedPeakCpuMillicores: combined?.peakCpuMillicores ?? null,
        combinedAvgMemoryMiB: combined?.avgMemoryMiB ?? null,
        combinedPeakMemoryMiB: combined?.peakMemoryMiB ?? null,
      };
    });
}

function csvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return `"${value.join(";")}"`;
  }
  return `${value}`;
}

export function toCsv(rows) {
  if (rows.length === 0) {
    return "";
  }
  const header = Object.keys(rows[0]);
  const body = rows.map((row) =>
    header.map((column) => csvValue(row[column])).join(","),
  );
  return [header.join(","), ...body].join("\n") + "\n";
}

export function formatMetric(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return Number(value).toFixed(decimals);
}

export function formatComparisonMarkdown(summaryRows) {
  const lines = [
    "# Embedded vs Extracted Benchmark Comparison",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Architecture | Mode | Scenario | Target App | Runs | Warm Probes | Startup Median (ms) | First Error Median (ms) | Warm Error Median (ms) | Warm Error p95 (ms) | First Hover Median (ms) | Warm Hover Median (ms) | Warm Hover p95 (ms) | Clean-State Median (ms) | Combined Avg CPU (m) | Combined Peak CPU (m) | Combined Avg Memory (MiB) | Combined Peak Memory (MiB) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of summaryRows) {
    lines.push(
      `| ${row.architecture} | ${row.mode} | ${row.scenario} | ${row.targetApps.join(", ") || "n/a"} | ${row.runCount} | ${row.warmProbeCount} | ${formatMetric(row.startupMedianMs)} | ${formatMetric(row.firstErrorMedianMs)} | ${formatMetric(row.warmErrorMedianMs)} | ${formatMetric(row.warmErrorP95Ms)} | ${formatMetric(row.firstHoverMedianMs)} | ${formatMetric(row.warmHoverMedianMs)} | ${formatMetric(row.warmHoverP95Ms)} | ${formatMetric(row.cleanStateMedianMs)} | ${formatMetric(row.combinedAvgCpuMillicores)} | ${formatMetric(row.combinedPeakCpuMillicores)} | ${formatMetric(row.combinedAvgMemoryMiB)} | ${formatMetric(row.combinedPeakMemoryMiB)} |`,
    );
  }

  return lines.join("\n") + "\n";
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeTextFile(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents, "utf8");
}
