import { test as teardown } from "@playwright/test";
import { CloudService } from "../../fixtures/utils/service";

/** Stops what scale-setup launched, so it does not count against the session limit. */
teardown("Stop the scale sessions", async () => {
  const app = process.env.BENCH_TARGET_APP || "java-17-standalone";
  const service = await CloudService.fromStorage(process.env.LANDINGPAGE_URL!);
  const templates = await service.listTemplates();
  const template =
    process.env.BENCH_TARGET_TEMPLATE ||
    templates.find((t) => t.name === app)?.variants?.[0]?.id ||
    "";
  await service.stopTemplate({ app, template });
});
