import { Page } from "@playwright/test";
import { LandingPage } from "../../../../pages/landing/LandingPage";
import { virtualStudent } from "../VirtualStudents";
import dotenv from "dotenv";
import path from "path";

/* eslint-disable  @typescript-eslint/no-explicit-any */

dotenv.config({
  path: path.resolve(__dirname, "../../../../../playwright.env"),
});

// NUM_INSTANCES was read with a non-null assertion and no fallback, so an
// unset value produced parseInt(undefined) -> NaN -> arrivalRate: NaN. The
// CI workflow never set it, so this "load test" passed in about two minutes
// having generated no load at all, on every pull request.
const numUsers = Number.parseInt(process.env.NUM_INSTANCES ?? "", 10);
if (!Number.isFinite(numUsers) || numUsers < 1) {
  throw new Error(
    `NUM_INSTANCES must be a positive integer, got ${JSON.stringify(process.env.NUM_INSTANCES)}. ` +
      "Refusing to run a load test that would generate no load.",
  );
}
if (!process.env.LANDINGPAGE_URL) {
  throw new Error("LANDINGPAGE_URL is not set; there is nothing to target.");
}

export const config = {
  target: process.env.LANDINGPAGE_URL!,
  engines: {
    playwright: {
      launchOptions: {
        slowMo: 500,
        // Headless unless explicitly asked otherwise. CI runners have no
        // display, so headless: false meant the browser could not start.
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

async function runVirtualStudent(
  page: Page,
  vuContext: any,
  events: any,
  test: any,
) {
  const { step } = test;
  console.log("Starting virtual student");

  await step("Artillery: Waiting for theia to be loaded", async () => {
    await page.goto(process.env.LANDINGPAGE_URL!);
    const landingPage = new LandingPage(page);
    await landingPage.login(
      process.env.KEYCLOAK_USER!,
      process.env.KEYCLOAK_PWD!,
    );
    await landingPage.launchLanguage("java-17");
    await page.waitForURL(/.*#\/home\/project/);
  });

  await virtualStudent(page, test);
}
