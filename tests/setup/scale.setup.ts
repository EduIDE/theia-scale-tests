import { test as setup, chromium } from "@playwright/test";
import { LandingPage } from "../../pages/landing/LandingPage";
import { CloudService } from "../../fixtures/utils/service";
import { SESSION_FILE } from "../../fixtures/utils/auth-files";
import { TestInfo } from "@playwright/test";
import fs from "fs";
import path from "path";
import { debugLog } from "../../fixtures/utils/debug-logging";

/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/

/**
 * @remarks
 * This function is used to start the instance and get the IDE URL.
 * @tag slow (starting the instance takes a while)
 * @description This function automates the starting process for the LandingPage UI.
 */
const instances = Number.parseInt(process.env.NUM_INSTANCES ?? "", 10);
// Array.from({ length: NaN }) starts nothing and the suite would pass untested.
if (!Number.isInteger(instances) || instances < 1) {
  throw new Error(
    `NUM_INSTANCES must be a positive integer, got ${JSON.stringify(process.env.NUM_INSTANCES)}.`,
  );
}
// The service refuses more than sessionsPerUser (10 on e2e) sessions for one
// user, and every instance here is a session of the same account.
if (instances > 10) {
  throw new Error(
    `NUM_INSTANCES is ${instances}, but one user may hold at most 10 sessions.`,
  );
}
const setupTimeoutMs = process.env.BENCH_SETUP_TIMEOUT_MS
  ? parseInt(process.env.BENCH_SETUP_TIMEOUT_MS, 10)
  : 420000;

//TODO: Remove skip
setup("Start " + instances + " instances", async ({}, testInfo) => {
  setup.slow();
  const benchTargetApp = process.env.BENCH_TARGET_APP || "java-17-standalone";
  debugLog("scale-setup", "start setup", {
    instances,
    benchTargetApp,
    project: testInfo.project.name,
  });
  const setupPromises = Array.from({ length: instances }, (_, i) => {
    return setupIDE(benchTargetApp, testInfo, i);
  });

  const urls = await Promise.all(setupPromises);
  // One account and template give one idempotent session however often it is
  // launched, so the instances would be one IDE and the load a fraction of it.
  if (testInfo.project.name !== "local" && new Set(urls).size !== urls.length) {
    throw new Error(
      `${instances} instances of ${benchTargetApp} share ${new Set(urls).size} session(s): one account gets one session per template and variant`,
    );
  }
});

async function setupIDE(
  language: string,
  testInfo: TestInfo,
  identifier: number,
) {
  debugLog("scale-setup", "setupIDE start", {
    language,
    identifier,
    project: testInfo.project.name,
  });
  const browser = await chromium.launch();
  let context;
  const isAuthDisabled = process.env.DISABLE_AUTH === "1";
  debugLog("scale-setup", "auth mode", { isAuthDisabled });

  if (testInfo.project.name !== "local" && !isAuthDisabled) {
    context = await browser.newContext({
      storageState: SESSION_FILE,
    });
  } else {
    context = await browser.newContext();
  }

  const page = await context.newPage();
  debugLog("scale-setup", "new page created", { identifier });

  if (testInfo.project.name !== "local") {
    const landingPage = new LandingPage(page);
    debugLog("scale-setup", "goto landing", {
      identifier,
      baseUrl: process.env.LANDINGPAGE_URL,
    });
    await page.goto("/");
    debugLog("scale-setup", "landing opened", { identifier, url: page.url() });
    const service = await CloudService.fromStorage(
      process.env.LANDINGPAGE_URL!,
    );
    await landingPage.launch(
      { app: language, template: process.env.BENCH_TARGET_TEMPLATE },
      await service.listTemplates(),
    );
    debugLog("scale-setup", "waiting for ide url", {
      identifier,
      setupTimeoutMs,
    });
    await landingPage.waitForIdeUrl(setupTimeoutMs);
    debugLog("scale-setup", "ide url reached", {
      identifier,
      url: page.url().split("#")[0],
    });
  } else {
    await page.goto(`/`);
    await page.waitForURL(/.*#\/home\/project/, { timeout: setupTimeoutMs });
  }

  await page.waitForLoadState("domcontentloaded");

  const ideURL = page.url();
  debugLog("scale-setup", "persist ide url", {
    identifier,
    ideURL: ideURL.split("#")[0],
  });
  const testDataDir = path.join(process.cwd(), "test-data/scale");
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(testDataDir, "ide-url-" + identifier + ".txt"),
    ideURL,
  );
  return ideURL;

  //await context.close();
  //await browser.close();
}
