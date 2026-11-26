import { test as teardown } from "@playwright/test";
import { TEMPLATES } from "../../fixtures/utils/catalog";
import { CloudService } from "../../fixtures/utils/service";

/** Stops what scale-setup launched, so it does not count against the session limit. */
teardown("Stop the scale sessions", async () => {
  const app = process.env.BENCH_TARGET_APP || "java-17-standalone";
  const service = await CloudService.fromStorage(process.env.LANDINGPAGE_URL!);
  const templates = await service.listTemplates();
  // The variant the setup launched. Never an empty one, which would match
  // every session of the template.
  const template =
    process.env.BENCH_TARGET_TEMPLATE ||
    templates.find((t) => t.name === app)?.variants?.[0]?.id ||
    TEMPLATES.find((t) => t.app === app)?.template;
  if (!template) throw new Error(`No variant to stop for ${app}`);
  await service.stopTemplate({ app, template });
});
