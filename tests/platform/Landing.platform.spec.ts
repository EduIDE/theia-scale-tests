import { test, expect } from "../../fixtures/theia.fixture";
import { TEMPLATES } from "../../fixtures/utils/catalog";

test.describe("Landing page (not logged in)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Login redirects to the configured Keycloak", async ({
    landingPage,
  }) => {
    const cfg = await landingPage.config();
    await expect(landingPage.loginButton).toBeVisible();
    await landingPage.loginButton.click();
    await expect(landingPage.page).toHaveURL(
      (url) => url.hostname === new URL(cfg.keycloakAuthUrl).hostname,
    );
  });
});

// Its own login from global setup: logging out ends that Keycloak session, which
// the other tests must not share.
test.describe("Logout", () => {
  test.use({ storageState: ".auth/keycloak_logout_user.json" });

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
