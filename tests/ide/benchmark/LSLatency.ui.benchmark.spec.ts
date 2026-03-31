import { test, expect } from "@playwright/test";
import path from "path";

import { LandingPage } from "../../../pages/landing/LandingPage";
import { TheiaApp } from "../../../pages/ide/theia-pom/theia-app";
import { TheiaExplorerView } from "../../../pages/ide/theia-pom/theia-explorer-view";
import { TheiaOutputView } from "../../../pages/ide/theia-pom/theia-output-view";
import { TheiaProblemIndicator } from "../../../pages/ide/theia-pom/theia-problem-indicator";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import { TheiaWorkspace } from "../../../pages/ide/theia-pom/theia-workspace";
import { TheiaTextEditor } from "../../../pages/ide/theia-pom/theia-text-editor";
import { debugLog } from "../../../fixtures/utils/debug-logging";
import { ensureMinimalJavaProjectViaTerminal } from "../../../fixtures/utils/benchmark-java-project";
import {
  appendBenchmarkLatencyRecord,
  type BenchmarkLatencyRecord,
} from "../../../fixtures/utils/benchmark-metrics";

type BenchmarkScenario =
  | "simple-type-error"
  | "import-semantic-error"
  | "hover-context";

type ScenarioDefinition = {
  name: BenchmarkScenario;
  mainFilePath: string;
  helperFilePath?: string;
  mainContent: string;
  helperContent?: string;
  expectedMainFragments: string[];
  expectedHelperFragments?: string[];
  hoverTargets?: HoverTargetDefinition[];
};

type HoverTargetDefinition = {
  label: string;
  lineText: string;
  token: string;
  tokenSelector?: string;
};

type HoverWaitResult = {
  hoverVisibleLatencyMs: number;
  resolvedHoverLatencyMs: number | null;
  loadingSeen: boolean;
};

