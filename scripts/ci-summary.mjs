// Turns Playwright's JSON report and the metric files into a Markdown summary
// for the run page and a self-contained HTML page for download.
import fs from "fs";
import {
  readMetrics,
  renderHtml,
  renderMarkdown,
  summarize,
} from "./lib/ci-summary.mjs";

const resultsFile = process.env.RESULTS_FILE ?? "test-results/results.json";
const report = fs.existsSync(resultsFile)
  ? JSON.parse(fs.readFileSync(resultsFile, "utf8"))
  : undefined;
let environment = "";
try {
  environment = new URL(process.env.LANDINGPAGE_URL ?? "").hostname;
} catch {
  environment = process.env.LANDINGPAGE_URL ?? "";
}

const summary = summarize({
  report,
  metrics: readMetrics(process.env.METRICS_DIR ?? "test-data/metrics"),
  environment,
});

const markdown = renderMarkdown(summary);
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
else console.log(markdown);

fs.mkdirSync("ci-summary", { recursive: true });
fs.writeFileSync("ci-summary/index.html", renderHtml(summary));
