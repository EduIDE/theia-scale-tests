import { Locator, Page } from "@playwright/test";
import { debugLog } from "../../fixtures/utils/debug-logging";
import {
  fetchConfig,
  SpecKey,
  Template,
  tileIndex,
} from "../../fixtures/utils/service";

/**
 * The EduIDE landing page: it signs in at once (Keycloak login-required, no
 * login button), shows one tile per listed template and, for a template with
 * variants, a dialog to pick the project template before the launch.
 */
export class LandingPage {
  page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The avatar: it shows once the page is signed in, its menu holds the sign out link. */
  get account(): Locator {
    return this.page
      .getByTestId("account-button")
      .or(this.page.locator('button.avatar[aria-label^="Account"]'));
  }

  get logoutLink(): Locator {
    return this.page
      .getByTestId("logoutButton")
      .or(this.page.getByRole("link", { name: "Sign out" }));
  }

  /** All tiles currently shown, in page order. */
  get tiles(): Locator {
    return this.page.locator(".grid .card");
  }

  /**
   * The start button of a template's tile. Template displayNames are not
   * unique ("Java 17" twice), so the name is no way to find it.
   */
  async tile(app: string, templates: Template[]): Promise<Locator> {
    await this.page
      .locator(".card-main")
      .first()
      .waitFor({ state: "attached" });
    const byId = this.page.getByTestId(`launch-app-${app}`);
    if ((await byId.count()) > 0) return byId;
    // shortcut: index fallback until the landing page with data-testid is deployed, remove then
    const index = tileIndex(templates, app);
    if (index < 0) throw new Error(`${app} is not a listed template`);
    return this.page.locator(".grid .card-main").nth(index);
  }

  /** Radio of a variant in the pick dialog, "" is the empty project. */
  variantOption(id: string): Locator {
    return this.page
      .getByTestId(`variant-${id || "empty"}`)
      .or(this.page.locator(`input[name="variant"][value="${id}"]`));
  }

  get pickStart(): Locator {
    return this.page
      .getByTestId("pick-start")
      .or(
        this.page
          .locator(".dialog")
          .getByRole("button", { name: "Start", exact: true }),
      );
  }

  /**
   * Opens the landing page and logs in on Keycloak's own form. The realm
   * forwards to the TUM IdP, which does not know the test account, so the auth
   * URL gets an empty kc_idp_hint on the way out. Call it instead of a goto,
   * the redirect to Keycloak happens during the load.
   */
  async login(username: string, password: string) {
    debugLog("landing", "start login", { hasUsername: Boolean(username) });
    // The hint is added to the request itself, so no second navigation races the
    // redirect to the IdP.
    const authUrl = /\/protocol\/openid-connect\/auth/;
    await this.page.route(authUrl, (route) => {
      const url = new URL(route.request().url());
      // The rewritten URL matches again and must pass.
      if (url.searchParams.get("kc_idp_hint") === "") return route.continue();
      url.searchParams.set("kc_idp_hint", "");
      // A redirect, because the URL of a navigation request cannot be changed.
      return route.fulfill({
        status: 302,
        headers: { location: url.toString() },
      });
    });
    const t = { timeout: 20_000 };
    const landingUrl = process.env.LANDINGPAGE_URL!;
    const keycloak = new URL((await fetchConfig(landingUrl)).keycloak.url)
      .origin;
    // The redirect to Keycloak runs after the load, so the commit is enough.
    await this.page.goto(landingUrl, { waitUntil: "commit" });
    // Credentials only go to the Keycloak this landing page names, or to a host
    // listed in LOGIN_HOST_ALLOWLIST (comma separated origins).
    const allowed = allowedLoginOrigins(keycloak);
    await this.page.waitForURL((url) => allowed.includes(url.origin), {
      timeout: 20_000,
    });
    // The page can navigate on between the wait and the typing, so each field
    // checks again right before it is filled.
    const guard = () => {
      const { origin } = new URL(this.page.url());
      if (!allowed.includes(origin)) {
        throw new Error(`Refusing to type credentials on ${origin}`);
      }
    };
    guard();
    await this.page.locator("#username").fill(username, t);
    guard();
    await this.page.locator("#password").fill(password, t);
    guard();
    await this.page
      .getByRole("button", { name: "Sign in", exact: true })
      .click(t);
    await this.page.unroute(authUrl);
  }

  async logout() {
    await this.account.click();
    await this.logoutLink.click();
  }

  async waitForLoggedIn() {
    await this.account.waitFor({ state: "visible", timeout: 60_000 });
  }

  /**
   * Clicks the tile and, if the template has variants to pick, the variant and
   * Start. Without a variant the first one the template offers is taken, as
   * the dialog does.
   */
  async launch(
    spec: Pick<SpecKey, "app"> & { template?: string },
    templates: Template[],
  ) {
    const template = templates.find((t) => t.name === spec.app);
    await (await this.tile(spec.app, templates)).click();
    if (
      template?.variants?.length &&
      template.injectableKeys.includes("TEMPLATE")
    ) {
      await this.variantOption(
        spec.template || template.variants[0].id,
      ).check();
      await this.pickStart.click();
    }
    debugLog("landing", "launch clicked", { ...spec });
  }

  /**
   * The redirect to the session, which can take minutes on a cold image pull.
   * The session runs on its own host, so leaving the landing origin is the
   * signal. Theia then adds #/home/project once the workspace is open.
   */
  async waitForIdeUrl(timeoutMs = 8 * 60_000) {
    const landing = new URL(process.env.LANDINGPAGE_URL!).origin;
    // A failed launch keeps the page on the launch view with an alert, which
    // would otherwise show up as a timeout.
    const alert = this.page.locator(".alert.danger");
    const failed = alert
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs })
      .then(async () => {
        throw new Error(
          `The launch failed: ${await alert.first().innerText()}`,
        );
      });
    // The loser of the race ends with the page, nobody awaits it then.
    failed.catch(() => undefined);
    await Promise.race([
      this.page.waitForURL((url) => url.origin !== landing, {
        timeout: timeoutMs,
      }),
      failed,
    ]);
    await this.page.waitForURL(/.*#\/home\/project/, { timeout: 60_000 });
  }

  /**
   * True once the browser rests on a login prompt: not the landing page and
   * not a step of the Keycloak redirects (auth endpoint, logout).
   */
  async waitForLoginPrompt(timeoutMs = 60_000) {
    const landing = new URL(process.env.LANDINGPAGE_URL!).origin;
    await this.page.waitForURL(
      (url) =>
        url.origin !== landing &&
        !/\/protocol\/openid-connect\/(auth|logout)$/.test(url.pathname),
      { timeout: timeoutMs },
    );
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
