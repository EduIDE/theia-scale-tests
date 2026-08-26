import { test as setup, chromium } from "@playwright/test";
import { LandingPage } from "../../pages/landing/LandingPage";
import { TestInfo } from "@playwright/test";
import fs from "fs";
import path from "path";
import { debugLog } from "../../fixtures/utils/debug-logging";

/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/

// Checked here rather than in global setup: global setup cannot tell which
// project is actually running, so requiring this there failed the functional
// suite, which has no use for it. Without it, Array.from({length: NaN}) yields
// zero tests and the scale suite passes having tested nothing.
const NUM_INSTANCES = Number.parseInt(process.env.NUM_INSTANCES ?? "", 10);
if (!Number.isInteger(NUM_INSTANCES) || NUM_INSTANCES < 1) {
  throw new Error(
    `NUM_INSTANCES must be a positive integer, got ${JSON.stringify(process.env.NUM_INSTANCES)}. ` +
      "Without it the scale suite runs zero tests and reports success.",
  );
}

/**
 * @remarks
 * This function is used to start the instance and get the IDE URL.
 * @tag slow (starting the instance takes a while)
 * @description This function automates the starting process for the LandingPage UI.
 */
const instances = process.env.NUM_INSTANCES
  ? parseInt(process.env.NUM_INSTANCES)
  : 1;
const setupTimeoutMs = process.env.BENCH_SETUP_TIMEOUT_MS
  ? parseInt(process.env.BENCH_SETUP_TIMEOUT_MS, 10)
  : 420000;

//TODO: Remove skip
setup("Start " + instances + " instances", async ({}, testInfo) => {
  setup.slow();
  const benchTargetApp = process.env.BENCH_TARGET_APP || "java-17-no-ls";
  debugLog("scale-setup", "start setup", {
    instances,
    benchTargetApp,
    project: testInfo.project.name,
  });
  const setupPromises = Array.from({ length: instances }, (_, i) => {
    return setupIDE(benchTargetApp, testInfo, i);
  });

  await Promise.all(setupPromises);
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
      storageState: ".auth/keycloak_user.json",
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
    await landingPage.launchLanguage(language);
    debugLog("scale-setup", "waiting for ide url", {
      identifier,
      pattern: ".*#/home/project",
      setupTimeoutMs,
    });
    await page.waitForURL(/.*#\/home\/project/, { timeout: setupTimeoutMs });
    debugLog("scale-setup", "ide url reached", { identifier, url: page.url() });
  } else {
    await page.goto(`/`);
    await page.waitForURL(/.*#\/home\/project/, { timeout: setupTimeoutMs });
  }

  await page.waitForLoadState("domcontentloaded");

  const ideURL = page.url();
  debugLog("scale-setup", "persist ide url", { identifier, ideURL });
  const testDataDir = path.join(process.cwd(), "test-data/scale");
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(testDataDir, "ide-url-" + identifier + ".txt"),
    ideURL,
  );

  //await context.close();
  //await browser.close();
}
