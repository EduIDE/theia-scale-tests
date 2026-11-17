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

  /**
   * The config the page runs on, read from the page itself. Right after the
   * load the page can still be redirecting through Keycloak, which destroys the
   * context under the read, so it is repeated until the page rests.
   */
  async config(): Promise<CloudConfig> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.page.waitForFunction(
          () =>
            (window as unknown as { theiaCloudConfig?: unknown })
              .theiaCloudConfig,
        );
        return await this.page.evaluate(
          () =>
            (window as unknown as { theiaCloudConfig: CloudConfig })
              .theiaCloudConfig,
        );
      } catch (e) {
        if (
          attempt >= 5 ||
          !/context was destroyed|navigation/i.test(String(e))
        )
          throw e;
        await this.page.waitForLoadState("domcontentloaded");
      }
    }
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

  /**
   * Keycloak's own login form. The landing page redirects with a kc_idp_hint
   * that sends users to the TUM IdP, which does not know the test account, so
   * the same auth URL is opened again without the hint.
   */
  async login(username: string, password: string) {
    debugLog("landing", "start login", { hasUsername: Boolean(username) });
    // The hint is dropped on the way out, so no second navigation races the
    // redirect to the IdP.
    const authUrl = /\/protocol\/openid-connect\/auth/;
    await this.page.route(authUrl, (route) => {
      // The rewritten URL matches again and must pass.
      if (
        new URL(route.request().url()).searchParams.get("kc_idp_hint") === ""
      ) {
        return route.continue();
      }
      const url = new URL(route.request().url());
      url.searchParams.set("kc_idp_hint", "");
      // A redirect, because the URL of a navigation request cannot be changed.
      return route.fulfill({
        status: 302,
        headers: { location: url.toString() },
      });
    });
    const t = { timeout: 20_000 };
    const keycloak = new URL((await this.config()).keycloakAuthUrl).origin;
    await this.loginButton.click(t);
    // Credentials only go to the Keycloak this landing page names, or to a host
    // listed in LOGIN_HOST_ALLOWLIST (comma separated origins).
    await this.page.waitForURL(
      (url) => allowedLoginOrigins(keycloak).includes(url.origin),
      { timeout: 20_000 },
    );
    await this.page.locator("#username").fill(username, t);
    await this.page.locator("#password").fill(password, t);
    await this.page
      .getByRole("button", { name: "Sign in", exact: true })
      .click(t);
    await this.page.unroute(authUrl);
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
      cfg.additionalApps.find((a) => a.serviceAuthToken === app)
        ?.buildSystems ?? [];
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

function allowedLoginOrigins(keycloak: string): string[] {
  return [
    keycloak,
    ...(process.env.LOGIN_HOST_ALLOWLIST ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  ];
}
