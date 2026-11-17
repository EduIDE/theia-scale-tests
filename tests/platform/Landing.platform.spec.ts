import { test, expect } from "../../fixtures/theia.fixture";
import { LOGOUT_SESSION_FILE } from "../../fixtures/utils/auth-files";
import { TEMPLATES } from "../../fixtures/utils/catalog";

test.describe("Landing page (not logged in)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Login sends the browser to the configured Keycloak", async ({
    landingPage,
  }) => {
    const cfg = await landingPage.config();
    await expect(landingPage.loginButton).toBeVisible();
    // Keycloak forwards to an identity provider at once, so the page does not
    // rest on the Keycloak URL. The request shows where the login went.
    const request = landingPage.page.waitForRequest((r) =>
      r.url().startsWith(new URL(cfg.keycloakAuthUrl).origin),
    );
    await landingPage.loginButton.click();
    expect((await request).url()).toContain(
      `/realms/${cfg.keycloakRealm}/protocol/openid-connect/auth`,
    );
  });
});

// Its own login from global setup: logging out ends that Keycloak session, which
// the other tests must not share.
test.describe("Logout", () => {
  test.use({ storageState: LOGOUT_SESSION_FILE });
  // Logging out ends the stored session, so a retry could not log in again.
  test.describe.configure({ retries: 0 });

  test("Logout returns to the login page", async ({ landingPage }) => {
    await landingPage.waitForLoggedIn();
    await landingPage.logout();
    await expect(landingPage.loginButton).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("Landing page (logged in)", () => {
  test.beforeEach(async ({ landingPage }) => {
    await landingPage.waitForLoggedIn();
  });

  test("Offers a tile per visible app with a matching badge", async ({
    landingPage,
  }) => {
    const cfg = await landingPage.config();
    const visible = cfg.additionalApps.filter((a) => a.visible !== false);
    const apps = [...new Set(TEMPLATES.map((t) => t.app))];
    expect((await landingPage.tileApps()).sort()).toEqual(
      visible.map((a) => a.serviceAuthToken).sort(),
    );
    for (const app of apps) {
      await expect(landingPage.tile(app)).toBeVisible();
    }
    for (const app of visible) {
      const ephemeral = app.ephemeral ?? cfg.useEphemeralStorage;
      const badge = landingPage.badge(app.serviceAuthToken);
      await expect(badge).toHaveAttribute(
        "data-persistence",
        ephemeral ? "temporary" : "saved",
      );
      await expect(badge).toContainText(ephemeral ? "Temporary" : "Saved");
    }
  });

  test("Apps with several templates ask for a build system", async ({
    landingPage,
  }) => {
    const cfg = await landingPage.config();
    const multi = cfg.additionalApps.filter(
      (a) => a.visible !== false && (a.buildSystems?.length ?? 0) > 1,
    );
    expect(multi.length).toBeGreaterThan(0);
    for (const app of multi) {
      await landingPage.tile(app.serviceAuthToken).click();
      for (const system of app.buildSystems!) {
        await expect(
          landingPage.page.getByTestId(`build-system-${system.id}`),
        ).toBeVisible();
      }
      await landingPage.page.getByRole("button", { name: /Back/ }).click();
      await expect(landingPage.tile(app.serviceAuthToken)).toBeVisible();
    }
  });
});
