import fs from "fs";
import path from "path";

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const MAX_ERROR = 200;
const MAX_IMAGE_BYTES = 1_500_000;

export const stripAnsi = (s) => String(s ?? "").replace(ANSI, "");

export const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const escapeCell = (s) =>
  String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** First line of an error, without colour codes, cut to a length a table can hold. */
export function firstErrorLine(result) {
  const raw = result?.error?.message ?? result?.errors?.[0]?.message ?? "";
  const line =
    stripAnsi(raw)
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  return line.length > MAX_ERROR ? `${line.slice(0, MAX_ERROR - 3)}...` : line;
}

/** Flattens the nested suites of Playwright's JSON report into one test per entry. */
export function collectTests(report) {
  const tests = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const results = t.results ?? [];
        const last = results[results.length - 1];
        // A test that never started has no results, a skipped one has a skipped result.
        const outcome =
          results.length === 0 && t.status === "skipped" ? "notrun" : t.status;
        tests.push({
          file: spec.file ?? suite.file ?? "",
          title: spec.title,
          project: t.projectName ?? "",
          outcome,
          attempts: results.length,
          duration: results.reduce((sum, r) => sum + (r.duration ?? 0), 0),
          error:
            outcome === "unexpected" || outcome === "flaky"
              ? firstErrorLine(
                  results.find(
                    (r) => r.status !== "passed" && r.status !== "skipped",
                  ) ?? last,
                )
              : "",
          attachments: results.flatMap((r) => r.attachments ?? []),
          // Annotations of the test, plus those a retry added.
          recovered: [
            ...(t.annotations ?? []),
            ...results.flatMap((r) => r.annotations ?? []),
          ]
            .filter((a) => a.type === "recovered")
            .map((a) => stripAnsi(a.description ?? "")),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return tests;
}

export function readMetrics(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        `${a.app}${a.template}`.localeCompare(`${b.app}${b.template}`),
    );
}

const minutes = (ms) => `${(ms / 60000).toFixed(1)} min`;

/** Everything both renderings show, computed once. */
export function summarize({ report, metrics = [], environment = "" }) {
  const tests = report ? collectTests(report) : [];
  const by = (o) => tests.filter((t) => t.outcome === o);
  const counts = {
    passed: by("expected").length,
    failed: by("unexpected").length,
    flaky: by("flaky").length,
    skipped: by("skipped").length,
    notRun: by("notrun").length,
  };
  const perSpec = {};
  for (const t of tests) perSpec[t.file] = (perSpec[t.file] ?? 0) + t.duration;
  return {
    environment,
    noResults: !report,
    green: !!report && counts.failed === 0 && counts.notRun === 0,
    counts,
    durationMs: report?.stats?.duration ?? 0,
    failed: by("unexpected"),
    flaky: by("flaky"),
    recovered: tests.filter((t) => t.recovered.length),
    perSpec: Object.entries(perSpec).sort((a, b) => b[1] - a[1]),
    metrics,
  };
}

const metricLabel = (m) =>
  [m.app, m.template].filter(Boolean).join(" / ") || "-";

export function renderMarkdown(s) {
  const out = [];
  const verdict = s.noResults
    ? "RED (no test results, the run stopped before the tests)"
    : s.green
      ? "GREEN"
      : "RED";
  out.push(
    `## E2E: ${verdict}${s.environment ? ` on ${s.environment}` : ""}`,
    "",
  );
  const c = s.counts;
  out.push(
    `${c.passed} passed, ${c.failed} failed, ${c.flaky} flaky, ${c.skipped} skipped, ${c.notRun} did not run. Total ${minutes(s.durationMs)}.`,
    "",
  );
  const testTable = (rows, withError) => {
    const lines = [
      `| Spec | Test | Project | Attempts |${withError ? " Error |" : ""}`,
      `|---|---|---|---|${withError ? "---|" : ""}`,
    ];
    for (const t of rows) {
      lines.push(
        `| ${escapeCell(t.file)} | ${escapeCell(t.title)} | ${escapeCell(t.project)} | ${t.attempts} |${withError ? ` ${escapeCell(t.error)} |` : ""}`,
      );
    }
    return lines;
  };
  if (s.failed.length)
    out.push("### Failed", "", ...testTable(s.failed, true), "");
  if (s.flaky.length)
    out.push("### Flaky", "", ...testTable(s.flaky, true), "");
  if (s.recovered.length) {
    out.push(
      "### Recovered",
      "",
      "A step failed and was repeated. A student could hit this too.",
      "",
      "| Spec | Test | What happened |",
      "|---|---|---|",
    );
    for (const t of s.recovered) {
      for (const d of new Set(t.recovered)) {
        out.push(
          `| ${escapeCell(t.file)} | ${escapeCell(t.title)} | ${escapeCell(d)} |`,
        );
      }
    }
    out.push("");
  }
  if (s.perSpec.length) {
    out.push(
      "<details><summary>Duration per spec</summary>",
      "",
      "| Spec | Time |",
      "|---|---|",
    );
    for (const [file, ms] of s.perSpec)
      out.push(`| ${escapeCell(file)} | ${minutes(ms)} |`);
    out.push("", "</details>", "");
  }
  if (s.metrics.length) {
    out.push(
      "<details><summary>Metrics</summary>",
      "",
      "| Name | App / template | ms |",
      "|---|---|---|",
    );
    for (const m of s.metrics)
      out.push(
        `| ${escapeCell(m.name)} | ${escapeCell(metricLabel(m))} | ${m.ms} |`,
      );
    out.push("", "</details>", "");
  }
  return out.join("\n");
}

/** Screenshots Playwright already saved for failed tests, as data URIs. */
export function inlineScreenshots(test) {
  return test.attachments
    .filter(
      (a) =>
        a.contentType?.startsWith("image/") && a.path && fs.existsSync(a.path),
    )
    .filter((a) => fs.statSync(a.path).size <= MAX_IMAGE_BYTES)
    .map(
      (a) =>
        `data:${a.contentType};base64,${fs.readFileSync(a.path).toString("base64")}`,
    );
}

export function renderHtml(s, screenshotsFor = inlineScreenshots) {
  const e = escapeHtml;
  const table = (head, rows) =>
    `<table><thead><tr>${head.map((h) => `<th>${e(h)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${e(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  const testRows = (rows) =>
    rows.map((t) => [t.file, t.title, t.project, t.attempts, t.error]);
  const testHead = ["Spec", "Test", "Project", "Attempts", "Error"];
  const c = s.counts;
  const verdict = s.noResults
    ? "RED (no test results)"
    : s.green
      ? "GREEN"
      : "RED";
  const shots = s.failed
    .map((t) => ({ t, images: screenshotsFor(t) }))
    .filter((x) => x.images.length)
    .map(
      ({ t, images }) =>
        `<h3>${e(t.title)}</h3>${images.map((src) => `<img alt="screenshot" src="${src}">`).join("")}`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>E2E summary</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}
body{margin:0 auto;max-width:1100px;padding:16px}
table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{border:1px solid #8884;padding:4px 8px;text-align:left;vertical-align:top;word-break:break-word}
.green{color:#1a7f37}.red{color:#cf222e}
img{max-width:100%;border:1px solid #8884;margin:4px 0}
</style></head><body>
<h1>E2E <span class="${s.green ? "green" : "red"}">${e(verdict)}</span>${s.environment ? ` on ${e(s.environment)}` : ""}</h1>
<p>${c.passed} passed, ${c.failed} failed, ${c.flaky} flaky, ${c.skipped} skipped, ${c.notRun} did not run. Total ${e(minutes(s.durationMs))}.</p>
${s.failed.length ? `<h2>Failed</h2>${table(testHead, testRows(s.failed))}` : ""}
${s.flaky.length ? `<h2>Flaky</h2>${table(testHead, testRows(s.flaky))}` : ""}
${
  s.recovered.length
    ? `<h2>Recovered</h2><p>A step failed and was repeated. A student could hit this too.</p>${table(
        ["Spec", "Test", "What happened"],
        s.recovered.flatMap((t) =>
          [...new Set(t.recovered)].map((d) => [t.file, t.title, d]),
        ),
      )}`
    : ""
}
${shots ? `<h2>Screenshots of failed tests</h2>${shots}` : ""}
${
  s.perSpec.length
    ? `<details><summary>Duration per spec</summary>${table(
        ["Spec", "Time"],
        s.perSpec.map(([f, ms]) => [f, minutes(ms)]),
      )}</details>`
    : ""
}
${
  s.metrics.length
    ? `<details><summary>Metrics</summary>${table(
        ["Name", "App / template", "ms"],
        s.metrics.map((m) => [m.name, metricLabel(m), m.ms]),
      )}</details>`
    : ""
}
</body></html>
`;
}
