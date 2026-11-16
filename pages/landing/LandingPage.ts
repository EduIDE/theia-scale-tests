import { Locator, Page } from "@playwright/test";
import { debugLog } from "../../fixtures/utils/debug-logging";
import type { CloudConfig } from "../../fixtures/utils/service";

/**
 * The EduIDE landing page: login, one tile per offered app and, for apps with
 * several templates, a build system picker before the launch.
 */
export class LandingPage {
  page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The config the page itself runs on, served as /config.js. */
  async config(): Promise<CloudConfig> {
    return this.page.evaluate(
      () => (window as unknown as { theiaCloudConfig: CloudConfig }).theiaCloudConfig,
    );
  }

  get loginButton(): Locator {
    return this.page.getByTestId("loginButton");
  }

  get logoutButton(): Locator {
    return this.page.getByTestId("logoutButton");
  }

  tile(app: string): Locator {
    return this.page.getByTestId(`launch-app-${app}`);
  }

  /** "saved" or "temporary", as the badge on the tile says. */
  badge(app: string): Locator {
    return this.tile(app).locator("[data-persistence]");
  }

  /** Test ids of all tiles currently shown. */
  async tileApps(): Promise<string[]> {
    const tiles = this.page.locator('[data-testid^="launch-app-"]');
    await tiles.first().waitFor({ state: "visible" });
    const ids = await tiles.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-testid")!),
    );
    return ids.map((id) => id.replace("launch-app-", ""));
  }

  async login(username: string, password: string) {
    debugLog("landing", "start login", { hasUsername: Boolean(username) });
    await this.loginButton.click();
    await this.page.getByRole("textbox", { name: "Username" }).fill(username);
    await this.page.locator('input[type="password"]').fill(password);
    await this.page.getByRole("button", { name: "Sign in" }).click();
  }

  async logout() {
    await this.logoutButton.click();
  }

  async waitForLoggedIn() {
    await this.logoutButton.waitFor({ state: "visible", timeout: 60_000 });
  }

  /**
   * Clicks the tile and, if the app has several templates, the build system.
   * Without a template the first one the app offers is taken.
   */
  async launch(app: string, template?: string) {
    const cfg = await this.config();
    const systems =
      cfg.additionalApps.find((a) => a.serviceAuthToken === app)?.buildSystems ??
      [];
    await this.tile(app).waitFor({ state: "visible" });
    await this.tile(app).click();
    if (systems.length > 1) {
      await this.page
        .getByTestId(`build-system-${template ?? systems[0].id}`)
        .click();
    }
    debugLog("landing", "launch clicked", { app, template });
  }

  /** The session redirect, which can take minutes on a cold image pull. */
  async waitForIdeUrl(timeoutMs = 8 * 60_000) {
    await this.page.waitForURL(/.*#\/home\/project/, { timeout: timeoutMs });
  }

  setPage(page: Page) {
    this.page = page;
  }
}
