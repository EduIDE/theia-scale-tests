import { test, expect } from "../../fixtures/theia.fixture";
import { LOGOUT_SESSION_FILE } from "../../fixtures/utils/auth-files";
import {
  CloudService,
  fetchConfig,
  Template,
} from "../../fixtures/utils/service";

test.describe("Landing page (not logged in)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Opening the page sends the browser to the configured Keycloak", async ({
    page,
  }) => {
    const { keycloak } = await fetchConfig();
    // The page signs in at once, there is no login button. Keycloak forwards to
    // an identity provider at once, so the page does not rest on the Keycloak
    // URL and the request shows where the login went.
    const request = page.waitForRequest((r) =>
      r
        .url()
        .startsWith(
          `${keycloak.url.replace(/\/$/, "")}/realms/${keycloak.realm}/protocol/openid-connect/auth`,
        ),
    );
    await page.goto("/");
    const auth = new URL((await request).url());
    expect(auth.searchParams.get("client_id")).toBe(keycloak.clientId);
  });
});

// Its own login from global setup: logging out ends that Keycloak session, which
// the other tests must not share.
test.describe("Logout", () => {
  test.use({ storageState: LOGOUT_SESSION_FILE });
  // Logging out ends the stored session, so a retry could not log in again.
  test.describe.configure({ retries: 0 });

  test("Logout returns to the login", async ({ landingPage }) => {
    await landingPage.waitForLoggedIn();
    await landingPage.logout();
    // The page signs in at once, so the end of the session shows as a login
    // prompt instead of the landing page.
    await landingPage.waitForLoginPrompt();
  });
});

test.describe("Landing page (logged in)", () => {
  let templates: Template[];
  let listed: Template[];

  test.beforeAll(async () => {
    const service = await CloudService.fromStorage(
      process.env.LANDINGPAGE_URL!,
    );
    templates = await service.listTemplates();
    listed = templates.filter((t) => t.listed);
  });

  test.beforeEach(async ({ landingPage }) => {
    await landingPage.waitForLoggedIn();
  });

  test("Offers a tile per listed template with a matching badge", async ({
    landingPage,
  }) => {
    expect(listed.length).toBeGreaterThan(0);
    await landingPage.tile(listed[0].name, templates);
    await expect(landingPage.tiles).toHaveCount(listed.length);
    for (const [i, template] of listed.entries()) {
      const saved = template.defaultPersistence === "volume";
      await expect(landingPage.tiles.nth(i).locator(".tag")).toContainText(
        saved ? "Saved" : "Temporary",
      );
    }
  });

  test("Templates with variants ask for a project template", async ({
    landingPage,
  }) => {
    const multi = listed.filter(
      (t) => t.variants?.length && t.injectableKeys.includes("TEMPLATE"),
    );
    test.skip(multi.length === 0, "no listed template offers variants");
    for (const template of multi) {
      await (await landingPage.tile(template.name, templates)).click();
      for (const id of [...template.variants!.map((v) => v.id), ""]) {
        await expect(landingPage.variantOption(id)).toBeVisible();
      }
      await landingPage.page.getByRole("button", { name: "Cancel" }).click();
      await expect(landingPage.pickStart).toBeHidden();
    }
  });
});
