import { Browser, test as base } from "@playwright/test";
import { TheiaApp } from "../pages/ide/theia-pom/theia-app";
import { TheiaWorkspace } from "../pages/ide/theia-pom/theia-workspace";
import { IDEPage } from "../pages/ide/IDEPage";
import { ArtemisPage } from "../pages/artemis/ArtemisPage";
import { LandingPage } from "../pages/landing/LandingPage";
import { BASE_TEMPLATES, urlFileName } from "./utils/catalog";
import fs from "fs";
import path from "path";

interface TheiaFixtures {
  landingPage: LandingPage;
  cApp: IDEPage;
  javaApp: IDEPage;
  pythonApp: IDEPage;
  rustApp: IDEPage;
  jsApp: IDEPage;
  artemis: ArtemisPage;
  artemisTheia: IDEPage;
}

/** LOCAL_URL_<KEY> points at a local container and wins over the launched session. */
const LOCAL_KEYS: Record<string, string> = {
  c: "C",
  java: "JAVA",
  python: "PYTHON",
  rust: "RUST",
  javascript: "JS",
};

/** Opens the IDE of a base template, which functional.setup.ts launched. */
export async function openBaseIde(browser: Browser, key: string) {
  const local = process.env[`LOCAL_URL_${LOCAL_KEYS[key]}`];
  const ideURL =
    local ??
    fs.readFileSync(
      path.join(
        process.cwd(),
        "test-data/functional",
        urlFileName(BASE_TEMPLATES[key]),
      ),
      "utf8",
    );
  const page = await browser.newPage();
  const workspace = new TheiaWorkspace();
  workspace.setPath("/home/project");
  const theiaApp = new TheiaApp(page, workspace, false);
  const idePage = new IDEPage(page, theiaApp, ideURL);
  await page.goto(ideURL);
  await theiaApp.waitForShellAndInitialized();
  return idePage;
}

export const test = base.extend<TheiaFixtures>({
  landingPage: async ({ browser }, use) => {
    const page = await browser.newPage();
    await page.goto("/");
    const landingPage = new LandingPage(page);

    await use(landingPage);

    await page.close();
  },
  cApp: async ({ browser }, use) => {
    const ide = await openBaseIde(browser, "c");
    await use(ide);
    await ide.page.close();
  },
  javaApp: async ({ browser }, use) => {
    const ide = await openBaseIde(browser, "java");
    await use(ide);
    await ide.page.close();
  },
  pythonApp: async ({ browser }, use) => {
    const ide = await openBaseIde(browser, "python");
    await use(ide);
    await ide.page.close();
  },
  rustApp: async ({ browser }, use) => {
    const ide = await openBaseIde(browser, "rust");
    await use(ide);
    await ide.page.close();
  },
  jsApp: async ({ browser }, use) => {
    const ide = await openBaseIde(browser, "javascript");
    await use(ide);
    await ide.page.close();
  },
  artemis: async ({ browser }, use) => {
    const artemisURL = process.env.ARTEMIS_URL!;
    const page = await browser.newPage();
    const artemisApp = new ArtemisPage(page, artemisURL);
    await page.goto(artemisURL);

    await use(artemisApp);
    await page.close();
  },
  artemisTheia: async ({ browser }, use) => {
    const page = await browser.newPage();
    const workspace = new TheiaWorkspace();
    workspace.setPath("/home/project");
    const theiaApp = new TheiaApp(page, workspace, false);
    const artemisTheia = new IDEPage(
      page,
      theiaApp,
      process.env.LANDINGPAGE_URL!,
    );

    await use(artemisTheia);
    await page.close();
  },
});

export { expect } from "@playwright/test";
