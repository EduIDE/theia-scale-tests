import { test, openBaseIde } from "../../../fixtures/theia.fixture";
import { BASE_TEMPLATES } from "../../../fixtures/utils/catalog";
import { checkTemplate } from "../../../fixtures/utils/launch";

/**
 * The templates that setup keeps launched: files are in the workspace and the
 * Run, Build and Test commands of the template's tasks.json succeed.
 */
test.describe("Base templates", () => {
  test.use({ permissions: ["clipboard-write", "clipboard-read"] });

  for (const [key, spec] of Object.entries(BASE_TEMPLATES)) {
    test(`${spec.app} / ${spec.template}`, async ({ browser }, testInfo) => {
      test.setTimeout(15 * 60_000);
      const ide = await openBaseIde(browser, key);
      try {
        await checkTemplate(ide, spec, testInfo);
      } finally {
        await ide.page.close();
      }
    });
  }
});
