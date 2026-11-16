import { test as teardown } from "@playwright/test";
import { BASE_TEMPLATES } from "../../fixtures/utils/catalog";
import { LandingPage } from "../../pages/landing/LandingPage";
import { CloudService } from "../../fixtures/utils/service";

/**
 * Stops the sessions the setup launched. Sessions that are left running count
 * against the per-user limit until the idle timeout ends them, which would
 * starve the next run.
 */
teardown("Stop base sessions", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/");
  const cfg = await new LandingPage(page).config();
  await page.close();
  const service = await CloudService.connect(
    browser,
    cfg,
    process.env.LANDINGPAGE_URL!,
  );
  for (const spec of Object.values(BASE_TEMPLATES)) {
    await service.stopTemplate(spec);
  }
  await service.dispose();
});
