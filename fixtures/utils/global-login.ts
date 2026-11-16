import { chromium, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { LandingPage } from "../../pages/landing/LandingPage";
import { recordMetric } from "./metrics";

export const AUTH_DIR = path.join(process.cwd(), ".auth");
export const SESSION_FILE = path.join(AUTH_DIR, "keycloak_user.json");
/** A second login, so the logout test ends a session nobody else uses. */
export const ARTEMIS_SESSION_FILE = path.join(AUTH_DIR, "artemis_user.json");
export const LOGOUT_SESSION_FILE = path.join(
  AUTH_DIR,
  "keycloak_logout_user.json",
);

class LoginError extends Error {
  constructor(
    message: string,
    /** A rejected credential, which a second attempt would only repeat. */
    readonly rejected: boolean,
  ) {
    super(message);
  }
}

/** One more attempt for slow infrastructure, none for a rejected credential. */
async function loginWithRetry(...args: Parameters<typeof login>) {
  try {
    await login(...args);
  } catch (e) {
    if (e instanceof LoginError && e.rejected) throw e;
    await login(...args);
  }
}

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
async function login(
  file: string,
  user: string,
  pwd: string,
  metricName?: string,
) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  let step = "open the landing page";
  try {
    const start = Date.now();
    await page.goto(process.env.LANDINGPAGE_URL!);
    const landing = new LandingPage(page);
    step = "log in on the Keycloak form";
    await landing.login(user, pwd);
    step = "wait for the logged-in landing page";
    await landing.waitForLoggedIn();
    if (metricName) {
      recordMetric(undefined, { name: metricName, ms: Date.now() - start });
    }
    await context.storageState({ path: file });
  } catch {
    // Only yes/no answers about fixed elements, never page content.
    const seen = async (selector: string) =>
      (await page
        .locator(selector)
        .count()
        .catch(() => 0)) > 0;
    const loginForm = await seen("#username");
    const keycloakError = await seen(
      "#input-error, .alert-error, .pf-m-danger, .kc-feedback-text",
    );
    throw new LoginError(
      `Login failed at step "${step}" on ${origin(page)} ` +
        `(login form shown: ${loginForm}, error element shown: ${keycloakError})`,
      keycloakError,
    );
  } finally {
    await browser.close();
  }
}

export default async function globalSetup() {
  if (process.env.DISABLE_AUTH === "1") return;
  const projects = process.argv.filter((a) => a.startsWith("--project="));
  const only = (name: string) =>
    projects.length > 0 && projects.every((p) => p === `--project=${name}`);
  // Pure helper specs and local containers need no environment.
  if (only("unit") || only("local")) return;

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const needs = (vars: string[]) => {
    for (const v of vars)
      if (!process.env[v]) throw new Error(`${v} must be set, see README`);
  };
  if (projects.includes("--project=artemis")) {
    needs(["ARTEMIS_USER", "ARTEMIS_PWD", "LANDINGPAGE_URL"]);
    await loginWithRetry(
      ARTEMIS_SESSION_FILE,
      process.env.ARTEMIS_USER!,
      process.env.ARTEMIS_PWD!,
    );
  }
  // The Artemis suite alone has no use for the Keycloak test user.
  if (!only("artemis")) {
    needs(["KEYCLOAK_USER", "KEYCLOAK_PWD", "LANDINGPAGE_URL"]);
    await loginWithRetry(
      SESSION_FILE,
      process.env.KEYCLOAK_USER!,
      process.env.KEYCLOAK_PWD!,
      "login",
    );
    await loginWithRetry(
      LOGOUT_SESSION_FILE,
      process.env.KEYCLOAK_USER!,
      process.env.KEYCLOAK_PWD!,
    );
  }
}