test("ui diagnostic latency benchmark skeleton", async ({ page }) => {
  const outputDir = process.env.BENCH_OUTPUT_DIR || "test-data/benchmark";
  const benchmarkFile = process.env.BENCH_FIXED_FILE || "src/de/BubbleSort.java";
  const helperFile = process.env.BENCH_HELPER_FILE || "src/bench/BenchHelper.java";
  const benchmarkClassName = path.basename(benchmarkFile, ".java") || "BenchLatency";
  const architecture = process.env.BENCH_ARCH || "external";
  const mode = process.env.BENCH_MODE || "warm";
  const scenario = (process.env.BENCH_SCENARIO || "simple-type-error") as BenchmarkScenario;
  const run = process.env.BENCH_RUN_NUMBER
    ? parseInt(process.env.BENCH_RUN_NUMBER, 10)
    : 1;
  const setupTimeoutMs = process.env.BENCH_SETUP_TIMEOUT_MS
    ? parseInt(process.env.BENCH_SETUP_TIMEOUT_MS, 10)
    : 300000;
  const probeTimeoutMs = process.env.BENCH_PROBE_TIMEOUT_MS
    ? parseInt(process.env.BENCH_PROBE_TIMEOUT_MS, 10)
    : 60000;
  const fileOpenTimeoutMs = process.env.BENCH_FILE_OPEN_TIMEOUT_MS
    ? parseInt(process.env.BENCH_FILE_OPEN_TIMEOUT_MS, 10)
    : 30000;
  const warmupTimeoutMs = process.env.BENCH_WARMUP_TIMEOUT_MS
    ? parseInt(process.env.BENCH_WARMUP_TIMEOUT_MS, 10)
    : 300000;
  const warmupNudgeAfterMs = process.env.BENCH_WARMUP_NUDGE_AFTER_MS
    ? parseInt(process.env.BENCH_WARMUP_NUDGE_AFTER_MS, 10)
    : 240000;
  const stabilizationWaitMs = process.env.BENCH_STABILIZATION_WAIT_MS
    ? parseInt(process.env.BENCH_STABILIZATION_WAIT_MS, 10)
    : 5000;
  const postErrorSettleMs = process.env.BENCH_POST_ERROR_SETTLE_MS
    ? parseInt(process.env.BENCH_POST_ERROR_SETTLE_MS, 10)
    : 2000;
  const hoverWarmupMs = process.env.BENCH_HOVER_WARMUP_MS
    ? parseInt(process.env.BENCH_HOVER_WARMUP_MS, 10)
    : 45000;
  const hoverResolveTimeoutMs = process.env.BENCH_HOVER_RESOLVE_TIMEOUT_MS
    ? parseInt(process.env.BENCH_HOVER_RESOLVE_TIMEOUT_MS, 10)
    : 15000;
  const hoverDebugPauseMs = process.env.BENCH_HOVER_DEBUG_TARGET_PAUSE_MS
    ? parseInt(process.env.BENCH_HOVER_DEBUG_TARGET_PAUSE_MS, 10)
    : 0;
  const hoverDebugTargetLabel = process.env.BENCH_HOVER_DEBUG_TARGET_LABEL || "";
  const debugStepDelayMs = process.env.BENCH_DEBUG_STEP_DELAY_MS
    ? parseInt(process.env.BENCH_DEBUG_STEP_DELAY_MS, 10)
    : 0;
  const pauseAfterFileOpenMs = process.env.BENCH_PAUSE_AFTER_FILE_OPEN_MS
    ? parseInt(process.env.BENCH_PAUSE_AFTER_FILE_OPEN_MS, 10)
    : 0;
  const warmProbeCount = process.env.BENCH_PROBES
    ? parseInt(process.env.BENCH_PROBES, 10)
    : 20;
  const targetApp = process.env.BENCH_TARGET_APP || "java-17-no-ls";
  const runId = process.env.BENCH_RUN_ID || `${architecture}-${mode}-run-${run}`;
  const scenarioDefinition = buildScenarioDefinition(
    scenario,
    benchmarkFile,
    helperFile,
    benchmarkClassName,
  );
  const benchmarkFileName = path.basename(scenarioDefinition.mainFilePath);

  debugLog("benchmark", "open landing", {
    architecture,
    mode,
    scenario,
    run,
    runId,
    targetApp,
    setupTimeoutMs,
    warmProbeCount,
    warmupTimeoutMs,
    warmupNudgeAfterMs,
    postErrorSettleMs,
    debugStepDelayMs,
    fileOpenTimeoutMs,
    pauseAfterFileOpenMs,
  });
  await page.goto("/");
  const landingPage = new LandingPage(page);
  const startupStartedAt = Date.now();
  await landingPage.launchLanguage(targetApp);
  await page.waitForURL(/.*#\/home\/project/, { timeout: setupTimeoutMs });

  const workspace = new TheiaWorkspace();
  workspace.setPath("/home/project");
  const theiaApp = new TheiaApp(page, workspace, false);

  debugLog("benchmark", "wait for shell initialized");
  await waitForShellInitializedWithTimeout(theiaApp, setupTimeoutMs);
  const startupLatencyMs = Date.now() - startupStartedAt;
  const ideUrl = page.url();
  debugLog("benchmark", "startup completed", { startupLatencyMs, ideUrl });

  appendBenchmarkLatencyRecord(outputDir, {
    timestamp: new Date().toISOString(),
    architecture,
      mode,
      scenario,
      run,
      runId,
      probe: 0,
    latencyMs: startupLatencyMs,
    timedOut: false,
    signal: "startup-session-ready",
    ideUrl,
    file: benchmarkFileName,
    targetApp,
  });

  debugLog("benchmark", "prepare benchmark file", {
    benchmarkFileName: scenarioDefinition.mainFilePath,
    scenario,
  });

  await prepareScenarioWorkspace(
    page,
    theiaApp,
    scenarioDefinition,
    debugStepDelayMs,
    fileOpenTimeoutMs,
    pauseAfterFileOpenMs,
  );

  const squigglyError = page.locator(".monaco-editor .squiggly-error").first();
  const problemIndicator = new TheiaProblemIndicator(theiaApp.statusBar);
  if (scenario === "hover-context") {
    const hoverTargets = scenarioDefinition.hoverTargets || [];
    if (hoverTargets.length === 0) {
      throw new Error("Hover scenario requires at least one hover target");
    }
    await hideHover(page);
    debugLog("benchmark", "baseline established", { signal: "hover hidden" });
    debugLog("benchmark", "hover warmup wait", { hoverWarmupMs });
    await waitWithCountdown(page, hoverWarmupMs, 5000, "hover warmup");
    debugLog("benchmark", "hover warmup complete");

    for (let targetIndex = 0; targetIndex < hoverTargets.length; targetIndex++) {
      const hoverTarget = hoverTargets[targetIndex];
      if (
        hoverDebugPauseMs > 0 &&
        hoverDebugTargetLabel &&
        hoverTarget.label === hoverDebugTargetLabel
      ) {
        debugLog("benchmark", "hover debug target pause", {
          hoverTarget: hoverTarget.label,
          hoverDebugPauseMs,
          phase: "warmup",
        });
        await waitWithCountdown(page, hoverDebugPauseMs, 5000, `hover debug pause ${hoverTarget.label}`);
      }
      await hideHover(page);
      const warmupHover = await waitForHoverWithTimeout(
        page,
        hoverTarget,
        hoverResolveTimeoutMs,
        debugStepDelayMs,
      );
      const firstHoverLatencyMs = warmupHover.resolvedHoverLatencyMs;
      if (firstHoverLatencyMs === null) {
        throw new Error(
          `Resolved hover content did not appear within ${hoverResolveTimeoutMs}ms during warmup for target '${hoverTarget.label}'`,
        );
      }
      debugLog("benchmark", "warmup hover latency", {
        hoverTarget: hoverTarget.label,
        firstHoverLatencyMs,
        resolvedHoverLatencyMs: warmupHover.resolvedHoverLatencyMs,
        loadingSeen: warmupHover.loadingSeen,
      });
      if (postErrorSettleMs > 0) {
        debugLog("benchmark", "post-error settle after warmup", {
          hoverTarget: hoverTarget.label,
          postErrorSettleMs,
        });
        await page.waitForTimeout(postErrorSettleMs);
      }

      appendBenchmarkLatencyRecord(outputDir, {
        timestamp: new Date().toISOString(),
        architecture,
        mode,
        scenario,
        run,
        runId,
        probe: targetIndex + 1,
        latencyMs: firstHoverLatencyMs,
        timedOut: false,
        signal: "first-hover-latency",
        ideUrl,
        file: benchmarkFileName,
        targetApp,
        hoverTarget: hoverTarget.label,
      });
      appendBenchmarkLatencyRecord(outputDir, {
        timestamp: new Date().toISOString(),
        architecture,
        mode,
        scenario,
        run,
        runId,
        probe: targetIndex + 1,
        latencyMs: warmupHover.resolvedHoverLatencyMs,
        timedOut: false,
        signal: "first-hover-resolved-latency",
        ideUrl,
        file: benchmarkFileName,
        targetApp,
        hoverTarget: hoverTarget.label,
      });
      await hideHover(page);
      debugLog("benchmark", "hover reset after warmup", {
        hoverTarget: hoverTarget.label,
      });
      debugLog("benchmark", "stabilization wait before measured probes for hover target", {
        hoverTarget: hoverTarget.label,
        stabilizationWaitMs,
      });
      await page.waitForTimeout(stabilizationWaitMs);
      debugLog("benchmark", "stabilization complete for hover target", {
        hoverTarget: hoverTarget.label,
      });

      for (let probe = 1; probe <= warmProbeCount; probe++) {
        await hideHover(page);

        const hoverResult = await waitForHoverWithTimeout(
          page,
          hoverTarget,
          hoverResolveTimeoutMs,
          debugStepDelayMs,
        );
        const latencyMs = hoverResult.resolvedHoverLatencyMs;
        if (latencyMs === null) {
          throw new Error(
            `Resolved hover content did not appear within ${hoverResolveTimeoutMs}ms for probe ${probe} on target '${hoverTarget.label}'`,
          );
        }

        debugLog("benchmark", "warm probe latency", {
          probe,
          hoverTarget: hoverTarget.label,
          latencyMs,
          resolvedHoverLatencyMs: hoverResult.resolvedHoverLatencyMs,
          loadingSeen: hoverResult.loadingSeen,
          signal: "monaco-hover",
        });
        if (postErrorSettleMs > 0) {
          debugLog("benchmark", "post-error settle after measured probe", {
            probe,
            hoverTarget: hoverTarget.label,
            postErrorSettleMs,
          });
          await page.waitForTimeout(postErrorSettleMs);
        }

        appendBenchmarkLatencyRecord(outputDir, {
          timestamp: new Date().toISOString(),
          architecture,
          mode,
          scenario,
          run,
          runId,
          probe,
          latencyMs,
          timedOut: false,
          signal: "warm-hover-latency",
          ideUrl,
          file: benchmarkFileName,
          targetApp,
          hoverTarget: hoverTarget.label,
        });
        appendBenchmarkLatencyRecord(outputDir, {
          timestamp: new Date().toISOString(),
          architecture,
          mode,
          scenario,
          run,
          runId,
          probe,
          latencyMs: hoverResult.resolvedHoverLatencyMs,
          timedOut: false,
          signal: "warm-hover-resolved-latency",
          ideUrl,
          file: benchmarkFileName,
          targetApp,
          hoverTarget: hoverTarget.label,
        });
      }
    }
  } else {
    await squigglyError.waitFor({ state: "hidden", timeout: 30000 });
    debugLog("benchmark", "baseline established", { signal: "squiggly hidden" });

    await injectScenarioError(page, scenarioDefinition, scenario, 0, debugStepDelayMs);
    const warmupStartedAt = Date.now();
    try {
      const warmupResult = await waitForErrorWithNudge(
        page,
        squigglyError,
        warmupTimeoutMs,
        warmupNudgeAfterMs,
      );
      debugLog("benchmark", "warmup error wait completed", warmupResult);
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
    if (postErrorSettleMs > 0) {
      debugLog("benchmark", "post-error settle after warmup", {
        postErrorSettleMs,
      });
      await page.waitForTimeout(postErrorSettleMs);
    }

    appendBenchmarkLatencyRecord(outputDir, {
      timestamp: new Date().toISOString(),
      architecture,
      mode,
      scenario,
      run,
      runId,
      probe: 1,
      latencyMs: firstErrorLatencyMs,
      timedOut: false,
      signal: "first-error-latency",
      ideUrl,
      file: benchmarkFileName,
      targetApp,
    });

    await deleteLineContainingText(page, markerCommentForProbe(0), debugStepDelayMs);
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
      if (probe > 1) {
        await deleteLineContainingText(page, markerCommentForProbe(probe - 1), debugStepDelayMs);
      }
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
        architecture,
        mode,
        scenario,
        run,
        runId,
        probe,
        latencyMs: cleanLatencyMs,
        timedOut: false,
        signal: "clean-state-latency",
        ideUrl,
        file: benchmarkFileName,
        targetApp,
      });

      const startedAt = Date.now();
      await injectScenarioError(page, scenarioDefinition, scenario, probe, debugStepDelayMs);
      const errorResult = await waitForErrorWithNudge(page, squigglyError, probeTimeoutMs, 5000);
      const latencyMs = Date.now() - startedAt;

      debugLog("benchmark", "warm probe latency", {
        probe,
        latencyMs,
        nudged: errorResult.nudged,
        signal: "monaco-squiggly-error",
      });
      if (postErrorSettleMs > 0) {
        debugLog("benchmark", "post-error settle after measured probe", {
          probe,
          postErrorSettleMs,
        });
        await page.waitForTimeout(postErrorSettleMs);
      }

      const record: BenchmarkLatencyRecord = {
        timestamp: new Date().toISOString(),
        architecture,
        mode,
        scenario,
        run,
        runId,
        probe,
        latencyMs,
        timedOut: false,
        signal: "warm-error-latency",
        ideUrl,
        file: benchmarkFileName,
        targetApp,
      };
      appendBenchmarkLatencyRecord(outputDir, record);
      expect(latencyMs).toBeGreaterThanOrEqual(0);
    }
  }
});

