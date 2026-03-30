import { test, expect } from "@playwright/test";
import path from "path";

import { LandingPage } from "../../../pages/landing/LandingPage";
import { TheiaApp } from "../../../pages/ide/theia-pom/theia-app";
import { IDEPage } from "../../../pages/ide/IDEPage";
import { TheiaOutputView } from "../../../pages/ide/theia-pom/theia-output-view";
import { TheiaProblemIndicator } from "../../../pages/ide/theia-pom/theia-problem-indicator";
import { TheiaWorkspace } from "../../../pages/ide/theia-pom/theia-workspace";
import { TheiaTextEditor } from "../../../pages/ide/theia-pom/theia-text-editor";
import { debugLog } from "../../../fixtures/utils/debug-logging";
import {
  appendBenchmarkLatencyRecord,
  type BenchmarkLatencyRecord,
} from "../../../fixtures/utils/benchmark-metrics";

test("ui diagnostic latency benchmark skeleton", async ({ page }) => {
  const outputDir = process.env.BENCH_OUTPUT_DIR || "test-data/benchmark";
  const benchmarkFile = process.env.BENCH_FIXED_FILE || "BenchLatency.java";
  const benchmarkClassName = path.basename(benchmarkFile, ".java") || "BenchLatency";
  const benchmarkFileName = path.basename(benchmarkFile) || "BenchLatency.java";
  const setupTimeoutMs = process.env.BENCH_SETUP_TIMEOUT_MS
    ? parseInt(process.env.BENCH_SETUP_TIMEOUT_MS, 10)
    : 300000;
  const probeTimeoutMs = process.env.BENCH_PROBE_TIMEOUT_MS
    ? parseInt(process.env.BENCH_PROBE_TIMEOUT_MS, 10)
    : 60000;
  const warmupTimeoutMs = process.env.BENCH_WARMUP_TIMEOUT_MS
    ? parseInt(process.env.BENCH_WARMUP_TIMEOUT_MS, 10)
    : 90000;
  const stabilizationWaitMs = process.env.BENCH_STABILIZATION_WAIT_MS
    ? parseInt(process.env.BENCH_STABILIZATION_WAIT_MS, 10)
    : 20000;
  const warmProbeCount = process.env.BENCH_PROBES
    ? parseInt(process.env.BENCH_PROBES, 10)
    : 5;
  const targetApp = process.env.BENCH_TARGET_APP || "java-17-no-ls";

  debugLog("benchmark", "open landing", {
    targetApp,
    setupTimeoutMs,
    warmProbeCount,
  });
  await page.goto("/");
  const landingPage = new LandingPage(page);
  const startupStartedAt = Date.now();
  await landingPage.launchLanguage(targetApp);
  await page.waitForURL(/.*#\/home\/project/, { timeout: setupTimeoutMs });

  const workspace = new TheiaWorkspace();
  workspace.setPath("/home/project");
  const theiaApp = new TheiaApp(page, workspace, false);
  const idePage = new IDEPage(page, theiaApp, page.url());

  debugLog("benchmark", "wait for shell initialized");
  await waitForShellInitializedWithTimeout(theiaApp, setupTimeoutMs);
  const startupLatencyMs = Date.now() - startupStartedAt;
  const ideUrl = page.url();
  debugLog("benchmark", "startup completed", { startupLatencyMs, ideUrl });

  appendBenchmarkLatencyRecord(outputDir, {
    timestamp: new Date().toISOString(),
    architecture: process.env.BENCH_ARCH || "external",
    mode: process.env.BENCH_MODE || "warm",
    run: 1,
    probe: 0,
    latencyMs: startupLatencyMs,
    timedOut: false,
    signal: "startup-session-ready",
    ideUrl,
    file: benchmarkFileName,
  });

  debugLog("benchmark", "prepare benchmark file", {
    benchmarkFileName,
  });

  await idePage.createNewFile(benchmarkFileName);
  const editor = await theiaApp.openEditor(benchmarkFileName, TheiaTextEditor);
  await writeValidBaselineClass(page, benchmarkClassName);

  const squigglyError = page.locator(".monaco-editor .squiggly-error").first();
  const problemIndicator = new TheiaProblemIndicator(theiaApp.statusBar);
  await squigglyError.waitFor({ state: "hidden", timeout: 30000 });
  debugLog("benchmark", "baseline established", { signal: "squiggly hidden" });

  // warmup: establish diagnostics path once before measurement
  await editor.addTextToNewLineAfterLineByLineNumber(2, 'int warmupBroken = "x"; // BENCH_WARMUP');
  const warmupStartedAt = Date.now();
  try {
    await squigglyError.waitFor({ state: "visible", timeout: warmupTimeoutMs });
  } catch {
    const debugSnapshot = await collectDebugSnapshot(page, problemIndicator, theiaApp);
    debugLog("benchmark", "warmup diagnostics did not appear", debugSnapshot);
    throw new Error(
      `Warmup squiggly timeout after ${warmupTimeoutMs}ms | problems=${debugSnapshot.problems} warnings=${debugSnapshot.warnings} squiggles=${debugSnapshot.squiggleCount} outputTail=${debugSnapshot.outputTail}`,
    );
  }
  const firstErrorLatencyMs = Date.now() - warmupStartedAt;
  debugLog("benchmark", "warmup diagnostics latency", {
    firstErrorLatencyMs,
  });
  debugLog("benchmark", "warmup diagnostics visible");

  appendBenchmarkLatencyRecord(outputDir, {
    timestamp: new Date().toISOString(),
    architecture: process.env.BENCH_ARCH || "external",
    mode: process.env.BENCH_MODE || "warm",
    run: 1,
    probe: 1,
    latencyMs: firstErrorLatencyMs,
    timedOut: false,
    signal: "first-error-latency",
    ideUrl,
    file: benchmarkFileName,
  });

  await writeValidBaselineClass(page, benchmarkClassName);
  await waitForCleanState(page, problemIndicator, 90000);
  debugLog("benchmark", "baseline reset after warmup");

  // explicit stabilization window: LS can still initialize projects after first diagnostics
  debugLog("benchmark", "stabilization wait before measured probe", {
    stabilizationWaitMs,
  });
  await page.waitForTimeout(stabilizationWaitMs);
  debugLog("benchmark", "stabilization complete");

  // measured cycles: unclean -> clean, then clean -> unclean
  for (let probe = 1; probe <= warmProbeCount; probe++) {
    await writeValidBaselineClass(page, benchmarkClassName);
    const toCleanStartedAt = Date.now();
    await waitForCleanState(page, problemIndicator, 90000);
    const cleanLatencyMs = Date.now() - toCleanStartedAt;

    debugLog("benchmark", "clean transition latency", {
      probe,
      cleanLatencyMs,
      signal: "squiggly-hidden",
    });

    appendBenchmarkLatencyRecord(outputDir, {
      timestamp: new Date().toISOString(),
      architecture: process.env.BENCH_ARCH || "external",
      mode: process.env.BENCH_MODE || "warm",
      run: 1,
      probe,
      latencyMs: cleanLatencyMs,
      timedOut: false,
      signal: "clean-state-latency",
      ideUrl,
      file: benchmarkFileName,
    });

    const startedAt = Date.now();
    await editor.addTextToNewLineAfterLineByLineNumber(
      2,
      `int broken${probe} = \"x\"; // BENCH_MARKER_${probe}`,
    );
    const errorResult = await waitForErrorWithNudge(page, squigglyError, probeTimeoutMs, 5000);
    const latencyMs = Date.now() - startedAt;

    debugLog("benchmark", "warm probe latency", {
      probe,
      latencyMs,
      nudged: errorResult.nudged,
      signal: "monaco-squiggly-error",
    });

    const record: BenchmarkLatencyRecord = {
      timestamp: new Date().toISOString(),
      architecture: process.env.BENCH_ARCH || "external",
      mode: process.env.BENCH_MODE || "warm",
      run: 1,
      probe,
      latencyMs,
      timedOut: false,
      signal: "warm-error-latency",
      ideUrl,
      file: benchmarkFileName,
    };
    appendBenchmarkLatencyRecord(outputDir, record);
    expect(latencyMs).toBeGreaterThanOrEqual(0);
  }

  expect(editor).toBeDefined();
});

async function writeValidBaselineClass(
  page: import("@playwright/test").Page,
  className: string,
  maxRetries = 3,
): Promise<void> {
  const baselineLines = [
    `public class ${className} {`,
    "  public static void main(String[] args) {",
    "    int value = 1;",
    "    System.out.println(value);",
    "  }",
    "}",
  ];
  const baseline = baselineLines.join("\n") + "\n";

  const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
  const save = process.platform === "darwin" ? "Meta+S" : "Control+S";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    debugLog("benchmark", "baseline rewrite start", { className, attempt });

    await page.locator(".monaco-editor").first().click();
    await page.keyboard.press(selectAll);
    await page.evaluate(async (text) => { await navigator.clipboard.writeText(text); }, baseline);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
    await page.waitForTimeout(200);
    await page.keyboard.press(save);

    const viewLines = await page
      .locator(".monaco-editor .view-lines .view-line")
      .allInnerTexts();

    const stripped = viewLines
      .map((l) => l.replace(/[\u00a0\u200c]/g, " ").trim())
      .filter((l) => l.length > 0);

    const hasClassName = stripped.some((l) => l.includes(`class ${className}`));
    const hasMain = stripped.some((l) => l.includes("public static void main"));
    const hasBenchMarker = stripped.some((l) => l.includes("BENCH_MARKER") || l.includes("BENCH_WARMUP"));
    const expectedNonEmpty = baselineLines.length;

    const ok = hasClassName && hasMain && !hasBenchMarker && stripped.length <= expectedNonEmpty + 1;

    debugLog("benchmark", "baseline rewrite verify", {
      attempt,
      ok,
      lineCount: stripped.length,
      expectedNonEmpty,
      hasClassName,
      hasMain,
      hasBenchMarker,
    });

    if (ok) {
      return;
    }

    debugLog("benchmark", "baseline mismatch — retrying", {
      attempt,
      lines: stripped.slice(-4),
    });
    await page.waitForTimeout(500);
  }

  throw new Error(
    `writeValidBaselineClass: buffer did not match expected baseline after ${maxRetries} attempts`,
  );
}

