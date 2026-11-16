import { chromium, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { LandingPage } from "../../pages/landing/LandingPage";
import { recordMetric } from "./metrics";

export const AUTH_DIR = path.join(process.cwd(), ".auth");
export const SESSION_FILE = path.join(AUTH_DIR, "keycloak_user.json");
/** A second login, so the logout test ends a session nobody else uses. */
export const LOGOUT_SESSION_FILE = path.join(AUTH_DIR, "keycloak_logout_user.json");

function origin(page: Page) {
  const url = new URL(page.url());
  return url.origin + url.pathname;
}

/**
 * Logs in through the landing page UI, outside of any test.
 *
 * This is global setup on purpose: a failing test attaches page snapshots,
 * traces and screenshots to the report, and the repository is public, so
 * nothing that typed credentials may be a test. Errors here name the step and
 * the page without its query string, never a field value or page content.
 */
async function login(file: string, metricName?: string) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  let step = "open the landing page";
  try {
    const start = Date.now();
    await page.goto(process.env.LANDINGPAGE_URL!);
    const landing = new LandingPage(page);
    step = "log in on the Keycloak form";
    await landing.login(process.env.KEYCLOAK_USER!, process.env.KEYCLOAK_PWD!);
    step = "wait for the logged-in landing page";
    await landing.waitForLoggedIn();
    if (metricName) {
      recordMetric(undefined, { name: metricName, ms: Date.now() - start });
    }
    await context.storageState({ path: file });
  } catch {
    throw new Error(`Login failed at step "${step}" on ${origin(page)}`);
  } finally {
    await browser.close();
  }
}

export default async function globalSetup() {
  // Pure helper specs need no environment.
  if (
    process.env.DISABLE_AUTH === "1" ||
    process.argv.some((a) => a === "--project=unit" || a === "--project=local")
  ) {
    return;
  }
  for (const v of ["KEYCLOAK_USER", "KEYCLOAK_PWD", "LANDINGPAGE_URL"]) {
    if (!process.env[v]) throw new Error(`${v} must be set, see README`);
  }
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await login(SESSION_FILE, "login");
  await login(LOGOUT_SESSION_FILE);
}