async function writeEditorBaseline(
  page: import("@playwright/test").Page,
  content: string,
  expectedFragments: string[],
  forbiddenFragments: string[] = ["BENCH_MARKER", "BENCH_WARMUP"],
  maxRetries = 3,
): Promise<void> {
  const baselineLines = content.split("\n").filter((line) => line.length > 0);
  const baseline = baselineLines.join("\n") + "\n";

  const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
  const save = process.platform === "darwin" ? "Meta+S" : "Control+S";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    debugLog("benchmark", "baseline rewrite start", { attempt });

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });
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

    const hasExpectedFragments = expectedFragments.every((fragment) =>
      stripped.some((l) => l.includes(fragment)),
    );
    const hasForbiddenFragments = forbiddenFragments.some((fragment) =>
      stripped.some((l) => l.includes(fragment)),
    );
    const expectedNonEmpty = baselineLines.length;

    const ok =
      hasExpectedFragments &&
      !hasForbiddenFragments &&
      stripped.length <= expectedNonEmpty + 2;

    debugLog("benchmark", "baseline rewrite verify", {
      attempt,
      ok,
      lineCount: stripped.length,
      expectedNonEmpty,
      expectedFragments,
      forbiddenFragments,
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
    `writeEditorBaseline: buffer did not match expected baseline after ${maxRetries} attempts`,
  );
}