async function waitForShellInitializedWithTimeout(
  theiaApp: TheiaApp,
  timeoutMs: number,
): Promise<void> {
  await Promise.race([
    theiaApp.waitForShellAndInitialized(),
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timed out waiting for shell initialization after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]);
}

async function nudgeEditor(
  page: import("@playwright/test").Page,
  context: string,
): Promise<void> {
  debugLog("benchmark", "nudge", { context });
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  await page.keyboard.press("Backspace");
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+S" : "Control+S",
  );
  await page.waitForTimeout(300);
}

async function waitForErrorWithNudge(
  page: import("@playwright/test").Page,
  squigglyError: import("@playwright/test").Locator,
  timeoutMs: number,
  nudgeAfterMs = 5000,
): Promise<{ nudged: boolean }> {
  const startedAt = Date.now();
  let nudged = false;

  while (Date.now() - startedAt < timeoutMs) {
    const count = await page.locator(".monaco-editor .squiggly-error").count();
    if (count > 0) {
      return { nudged };
    }

    if (!nudged && Date.now() - startedAt >= nudgeAfterMs) {
      await nudgeEditor(page, "waitForError");
      nudged = true;
      continue;
    }

    await page.waitForTimeout(300);
  }

  throw new Error(
    `Squiggly error did not appear within ${timeoutMs}ms (nudged=${nudged})`,
  );
}

