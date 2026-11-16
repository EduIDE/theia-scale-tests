import { test } from "@playwright/test";
import { EXTRA_TEMPLATES } from "../../fixtures/utils/catalog";
import { checkTemplate, launchIde } from "../../fixtures/utils/launch";
import { LandingPage } from "../../pages/landing/LandingPage";
import { CloudService } from "../../fixtures/utils/service";

/**
 * Every template that is not kept launched by the functional setup: launch it,
 * check its files and tasks, then stop the session again. One at a time, so
 * the run holds at most one extra session.
 */
test.describe("Remaining templates", () => {
  test.describe.configure({ mode: "serial" });

  let service: CloudService;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/");
    const cfg = await new LandingPage(page).config();
    await page.close();
    service = await CloudService.connect(browser, cfg, process.env.LANDINGPAGE_URL!);
  });

  test.afterAll(async () => {
    await service.dispose();
  });

  for (const spec of EXTRA_TEMPLATES) {
    test(`${spec.app} / ${spec.template}`, async ({ browser }, testInfo) => {
      test.setTimeout(20 * 60_000);
      const { page, ide } = await launchIde(browser, spec, testInfo);
      try {
        await checkTemplate(ide, spec, testInfo);
      } finally {
        await page.context().close();
        await service.stopTemplate(spec);
      }
    });
  }
});
