#!/usr/bin/env node
// Turns the JSONL results of bench.mjs into Markdown tables per variant and mode.
// Usage: node report.mjs results.jsonl [more.jsonl ...] > report.md
import { readFileSync } from "node:fs";
import { summarize } from "./lib.mjs";

const METRICS = [
  ["url", "Control plane publishes the URL"],
  ["scheduled", "Pod scheduled"],
  ["running", "IDE container running"],
  ["podReady", "Pod ready"],
  ["http200", "Theia answers HTTP"],
  ["shell", "Workbench shell visible"],
  ["explorer", "Explorer tree rendered"],
  ["routed", "Public route answers"],
  ["routeAccepted", "Gateway accepted the session route"],
  ["controlPlaneReady", "Control plane reports ready"],
];

const runs = process.argv.slice(2).flatMap((f) =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l)),
);

const groups = new Map();
for (const r of runs) {
  const key = `${r.variant} / ${r.mode}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const s = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(1) : "-");

for (const [key, all] of groups) {
  const ok = all.filter((r) => !r.failure && !r.imagePulled);
  const failed = all.filter((r) => r.failure);
  const pulled = all.filter((r) => r.imagePulled);
  console.log(`## ${key}\n`);
  console.log(
    `${all.length} runs, ${ok.length} counted, ${failed.length} failed, ${pulled.length} left out because the node pulled the image.`,
  );
  if (all.length)
    console.log(
      `From ${all[0].startedAt} to ${all[all.length - 1].startedAt}.\n`,
    );
  console.log(
    "| Milestone (s after CR created) | n | median | p90 | min | max | mean | sd |",
  );
  console.log("|---|---|---|---|---|---|---|---|");
  for (const [name, label] of METRICS) {
    const st = summarize(ok.map((r) => r.ms[name]));
    if (!st.n) continue;
    console.log(
      `| ${label} | ${st.n} | ${s(st.median)} | ${s(st.p90)} | ${s(st.min)} | ${s(st.max)} | ${s(st.mean)} | ${s(st.sd)} |`,
    );
  }
  const cleanup = summarize(ok.map((r) => r.cleanupMs));
  if (cleanup.n)
    console.log(
      `| Cleanup (delete until pod gone) | ${cleanup.n} | ${s(cleanup.median)} | ${s(cleanup.p90)} | ${s(cleanup.min)} | ${s(cleanup.max)} | ${s(cleanup.mean)} | ${s(cleanup.sd)} |`,
    );
  const refill = summarize(ok.map((r) => r.poolRefillMs));
  if (refill.n)
    console.log(
      `| Pool refilled (delete until a ready idle instance) | ${refill.n} | ${s(refill.median)} | ${s(refill.p90)} | ${s(refill.min)} | ${s(refill.max)} | ${s(refill.mean)} | ${s(refill.sd)} |`,
    );
  const objects = summarize(ok.map((r) => r.objectsCreated.length));
  const cpu = summarize(ok.map((r) => r.controlPlaneTop?.after?.cpuMilli));
  const mem = summarize(ok.map((r) => r.controlPlaneTop?.after?.memMi));
  console.log(
    `\nObjects created per session (median): ${objects.median ?? "-"}. Control plane after a start (median): ${cpu.median ?? "-"}m CPU, ${mem.median ?? "-"} Mi memory.`,
  );
  const strategies = [
    ...new Set(ok.map((r) => r.startStrategy).filter(Boolean)),
  ];
  if (strategies.length)
    console.log(
      `Start strategy reported by the control plane: ${strategies.join(", ")}.`,
    );
  for (const r of failed)
    console.log(`- Failed run ${r.run} (${r.startedAt}): ${r.failure}`);
  console.log("");
}
