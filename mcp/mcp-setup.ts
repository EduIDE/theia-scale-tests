import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { LandingPage } from "../pages/landing/LandingPage";
import dotenv from "dotenv";

const authFile = path.resolve(__dirname, "../.auth/mcp_auth.json");

dotenv.config({ path: path.resolve(__dirname, "../playwright.env") });

/**
 * Logs into keycloak and saves the session
 */
export async function ensureLogin() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  fs.writeFileSync(authFile, "", "utf8");
  console.log(process.env.LANDINGPAGE_URL!);
  console.log("🔑 Logging in and saving session...");
  const page = await context.newPage();
  const landingPage = new LandingPage(page);
  await landingPage.login(
    process.env.KEYCLOAK_USER!,
    process.env.KEYCLOAK_PWD!,
  );
  await page.context().storageState({ path: authFile });
  await browser.close();
}

if (require.main === module) {
  ensureLogin();
}
