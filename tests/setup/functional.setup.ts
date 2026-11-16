import { test as setup } from "@playwright/test";
import fs from "fs";
import path from "path";
import { BASE_TEMPLATES, urlFileName } from "../../fixtures/utils/catalog";
import { launchIde } from "../../fixtures/utils/launch";

/**
 * Launches the base templates once. The functional specs open these sessions
 * instead of starting their own, which keeps the run under the per-user
 * session limit. The first launch after a deploy can take minutes while the
 * image is pulled, later ones about half a minute.
 */
for (const spec of Object.values(BASE_TEMPLATES)) {
  setup(`Launch ${spec.app} / ${spec.template}`, async ({ browser }, testInfo) => {
    setup.setTimeout(10 * 60_000);
    const { page, url } = await launchIde(browser, spec, testInfo);
    const dir = path.join(process.cwd(), "test-data/functional");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, urlFileName(spec)), url);
    await page.context().close();
  });
}
