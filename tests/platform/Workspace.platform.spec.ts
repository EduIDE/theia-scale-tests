import { test, expect, Page } from "@playwright/test";
import { STATE_TEMPLATE as spec } from "../../fixtures/utils/catalog";
import {
  checkTemplate,
  launchIde,
  LaunchedIde,
  runInTerminal,
} from "../../fixtures/utils/launch";
import { recordMetric } from "../../fixtures/utils/metrics";
import { CloudConfig, CloudService } from "../../fixtures/utils/service";
import { LandingPage } from "../../pages/landing/LandingPage";
import { TheiaTerminal } from "../../pages/ide/theia-pom/theia-terminal";
import { TheiaWelcomeView } from "../../pages/ide/theia-pom/theia-welcome-view";

const levelItem =
  "#theia-statusBar div.element#status-bar-eduide-experience-level";
const modeItem =
  "#theia-statusBar div.element#status-bar-eduide-workspace-mode";

/**
 * One persistent workspace, followed through experience levels, the workspace
 * mode in the status bar and a session restart.
 */
test.describe("Saved workspace", () => {
  test.describe.configure({ mode: "serial", timeout: 20 * 60_000 });
  test.use({ permissions: ["clipboard-write", "clipboard-read"] });

  let launched: LaunchedIde;
  let service: CloudService;
  let cfg: CloudConfig;

  test.beforeAll(async ({ browser }, testInfo) => {
    const page = await browser.newPage();
    await page.goto("/");
    cfg = await new LandingPage(page).config();
    await page.close();
    service = await CloudService.connect(
      browser,
      cfg,
      process.env.LANDINGPAGE_URL!,
    );
    launched = await launchIde(browser, spec, testInfo);
  });

  test.afterAll(async () => {
    await launched?.page.context().close();
    if (service) {
      await service.stopTemplate(spec);
      await service.dispose();
    }
  });

  // eslint-disable-next-line no-empty-pattern
  test("Template files and tasks", async ({}, testInfo) => {
    await checkTemplate(launched.ide, spec, testInfo);
  });

  test("Status bar shows the workspace mode of the app", async () => {
    const app = cfg.additionalApps.find(
      (a) => a.serviceAuthToken === spec.app,
    )!;
    const ephemeral = app.ephemeral ?? cfg.useEphemeralStorage;
    await expect(launched.page.locator(modeItem)).toContainText(
      ephemeral ? "Temporary workspace" : "Saved workspace",
      { timeout: 60_000 },
    );
  });

  test("Expert is the default level", async () => {
    await expect(launched.page.locator(levelItem)).toContainText("Expert");
    const menus = await launched.ide.theiaApp.menuBar.visibleMenuBarItems();
    expect(menus).toEqual(
      expect.arrayContaining(["Run", "Terminal", "Experience Levels"]),
    );
  });

  test("Beginner hides menus, views and Welcome page links, Expert restores them", async () => {
    const { page, ide } = launched;
    const setLevel = async (level: string) => {
      await (
        await ide.theiaApp.menuBar.openMenu("Experience Levels")
      ).clickMenuItem(level);
    };
    const leftTabs = page.locator(".theia-app-left .lm-TabBar-tab");

    try {
      await setLevel("Beginner");
      await expect(page.locator(levelItem)).toContainText("Beginner");
      await expect
        .poll(() => ide.theiaApp.menuBar.visibleMenuBarItems())
        .toEqual(["File", "Edit", "View", "Experience Levels", "Help"]);
      // Which side bar tabs are left is recorded, so a change shows in the report.
      test.info().annotations.push({
        type: "beginner-left-tabs",
        description: (
          await leftTabs.evaluateAll((tabs) => tabs.map((t) => t.id))
        ).join(", "),
      });
      for (const hidden of [
        "scm-view-container",
        "debug",
        "test-view-container",
      ]) {
        await expect(page.locator(`#shell-tab-${hidden}`)).toHaveCount(0);
      }
      await expect(
        page.locator("#shell-tab-explorer-view-container"),
      ).toBeVisible();
      await expect(
        page.locator("#shell-tab-search-view-container"),
      ).toBeVisible();

      await openWelcome(page, ide);
      const welcome = page.locator(welcomeSelector(ide));
      await expect(welcome).not.toContainText("Open new Terminal");
      await expect(welcome).not.toContainText("Open Version Control");
    } finally {
      await setLevel("Expert");
    }

    await expect(page.locator(levelItem)).toContainText("Expert");
    await expect
      .poll(() => ide.theiaApp.menuBar.visibleMenuBarItems())
      .toEqual(expect.arrayContaining(["Run", "Terminal"]));
    await expect(leftTabs.nth(2)).toBeVisible();
    await expect(page.locator(welcomeSelector(ide))).toContainText(
      "Open new Terminal",
    );
  });

  test("Files survive a session restart", async ({ browser }, testInfo) => {
    const marker = `persisted-${Date.now()}`;
    const terminal = await launched.ide.theiaApp.openTerminal(TheiaTerminal);
    await runInTerminal(terminal, `echo ${marker} > e2e-persist.txt && sync`);
    await launched.page.context().close();

    await service.stopTemplate(spec);
    // Starting while the old session still counts as running is refused.
    await expect
      .poll(
        async () =>
          (await service.listSessions()).filter(
            (s) => s.appDefinition === spec.app,
          ).length,
        {
          timeout: 3 * 60_000,
        },
      )
      .toBe(0);

    launched = await launchIde(browser, spec, testInfo, "restart");
    recordMetric(testInfo, {
      name: "restart-total",
      ...spec,
      ms: launched.launchMs,
    });
    const after = await launched.ide.theiaApp.openTerminal(TheiaTerminal);
    const { output } = await runInTerminal(after, "cat e2e-persist.txt");
    expect(output).toContain(marker);
  });
});

async function openWelcome(page: Page, ide: LaunchedIde["ide"]) {
  const welcome = new TheiaWelcomeView(ide.theiaApp);
  if (await welcome.isTabVisible()) {
    await welcome.activate();
  } else {
    await (
      await ide.theiaApp.menuBar.openMenu("Help")
    ).clickMenuItem("Welcome");
  }
  await page.locator(welcome.viewSelector).waitFor({ state: "visible" });
}

function welcomeSelector(ide: LaunchedIde["ide"]) {
  return new TheiaWelcomeView(ide.theiaApp).viewSelector;
}
