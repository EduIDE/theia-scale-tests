import { test, expect } from "@playwright/test";
import {
  aggregateLatencyRecords,
  aggregateResourceRows,
  buildSummaryRows,
  collectCompleteLatencyRunKeys,
  filterLatencyRecordsToCompleteRuns,
  filterResourceRowsToCompleteRuns,
  parseCpuMillicores,
  parseMemoryMiB,
} from "../../../scripts/lib/benchmark-aggregation.mjs";

test("aggregateLatencyRecords groups signals and computes summary statistics", async () => {
  const groups = aggregateLatencyRecords([
    {
      timestamp: "2026-03-30T00:00:00Z",
      architecture: "external",
      mode: "warm",
      scenario: "simple-type-error",
      run: 1,
      runId: "external-warm-run-1",
      probe: 1,
      latencyMs: 1000,
      timedOut: false,
      signal: "warm-error-latency",
      ideUrl: "https://example.invalid/1",
      file: "BubbleSort.java",
      targetApp: "java-17-no-ls",
    },
    {
      timestamp: "2026-03-30T00:00:10Z",
      architecture: "external",
      mode: "warm",
      scenario: "simple-type-error",
      run: 2,
      runId: "external-warm-run-2",
      probe: 1,
      latencyMs: 2000,
      timedOut: false,
      signal: "warm-error-latency",
      ideUrl: "https://example.invalid/2",
      file: "BubbleSort.java",
      targetApp: "java-17-no-ls",
    },
  ]);

  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({
    architecture: "external",
    mode: "warm",
    signal: "warm-error-latency",
    sampleCount: 2,
    runCount: 2,
    medianLatencyMs: 1500,
    p95LatencyMs: 2000,
    avgLatencyMs: 1500,
    maxLatencyMs: 2000,
  });
});

test("aggregateResourceRows computes per-role and combined summaries", async () => {
  const groups = aggregateResourceRows([
    {
      timestamp: "2026-03-30T00:00:00Z",
      run_id: "run-1",
      architecture: "external",
      mode: "warm",
      scenario: "simple-type-error",
      target_app: "java-17-no-ls",
      pod: "session-a",
      container: "java-17-no-ls",
      role: "ide",
      cpu_raw: "100m",
      memory_raw: "200Mi",
    },
    {
      timestamp: "2026-03-30T00:00:00Z",
      run_id: "run-1",
      architecture: "external",
      mode: "warm",
      scenario: "simple-type-error",
      target_app: "java-17-no-ls",
      pod: "sidecar-a",
      container: "langserver",
      role: "sidecar",
      cpu_raw: "50m",
      memory_raw: "300Mi",
    },
  ]);

  const combined = groups.find((group) => group.role === "combined");
  expect(combined).toMatchObject({
    architecture: "external",
    mode: "warm",
    avgCpuMillicores: 150,
    peakCpuMillicores: 150,
    avgMemoryMiB: 500,
    peakMemoryMiB: 500,
  });
});

test("buildSummaryRows merges latency and resource summaries into one row", async () => {
  const rows = buildSummaryRows(
    [
      {
        architecture: "external",
        mode: "warm",
        scenario: "simple-type-error",
        signal: "warm-error-latency",
        sampleCount: 10,
        runCount: 2,
        targetApps: ["java-17-no-ls"],
        timedOutCount: 0,
        medianLatencyMs: 1200,
        p95LatencyMs: 2000,
        avgLatencyMs: 1300,
        maxLatencyMs: 2200,
      },
    ],
    [
      {
        architecture: "external",
        mode: "warm",
        scenario: "simple-type-error",
        role: "combined",
        sampleCount: 10,
        runCount: 2,
        targetApps: ["java-17-no-ls"],
        avgCpuMillicores: 180,
        peakCpuMillicores: 400,
        avgMemoryMiB: 650,
        peakMemoryMiB: 900,
      },
    ],
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
      architecture: "external",
      mode: "warm",
      scenario: "simple-type-error",
      runCount: 2,
    warmProbeCount: 10,
    warmErrorMedianMs: 1200,
    warmErrorP95Ms: 2000,
    combinedAvgCpuMillicores: 180,
    combinedPeakMemoryMiB: 900,
  });
});