function buildScenarioDefinition(
  scenario: BenchmarkScenario,
  mainFilePath: string,
  helperFilePath: string,
  className: string,
): ScenarioDefinition {
  const simpleMainContent = [
    "package de;",
    "",
    "import java.util.ArrayList;",
    "import java.util.List;",
    "",
    `public class ${className} {`,
    "  public static void main(String[] args) {",
    "    List<String> names = new ArrayList<>();",
    '    names.add("Ada");',
    "    int value = names.size();",
    "    System.out.println(value);",
    "  }",
    "}",
  ].join("\n");

  const semanticHelperContent = [
    "package bench;",
    "",
    "import java.util.List;",
    "",
    "/**",
    " * Computes a deterministic score for benchmark hover and semantic checks.",
    " */",
    "public final class BenchHelper {",
    "  private BenchHelper() {",
    "  }",
    "",
    "  /**",
    "   * Computes a deterministic score for the supplied names.",
    "   */",
    "  public static int compute(List<String> names) {",
    "    int total = 0;",
    "    for (String name : names) {",
    "      total += name.length();",
    "    }",
    "    return total;",
    "  }",
    "}",
  ].join("\n");

  const semanticMainContent = [
    "package de;",
    "",
    "import java.util.ArrayList;",
    "import java.util.List;",
    "import bench.BenchHelper;",
    "",
    `public class ${className} {`,
    "  public static void main(String[] args) {",
    "    List<String> names = new ArrayList<>();",
    '    names.add("Ada");',
    "    int helperResult = BenchHelper.compute(names);",
    "    System.out.println(helperResult);",
    "  }",
    "}",
  ].join("\n");

  if (scenario === "simple-type-error") {
    return {
      name: scenario,
      mainFilePath,
      mainContent: simpleMainContent,
      expectedMainFragments: [
        "package de;",
        "import java.util.ArrayList;",
        "import java.util.List;",
        `public class ${className}`,
        "List<String> names = new ArrayList<>();",
        "int value = names.size();",
      ],
    };
  }

  if (scenario === "import-semantic-error") {
    return {
      name: scenario,
      mainFilePath,
      helperFilePath,
      mainContent: semanticMainContent,
      helperContent: semanticHelperContent,
      expectedMainFragments: [
        "package de;",
        "import bench.BenchHelper;",
        "List<String> names = new ArrayList<>();",
        "int helperResult = BenchHelper.compute(names);",
      ],
      expectedHelperFragments: [
        "package bench;",
        "public final class BenchHelper",
        "public static int compute(List<String> names)",
      ],
    };
  }

  return {
    name: scenario,
    mainFilePath,
    helperFilePath,
    mainContent: semanticMainContent,
    helperContent: semanticHelperContent,
    expectedMainFragments: [
      "package de;",
      "import bench.BenchHelper;",
      "int helperResult = BenchHelper.compute(names);",
    ],
    expectedHelperFragments: [
      "package bench;",
      "Computes a deterministic score for the supplied names.",
      "public static int compute(List<String> names)",
    ],
    hoverTargets: [
      {
        label: "ArrayList",
        lineText: "List<String> names = new ArrayList<>();",
        token: "ArrayList",
        tokenSelector:
          "#code-editor-opener\\:file\\:\\/\\/\\/home\\/project\\/src\\/de\\/BubbleSort\\.java\\:1 > div > div.overflow-guard > div.monaco-scrollable-element.editor-scrollable.vs > div.lines-content.monaco-editor-background > div.view-lines.monaco-mouse-cursor-text > div:nth-child(7) > span > span:nth-child(10)",
      },
      {
        label: "BenchHelper",
        lineText: "int helperResult = BenchHelper.compute(names);",
        token: "BenchHelper",
      },
      {
        label: "compute",
        lineText: "int helperResult = BenchHelper.compute(names);",
        token: "compute",
        tokenSelector:
          "#code-editor-opener\\:file\\:\\/\\/\\/home\\/project\\/src\\/de\\/BubbleSort\\.java\\:1 > div > div.overflow-guard > div.monaco-scrollable-element.editor-scrollable.vs > div.lines-content.monaco-editor-background > div.view-lines.monaco-mouse-cursor-text > div:nth-child(9) > span > span.mtk11",
      },
    ],
  };
}

