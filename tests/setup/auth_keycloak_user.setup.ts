import { test as setup } from "@playwright/test";
import { LandingPage } from "../../pages/landing/LandingPage";
import path from "path";

const authFile = path.join(__dirname, "../../.auth/keycloak_user.json");

/**
 * Logs in through the landing page UI once and stores the session for all
 * other projects.
 */
// No trace: it records the typed credentials, and the artifacts are public.
setup.use({ trace: "off" });

setup("Auth: Authenticate Keycloak", async ({ page }) => {
  if (process.env.DISABLE_AUTH === "1") {
    return;
  }
  if (!process.env.KEYCLOAK_USER || !process.env.KEYCLOAK_PWD) {
    throw new Error("KEYCLOAK_USER and KEYCLOAK_PWD must be set");
  }
  if (!process.env.LANDINGPAGE_URL) {
    throw new Error("LANDINGPAGE_URL must be set, see README");
  }

  setup.slow();
  await page.goto(`/`);

  const landingPage = new LandingPage(page);
  await landingPage.loginAndWait(
    process.env.KEYCLOAK_USER,
    process.env.KEYCLOAK_PWD,
  );

  await page.context().storageState({ path: authFile });
});
