import { test as teardown } from "@playwright/test";
import { LandingPage } from "../../pages/landing/LandingPage";
import { CloudService } from "../../fixtures/utils/service";

/** Stops what scale-setup launched, so it does not count against the session limit. */
teardown("Stop the scale sessions", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/");
  const cfg = await new LandingPage(page).config();
  await page.close();
  const app = process.env.BENCH_TARGET_APP || "java-17-standalone";
  const systems =
    cfg.additionalApps.find((a) => a.serviceAuthToken === app)?.buildSystems ??
    [];
  const template = process.env.BENCH_TARGET_TEMPLATE || systems[0]?.id || "";
  const service = await CloudService.fromStorage(
    cfg,
    process.env.LANDINGPAGE_URL!,
  );
  await service.stopTemplate({ app, template });
});