async function prepareScenarioWorkspace(
  page: import("@playwright/test").Page,
  theiaApp: TheiaApp,
  scenarioDefinition: ScenarioDefinition,
  debugStepDelayMs: number,
  fileOpenTimeoutMs: number,
  pauseAfterFileOpenMs: number,
): Promise<void> {
  await ensureScenarioFilesViaTerminal(theiaApp, scenarioDefinition);
  await openWorkspaceFile(
    page,
    theiaApp,
    scenarioDefinition.mainFilePath,
    debugStepDelayMs,
    fileOpenTimeoutMs,
    pauseAfterFileOpenMs,
  );
  await writeScenarioMainBaseline(page, scenarioDefinition, debugStepDelayMs);
}

async function writeScenarioMainBaseline(
  page: import("@playwright/test").Page,
  scenarioDefinition: ScenarioDefinition,
  debugStepDelayMs = 0,
): Promise<void> {
  await writeEditorBaseline(
    page,
    scenarioDefinition.mainContent,
    scenarioDefinition.expectedMainFragments,
  );
  await debugStepPause(page, debugStepDelayMs, "baseline written");
}

async function injectScenarioError(
  page: import("@playwright/test").Page,
  scenarioDefinition: ScenarioDefinition,
  scenario: BenchmarkScenario,
  probe: number,
  debugStepDelayMs = 0,
): Promise<void> {
  const markerComment = markerCommentForProbe(probe);
  if (scenario === "simple-type-error") {
    await addTextToNewLineAfterLineContainingText(
      page,
      'names.add("Ada");',
      `int brokenValue${probe} = "x"; ${markerComment}`,
    );
  } else {
    await addTextToNewLineAfterLineContainingText(
      page,
      "int helperResult = BenchHelper.compute(names);",
      `String helperText${probe} = BenchHelper.compute(names); ${markerComment}`,
    );
  }
  await debugStepPause(page, debugStepDelayMs, `error line inserted: probe ${probe}`);
  await saveVisibleEditor(page);
  await debugStepPause(page, debugStepDelayMs, `editor saved after error insert: probe ${probe}`);
}