test("complete-run filtering excludes partial warm runs", async () => {
  const records = [
    {
      architecture: "external",
      mode: "warm",
      scenario: "simple-type-error",
      runId: "run-complete",
      timedOut: false,
      signal: "startup-session-ready",
      latencyMs: 20000,
    },
    {
      architecture: "external",
      mode: "warm",
      scenario: "simple-type-error",
      runId: "run-complete",
      timedOut: false,
      signal: "first-error-latency",
      latencyMs: 4000,
    },
    {
      architecture: "external",
      mode: "warm",
      scenario: "simple-type-error",
      runId: "run-complete",
      timedOut: false,
      signal: "clean-state-latency",
      latencyMs: 1000,
    },
    {
      architecture: "external",
      mode: "warm",
      scenario: "simple-type-error",
      runId: "run-complete",
      timedOut: false,
      signal: "warm-error-latency",
      latencyMs: 900,
    },
    {
      architecture: "external",
      mode: "warm",
      scenario: "simple-type-error",
      runId: "run-partial",
      timedOut: false,
      signal: "startup-session-ready",
      latencyMs: 50000,
    },
  ];

  const completeRunKeys = collectCompleteLatencyRunKeys(records);
  const filteredRecords = filterLatencyRecordsToCompleteRuns(records, completeRunKeys);
  const filteredResourceRows = filterResourceRowsToCompleteRuns(
    [
      {
        architecture: "external",
        mode: "warm",
        scenario: "simple-type-error",
        run_id: "run-complete",
        role: "ide",
        cpu_raw: "100m",
        memory_raw: "200Mi",
      },
      {
        architecture: "external",
        mode: "warm",
        scenario: "simple-type-error",
        run_id: "run-partial",
        role: "ide",
        cpu_raw: "250m",
        memory_raw: "400Mi",
      },
    ],
    completeRunKeys,
  );

  expect([...completeRunKeys]).toEqual(["external|warm|simple-type-error|run-complete"]);
  expect(filteredRecords).toHaveLength(4);
  expect(filteredResourceRows).toHaveLength(1);
  expect(filteredResourceRows[0].run_id).toBe("run-complete");
});

test("hover runs are treated as complete without error signals", async () => {
  const completeRunKeys = collectCompleteLatencyRunKeys([
    {
      architecture: "embedded",
      mode: "warm",
      scenario: "hover-context",
      runId: "hover-run",
      timedOut: false,
      signal: "startup-session-ready",
      latencyMs: 20000,
    },
    {
      architecture: "embedded",
      mode: "warm",
      scenario: "hover-context",
      runId: "hover-run",
      timedOut: false,
      signal: "first-hover-latency",
      latencyMs: 2500,
    },
    {
      architecture: "embedded",
      mode: "warm",
      scenario: "hover-context",
      runId: "hover-run",
      timedOut: false,
      signal: "warm-hover-latency",
      latencyMs: 900,
    },
  ]);

  expect([...completeRunKeys]).toEqual(["embedded|warm|hover-context|hover-run"]);
});

test("resource unit parsers normalize kubectl top values", async () => {
  expect(parseCpuMillicores("125m")).toBe(125);
  expect(parseCpuMillicores("1")).toBe(1000);
  expect(parseMemoryMiB("512Mi")).toBe(512);
  expect(parseMemoryMiB("1Gi")).toBe(1024);
  expect(parseMemoryMiB("1K")).toBeCloseTo(1000 / 1024 / 1024);
  expect(parseMemoryMiB("1M")).toBeCloseTo(1000 * 1000 / 1024 / 1024);
  expect(parseMemoryMiB("1G")).toBeCloseTo(1000 * 1000 * 1000 / 1024 / 1024);
});