async function waitForCleanState(
  page: import("@playwright/test").Page,
  problemIndicator: TheiaProblemIndicator,
  timeoutMs: number,
  requiredConsecutiveClean = 3,
  staleBeforeNudge = 6,
): Promise<void> {
  const startedAt = Date.now();
  let consecutiveClean = 0;
  let consecutiveStale = 0;
  let nudgeCount = 0;
  let poll = 0;

  while (Date.now() - startedAt < timeoutMs) {
    poll++;
    const squiggleCount = await page
      .locator(".monaco-editor .squiggly-error")
      .count();

    const problems = await problemIndicator.numberOfProblems().catch(() => -1);
    const warnings = await problemIndicator.numberOfWarnings().catch(() => -1);

    debugLog("benchmark", "clean-state poll", {
      poll,
      squiggleCount,
      consecutiveClean,
      consecutiveStale,
      nudgeCount,
      problems,
      warnings,
    });

    if (squiggleCount === 0) {
      consecutiveClean++;
      consecutiveStale = 0;
      if (consecutiveClean >= requiredConsecutiveClean) {
        debugLog("benchmark", "clean-state confirmed", {
          poll,
          consecutiveClean,
          nudgeCount,
          problems,
        });
        return;
      }
    } else {
      consecutiveClean = 0;
      consecutiveStale++;

      if (consecutiveStale >= staleBeforeNudge) {
        nudgeCount++;
        debugLog("benchmark", "clean-state nudge", {
          poll,
          nudgeCount,
          squiggleCount,
          problems,
        });
        await nudgeEditor(page, "waitForCleanState");
        consecutiveStale = 0;
        await page.waitForTimeout(200);
        continue;
      }
    }

    await page.waitForTimeout(500);
  }

  const finalSquiggles = await page
    .locator(".monaco-editor .squiggly-error")
    .count();
  const finalProblems = await problemIndicator.numberOfProblems().catch(() => -1);
  const indicatorText = await page
    .locator("#problem-marker-status")
    .innerText()
    .catch(() => "missing");
  throw new Error(
    `Clean-state timeout after ${timeoutMs}ms (${poll} polls, ${nudgeCount} nudges): ` +
      `squiggles=${finalSquiggles} problems=${finalProblems} indicator='${indicatorText}'`,
  );
}

async function collectDebugSnapshot(
  page: import("@playwright/test").Page,
  problemIndicator: TheiaProblemIndicator,
  theiaApp: TheiaApp,
): Promise<{
  squiggleCount: number;
  problems: number;
  warnings: number;
  outputTail: string;
}> {
  const squiggleCount = await page.locator(".monaco-editor .squiggly-error").count();
  const problems = await problemIndicator.numberOfProblems().catch(() => -1);
  const warnings = await problemIndicator.numberOfWarnings().catch(() => -1);

  let outputTail = "unavailable";
  try {
    const outputView = new TheiaOutputView(theiaApp);
    await outputView.activate();
    await outputView.selectOutputChannel("langserver (java)");
    const lines = await page
      .locator("#outputView .view-lines > div")
      .allInnerTexts();
    outputTail = lines.slice(-6).join(" | ").replace(/\s+/g, " ").trim();
  } catch (e) {
    outputTail = `error:${String(e)}`;
  }

  return {
    squiggleCount,
    problems,
    warnings,
    outputTail,
  };
}
