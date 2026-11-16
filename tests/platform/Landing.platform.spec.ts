import { test, expect } from "../../fixtures/theia.fixture";
import { TEMPLATES } from "../../fixtures/utils/catalog";
import { recordMetric } from "../../fixtures/utils/metrics";

test.describe("Landing page (not logged in)", () => {
  // No trace: it records the typed credentials, and the artifacts are public.
  test.use({ storageState: { cookies: [], origins: [] }, trace: "off" });

  test("Login redirects to the configured Keycloak", async ({ landingPage }) => {
    const cfg = await landingPage.config();
    await expect(landingPage.loginButton).toBeVisible();
    await landingPage.loginButton.click();
    await expect(landingPage.page).toHaveURL(
      (url) => url.hostname === new URL(cfg.keycloakAuthUrl).hostname,
    );
  });

  test("Login and logout", async ({ landingPage }, testInfo) => {
    const start = Date.now();
    await landingPage.loginAndWait(
      process.env.KEYCLOAK_USER || "",
      process.env.KEYCLOAK_PWD || "",
    );
    recordMetric(testInfo, { name: "login", ms: Date.now() - start });

    // This is a separate Keycloak session, so the stored login of the other
    // tests stays valid.
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