async function writeHelperFileViaTerminal(
  theiaApp: TheiaApp,
  helperFilePath: string,
  helperContent: string,
  debugStepDelayMs = 0,
): Promise<void> {
  debugLog("benchmark", "helper setup: open terminal", { helperFilePath });
  const terminal = await theiaApp.openTerminal(TheiaTerminal);
  debugLog("benchmark", "helper setup: terminal opened", { helperFilePath });
  await debugStepPause(theiaApp.page, debugStepDelayMs, "helper terminal opened");
  const helperDir = path.dirname(helperFilePath);

  if (helperDir && helperDir !== ".") {
    debugLog("benchmark", "helper setup: mkdir start", { helperDir });
    await terminal.submit(`mkdir -p ${shellQuote(helperDir)}`);
    debugLog("benchmark", "helper setup: mkdir done", { helperDir });
    await debugStepPause(theiaApp.page, debugStepDelayMs, "helper mkdir done");
  }
  debugLog("benchmark", "helper setup: truncate start", { helperFilePath });
  await terminal.submit(`: > ${shellQuote(helperFilePath)}`);
  debugLog("benchmark", "helper setup: truncate done", { helperFilePath });
  await debugStepPause(theiaApp.page, debugStepDelayMs, "helper truncate done");

  const helperLines = helperContent.split("\n");
  for (let index = 0; index < helperLines.length; index++) {
    const line = helperLines[index];
    debugLog("benchmark", "helper setup: append line start", {
      helperFilePath,
      lineNumber: index + 1,
      preview: line.slice(0, 60),
    });
    await terminal.submit(
      `printf '%s\\n' ${shellQuote(line)} >> ${shellQuote(helperFilePath)}`,
    );
    debugLog("benchmark", "helper setup: append line done", {
      helperFilePath,
      lineNumber: index + 1,
    });
    await debugStepPause(
      theiaApp.page,
      debugStepDelayMs,
      `helper append line ${index + 1} done`,
    );
  }

  debugLog("benchmark", "helper setup: settle wait start", { helperFilePath });
  await theiaApp.page.waitForTimeout(1500);
  debugLog("benchmark", "helper setup: settle wait done", { helperFilePath });
}

async function ensureScenarioFilesViaTerminal(
  theiaApp: TheiaApp,
  scenarioDefinition: ScenarioDefinition,
  debugStepDelayMs = 0,
): Promise<void> {
  debugLog("benchmark", "file setup: open terminal start", {
    mainFilePath: scenarioDefinition.mainFilePath,
    helperFilePath: scenarioDefinition.helperFilePath,
  });
  const terminal = await theiaApp.openTerminal(TheiaTerminal);
  debugLog("benchmark", "file setup: open terminal done", {
    mainFilePath: scenarioDefinition.mainFilePath,
  });
  await debugStepPause(theiaApp.page, debugStepDelayMs, "main terminal opened");
  await ensureMinimalJavaProjectViaTerminal(theiaApp, terminal, debugStepDelayMs);
  const mainDir = path.dirname(scenarioDefinition.mainFilePath);

  if (mainDir && mainDir !== ".") {
    debugLog("benchmark", "file setup: mkdir main dir start", { mainDir });
    await terminal.submit(`mkdir -p ${shellQuote(mainDir)}`);
    debugLog("benchmark", "file setup: mkdir main dir done", { mainDir });
    await debugStepPause(theiaApp.page, debugStepDelayMs, "main dir created");
  }
  debugLog("benchmark", "file setup: touch main file start", {
    mainFilePath: scenarioDefinition.mainFilePath,
  });
  await terminal.submit(`: > ${shellQuote(scenarioDefinition.mainFilePath)}`);
  debugLog("benchmark", "file setup: touch main file done", {
    mainFilePath: scenarioDefinition.mainFilePath,
  });
  await debugStepPause(theiaApp.page, debugStepDelayMs, "main file created");

  if (scenarioDefinition.helperFilePath && scenarioDefinition.helperContent) {
    debugLog("benchmark", "file setup: helper write start", {
      helperFilePath: scenarioDefinition.helperFilePath,
    });
    await writeHelperFileViaTerminal(
      theiaApp,
      scenarioDefinition.helperFilePath,
      scenarioDefinition.helperContent,
      debugStepDelayMs,
    );
    debugLog("benchmark", "file setup: helper write done", {
      helperFilePath: scenarioDefinition.helperFilePath,
    });
    await debugStepPause(theiaApp.page, debugStepDelayMs, "helper file created");
  }
}

