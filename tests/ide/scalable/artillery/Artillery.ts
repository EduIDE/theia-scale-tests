import { Page } from "@playwright/test";
import { LandingPage } from "../../../../pages/landing/LandingPage";
import { CloudService } from "../../../../fixtures/utils/service";
import { virtualStudent } from "../VirtualStudents";
import dotenv from "dotenv";
import path from "path";

/* eslint-disable  @typescript-eslint/no-explicit-any */

dotenv.config({
  path: path.resolve(__dirname, "../../../../../playwright.env"),
});

// Unset NUM_INSTANCES used to give NaN and an arrival rate of NaN, so the run
// passed without generating any load.
const numUsers = Number.parseInt(process.env.NUM_INSTANCES ?? "", 10);
if (!Number.isFinite(numUsers) || numUsers < 1) {
  throw new Error(
    `NUM_INSTANCES must be a positive integer, got ${JSON.stringify(process.env.NUM_INSTANCES)}.`,
  );
}
// Every virtual user is a session of the same account, which the service caps.
if (numUsers > 10) {
  throw new Error(
    `NUM_INSTANCES is ${numUsers}, but one user may hold at most 10 sessions.`,
  );
}
if (!process.env.LANDINGPAGE_URL) {
  throw new Error("LANDINGPAGE_URL is not set, there is nothing to target.");
}

export const config = {
  target: process.env.LANDINGPAGE_URL!,
  engines: {
    playwright: {
      launchOptions: {
        slowMo: 500,
        // CI runners have no display.
        headless: process.env.HEADED !== "true",
      },
      contextOptions: {
        permissions: ["clipboard-write", "clipboard-read"],
      },
      defaultNavigationTimeout: 300000,
    },
  },
  phases: [{ duration: 1, arrivalRate: numUsers }],
};

export const scenarios = [
  {
    engine: "playwright",
    testFunction: runVirtualStudent,
  },
];

// All virtual users share one session of the account, so it is stopped when the
// last of them is done.
let running = 0;

async function runVirtualStudent(
  page: Page,
  vuContext: any,
  events: any,
  test: any,
) {
  const { step } = test;
  console.log("Starting virtual student");
  running++;
  try {
    await runStudent(page, test, step);
  } finally {
    if (--running === 0) {
      try {
        const service = await CloudService.fromCookies(
          await page.context().cookies(),
          process.env.LANDINGPAGE_URL!,
        );
        await service.stopTemplate({
          app: "java-17-standalone",
          template: "maven",
        });
      } catch (e) {
        console.error("Could not stop the session", e);
      }
    }
  }
}

async function runStudent(page: Page, test: any, step: any) {
  await step("Artillery: Waiting for theia to be loaded", async () => {
    const landingPage = new LandingPage(page);
    await landingPage.login(
      process.env.KEYCLOAK_USER!,
      process.env.KEYCLOAK_PWD!,
    );
    await landingPage.waitForLoggedIn();
    const service = await CloudService.fromCookies(
      await page.context().cookies(),
      process.env.LANDINGPAGE_URL!,
    );
    await landingPage.launch(
      { app: "java-17-standalone", template: "maven" },
      await service.listTemplates(),
    );
    await landingPage.waitForIdeUrl();
  });

  await virtualStudent(page, test);
}
