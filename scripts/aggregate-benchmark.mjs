#!/usr/bin/env node

import path from "path";
import {
  aggregateLatencyRecords,
  aggregateResourceRows,
  buildSummaryRows,
  collectCompleteLatencyRunKeys,
  filterLatencyRecordsToCompleteRuns,
  filterResourceRowsToCompleteRuns,
  formatComparisonMarkdown,
  readJsonLinesFile,
  readResourceCsvFile,
  toCsv,
  writeTextFile,
} from "./lib/benchmark-aggregation.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--")
      ? argv[++index]
      : "true";
    args[key] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const outputDir = args["output-dir"] || process.env.BENCH_OUTPUT_DIR || "test-data/benchmark";
const latencyFile = path.join(outputDir, "raw", "latency-raw.jsonl");
const resourceFile = path.join(outputDir, "raw", "resource-raw.csv");

const latencyRecords = readJsonLinesFile(latencyFile);
if (latencyRecords.length === 0) {
  console.error(`No latency benchmark records found at ${latencyFile}`);
  process.exit(1);
}

const resourceRows = readResourceCsvFile(resourceFile);
const completeRunKeys = collectCompleteLatencyRunKeys(latencyRecords);
const completeLatencyRecords = filterLatencyRecordsToCompleteRuns(latencyRecords, completeRunKeys);
const completeResourceRows = filterResourceRowsToCompleteRuns(resourceRows, completeRunKeys);

if (completeLatencyRecords.length === 0) {
  console.error(
    `No complete benchmark runs found in ${latencyFile}; partial or failed runs were excluded`,
  );
  process.exit(1);
}

const latencyGroups = aggregateLatencyRecords(completeLatencyRecords);
const resourceGroups = aggregateResourceRows(completeResourceRows);
const summaryRows = buildSummaryRows(latencyGroups, resourceGroups);

const summary = {
  generatedAt: new Date().toISOString(),
  outputDir,
  files: {
    latencyFile,
    resourceFile,
  },
  completeRunCount: completeRunKeys.size,
  excludedLatencyRecordCount: latencyRecords.length - completeLatencyRecords.length,
  excludedResourceSampleCount: resourceRows.length - completeResourceRows.length,
  latencyGroups,
  resourceGroups,
  summaryRows,
};

writeTextFile(
  path.join(outputDir, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
writeTextFile(path.join(outputDir, "summary.csv"), toCsv(summaryRows));
writeTextFile(path.join(outputDir, "latency-groups.csv"), toCsv(latencyGroups));
writeTextFile(path.join(outputDir, "resource-groups.csv"), toCsv(resourceGroups));
writeTextFile(
  path.join(outputDir, "reports", "compare-embedded-vs-extracted.md"),
  formatComparisonMarkdown(summaryRows),
);

console.log(
  `Aggregated ${completeLatencyRecords.length} latency records from ${latencyFile} across ${completeRunKeys.size} complete runs`,
);
if (resourceRows.length > 0) {
  console.log(
    `Aggregated ${completeResourceRows.length} resource samples from ${resourceFile}`,
  );
} else {
  console.log(`No resource samples found at ${resourceFile}; latency-only summary generated`);
}
if (latencyRecords.length !== completeLatencyRecords.length || resourceRows.length !== completeResourceRows.length) {
  console.log(
    `Excluded ${latencyRecords.length - completeLatencyRecords.length} latency records and ${resourceRows.length - completeResourceRows.length} resource samples from incomplete runs`,
  );
}
console.log(`Wrote summary artifacts to ${outputDir}`);