async function openWorkspaceFile(
  page: import("@playwright/test").Page,
  theiaApp: TheiaApp,
  filePath: string,
  debugStepDelayMs = 0,
  fileOpenTimeoutMs = 30000,
  pauseAfterFileOpenMs = 0,
): Promise<void> {
  debugLog("benchmark", "explorer open: open explorer start", { filePath });
  const explorer = await theiaApp.openView(TheiaExplorerView);
  debugLog("benchmark", "explorer open: open explorer done", { filePath });
  await debugStepPause(page, debugStepDelayMs, "explorer opened");
  debugLog("benchmark", "explorer open: refresh start", { filePath });
  await explorer.refresh();
  debugLog("benchmark", "explorer open: refresh done", { filePath });
  await debugStepPause(page, debugStepDelayMs, "explorer refreshed");

  const folderPath = path.dirname(filePath);
  const nodeId = workspaceNodeId(filePath);
  const fileNode = page.locator(`[id="${nodeId}"]`).first();

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (folderPath && folderPath !== ".") {
      await expandFolderPathSegments(page, folderPath, debugStepDelayMs);
    }

    debugLog("benchmark", "explorer open: wait node start", {
      nodeId,
      attempt,
    });
    try {
      await fileNode.waitFor({ state: "visible", timeout: Math.ceil(fileOpenTimeoutMs / 2) });
      debugLog("benchmark", "explorer open: wait node done", { nodeId, attempt });
      break;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      debugLog("benchmark", "explorer open: wait node retry", {
        nodeId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      await explorer.refresh();
      await debugStepPause(page, debugStepDelayMs, "explorer refreshed for retry");
    }
  }

  await debugStepPause(page, debugStepDelayMs, "file node visible");
  debugLog("benchmark", "explorer open: dblclick start", { nodeId });
  await fileNode.dblclick();
  debugLog("benchmark", "explorer open: dblclick done", { nodeId });
  await debugStepPause(page, debugStepDelayMs, "file node opened");

  const editor = page
    .locator(`.monaco-editor[data-uri="file:///home/project/${filePath}"]`)
    .first();
  debugLog("benchmark", "explorer open: wait editor start", { filePath });
  await editor.waitFor({ state: "visible", timeout: fileOpenTimeoutMs });
  debugLog("benchmark", "explorer open: wait editor done", { filePath });
  await debugStepPause(page, debugStepDelayMs, "editor visible");
  debugLog("benchmark", "explorer open: editor click start", { filePath });
  await editor.click();
  debugLog("benchmark", "explorer open: editor click done", { filePath });
  await debugStepPause(page, debugStepDelayMs, "editor focused");
  await debugStepPause(page, pauseAfterFileOpenMs, "pause after file open");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function workspaceNodeId(filePath: string): string {
  return `/home/project:/home/project/${filePath}`;
}

async function expandFolderPathSegments(
  page: import("@playwright/test").Page,
  folderPath: string,
  debugStepDelayMs: number,
): Promise<void> {
  const segments = folderPath.split("/").filter(Boolean);
  let currentPath = "";

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    await expandFolderIfVisible(page, currentPath, debugStepDelayMs);
  }
}

async function expandFolderIfVisible(
  page: import("@playwright/test").Page,
  folderPath: string,
  debugStepDelayMs: number,
): Promise<void> {
  const folderNodeId = workspaceNodeId(folderPath);
  const folderSegment = page.locator(`[id="${folderNodeId}"]`).first();
  if (!(await folderSegment.isVisible().catch(() => false))) {
    debugLog("benchmark", "explorer open: folder segment not visible", {
      folderPath,
      folderNodeId,
    });
    return;
  }

  const folderRow = folderSegment.locator("xpath=ancestor::div[contains(@class,'theia-TreeNode')][1]");
  const toggle = folderRow.locator(".theia-ExpansionToggle").first();
  if (!(await toggle.isVisible().catch(() => false))) {
    debugLog("benchmark", "explorer open: folder toggle not visible", {
      folderPath,
    });
    return;
  }

  const toggleClasses = (await toggle.getAttribute("class")) || "";
  const isCollapsed = toggleClasses.includes("theia-mod-collapsed");
  debugLog("benchmark", "explorer open: folder toggle state", {
    folderPath,
    isCollapsed,
    toggleClasses,
  });
  if (!isCollapsed) {
    return;
  }

  debugLog("benchmark", "explorer open: folder expand start", { folderPath });
  await toggle.click();
  debugLog("benchmark", "explorer open: folder expand done", { folderPath });
  await debugStepPause(page, debugStepDelayMs, `folder expanded: ${folderPath}`);
}

async function debugStepPause(
  page: import("@playwright/test").Page,
  delayMs: number,
  label: string,
): Promise<void> {
  if (delayMs <= 0) {
    return;
  }
  debugLog("benchmark", "debug step pause start", { label, delayMs });
  await page.waitForTimeout(delayMs);
  debugLog("benchmark", "debug step pause done", { label, delayMs });
}

async function addTextToNewLineAfterLineContainingText(
  page: import("@playwright/test").Page,
  textContainedByExistingLine: string,
  newText: string,
): Promise<void> {
  const line = page
    .locator(".monaco-editor .view-lines .view-line")
    .filter({ hasText: textContainedByExistingLine })
    .first();
  await line.waitFor({ state: "visible" });
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(newText);
}

async function deleteLineContainingText(
  page: import("@playwright/test").Page,
  textContainedByExistingLine: string,
  debugStepDelayMs = 0,
): Promise<void> {
  const line = page
    .locator(".monaco-editor .view-lines .view-line")
    .filter({ hasText: textContainedByExistingLine })
    .first();
  await line.waitFor({ state: "visible" });
  await line.click({ clickCount: 3 });
  await debugStepPause(page, debugStepDelayMs, `line selected for delete: ${textContainedByExistingLine}`);
  await page.keyboard.press("Backspace");
  await debugStepPause(page, debugStepDelayMs, `line deleted: ${textContainedByExistingLine}`);
  await saveVisibleEditor(page);
  await debugStepPause(page, debugStepDelayMs, `editor saved after delete: ${textContainedByExistingLine}`);
}

async function saveVisibleEditor(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+S" : "Control+S",
  );
  await page.waitForTimeout(300);
}

