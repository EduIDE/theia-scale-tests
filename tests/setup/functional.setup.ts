import { test as setup, chromium } from "@playwright/test";
import { LandingPage } from "../../pages/landing/LandingPage";
import { TestInfo } from "@playwright/test";
import fs from "fs";
import path from "path";

/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/

/**
 * @remarks
 * This function is used to start the instance and get the IDE URL.
 * @tag slow (starting the instance takes a while)
 * @description This function automates the starting process for the LandingPage UI.
 */
setup("Get IDE URL for C", async ({}, testInfo) => {
  setup.slow();
  await setupIDE("c", testInfo);
});

setup("Get IDE URL for Java", async ({}, testInfo) => {
  setup.slow();
  await setupIDE("java-17", testInfo);
});

setup("Get IDE URL for Python", async ({}, testInfo) => {
  setup.slow();
  await setupIDE("python", testInfo);
});

setup("Get IDE URL for Rust", async ({}, testInfo) => {
  setup.slow();
  await setupIDE("rust", testInfo);
});

setup("Get IDE URL for OCaml", async ({}, testInfo) => {
  setup.slow();
  await setupIDE("ocaml", testInfo);
});

setup("Get IDE URL for JavaScript", async ({}, testInfo) => {
  setup.slow();
  await setupIDE("javascript", testInfo);
});

async function setupIDE(language: string, testInfo: TestInfo) {
  const browser = await chromium.launch();
  let context;
  const isAuthDisabled = process.env.DISABLE_AUTH === "1";

  if (testInfo.project.name !== "local" && !isAuthDisabled) {
    context = await browser.newContext({
      storageState: ".auth/keycloak_user.json",
    });
  } else {
    context = await browser.newContext();
  }

  const page = await context.newPage();

  if (testInfo.project.name !== "local") {
    const landingPage = new LandingPage(page);
    await page.goto("/");
    await landingPage.launchLanguage(language);
    await page.waitForURL(/.*#\/home\/project/);
  } else {
    await page.goto(`/`);
    await page.waitForURL(/.*#\/home\/project/);
  }

  await page.waitForLoadState("domcontentloaded");

  const ideURL = page.url();
  const testDataDir = path.join(process.cwd(), "test-data/functional");
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(testDataDir, "ide-url-" + language.toLowerCase() + ".txt"),
    ideURL,
  );

  await context.close();
  await browser.close();
}
