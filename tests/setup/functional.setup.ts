import { test as setup } from "@playwright/test";
import fs from "fs";
import path from "path";
import { BASE_TEMPLATES, urlFileName } from "../../fixtures/utils/catalog";
import { Page, TestInfo } from "@playwright/test";
import { launchIde } from "../../fixtures/utils/launch";

/**
 * Launches the base templates once. The functional specs open these sessions
 * instead of starting their own, which keeps the run under the per-user
 * session limit. The first launch after a deploy can take minutes while the
 * image is pulled, later ones about half a minute.
 */
for (const spec of Object.values(BASE_TEMPLATES)) {
  setup(
    `Launch ${spec.app} / ${spec.template}`,
    async ({ browser }, testInfo) => {
      setup.setTimeout(10 * 60_000);
      const { page, url } = await launchIde(browser, spec, testInfo);
      if (spec.app === "c-standalone")
        await recordMakefileToolsPrompt(page, testInfo);
      const dir = path.join(process.cwd(), "test-data/functional");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, urlFileName(spec)), url);
      await page.context().close();
    },
  );
}

/**
 * The C image ships Makefile Tools, which asks "Configuring project ... Do you
 * want to continue?" when a Makefile is opened, and file creation goes wrong
 * while that question is open. Whether a student sees it on first open is
 * recorded in the report, with a screenshot.
 */
async function recordMakefileToolsPrompt(page: Page, testInfo: TestInfo) {
  const prompt = page.getByText("Configuring project", { exact: false });
  const shown = await prompt
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  testInfo.annotations.push({
    type: "makefile-tools-prompt",
    description: shown ? "shown on first open" : "not shown",
  });
  await testInfo.attach("makefile-tools-prompt", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
}