async function waitForHoverWithTimeout(
  page: import("@playwright/test").Page,
  hoverTargetDefinition: HoverTargetDefinition,
  timeoutMs: number,
  debugStepDelayMs = 0,
): Promise<HoverWaitResult> {
  const hoverResolvePollMs = 250;
  const loadingPattern = /loading/i;

  const editorRoot = page.locator(".monaco-editor").first();
  const line = editorRoot.locator(
    `.view-lines .view-line:has-text("${hoverTargetDefinition.lineText}")`,
  ).first();
  await line.waitFor({ state: "visible", timeout: timeoutMs });

  const hoverTarget = hoverTargetDefinition.tokenSelector
    ? page.locator(hoverTargetDefinition.tokenSelector).first()
    : line.locator(`span:has-text("${hoverTargetDefinition.token}")`).first();
  await hoverTarget.waitFor({ state: "visible", timeout: timeoutMs });
  await debugStepPause(page, debugStepDelayMs, `hover target visible: ${hoverTargetDefinition.label}`);

  const hover = page.locator(".monaco-hover:not(.hidden)").first();
  const startedAt = Date.now();
  await hoverTarget.hover();
  debugLog("benchmark", "hover trigger", {
    token: hoverTargetDefinition.label,
    timeoutMs,
  });
  await debugStepPause(page, debugStepDelayMs, `hover triggered: ${hoverTargetDefinition.label}`);
  await hover.waitFor({ state: "visible", timeout: timeoutMs });
  await debugStepPause(page, debugStepDelayMs, "hover visible");

  const hoverVisibleLatencyMs = Date.now() - startedAt;
  let hoverText = (await hover.textContent().catch(() => "")) || "";
  let loadingSeen = loadingPattern.test(hoverText);
  let resolvedHoverLatencyMs: number | null = loadingSeen ? null : hoverVisibleLatencyMs;

  if (loadingSeen) {
    debugLog("benchmark", "hover loading visible; keeping pointer on target", {
      token: hoverTargetDefinition.label,
      hoverVisibleLatencyMs,
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(hoverResolvePollMs);
      if (!(await hover.isVisible().catch(() => false))) {
        debugLog("benchmark", "hover hidden while waiting for resolved content", {
          token: hoverTargetDefinition.label,
        });
        break;
      }
      hoverText = (await hover.textContent().catch(() => "")) || "";
      if (!loadingPattern.test(hoverText) && hoverText.trim().length > 0) {
        resolvedHoverLatencyMs = Date.now() - startedAt;
        break;
      }
    }
  }

  debugLog("benchmark", "hover result", {
    token: hoverTargetDefinition.label,
    hoverVisibleLatencyMs,
    resolvedHoverLatencyMs,
    loadingSeen,
    hoverText: hoverText.trim().slice(0, 120),
  });

  return {
    hoverVisibleLatencyMs,
    resolvedHoverLatencyMs,
    loadingSeen,
  };
}

function markerCommentForProbe(probe: number): string {
  const marker = probe === 0 ? "BENCH_WARMUP" : `BENCH_MARKER_${probe}`;
  return `// ${marker}`;
}

async function hideHover(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.mouse.move(5, 5);
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.locator(".monaco-hover").first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => undefined);
}

async function waitWithCountdown(
  page: import("@playwright/test").Page,
  totalMs: number,
  tickMs: number,
  label: string,
): Promise<void> {
  if (totalMs <= 0) {
    return;
  }

  let remainingMs = totalMs;
  while (remainingMs > 0) {
    const currentWaitMs = Math.min(tickMs, remainingMs);
    await page.waitForTimeout(currentWaitMs);
    remainingMs -= currentWaitMs;
    if (remainingMs > 0) {
      debugLog("benchmark", `${label} remaining`, {
        remainingMs,
        remainingSeconds: Math.ceil(remainingMs / 1000),
      });
    }
  }
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
  staleBeforeNudge = 10,
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
