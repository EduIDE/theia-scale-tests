import { test, openBaseIde } from "../../../fixtures/theia.fixture";
import { BASE_TEMPLATES } from "../../../fixtures/utils/catalog";
import { checkTemplate } from "../../../fixtures/utils/launch";
import {
  FUNCTIONAL_SLOTS,
  localUrl,
  sessionUrls,
  withSession,
} from "../../../fixtures/utils/sessions";

/**
 * The base templates in a fresh workspace: files are in the workspace and the
 * Run, Build and Test commands of the template's tasks.json succeed.
 */
test.describe("Base templates", () => {
  test.use({ permissions: ["clipboard-write", "clipboard-read"] });

  for (const [key, spec] of Object.entries(BASE_TEMPLATES)) {
    test(`${spec.app} / ${spec.template}`, async ({ browser }, testInfo) => {
      test.setTimeout(35 * 60_000);
      const check = async () => {
        const ide = await openBaseIde(browser, key);
        try {
          await checkTemplate(ide, spec, testInfo);
        } finally {
          await ide.page.close();
        }
      };
      if (localUrl(key)) return check();
      await withSession(
        {
          key,
          pool: "functional",
          slots: FUNCTIONAL_SLOTS,
          spec,
          browser,
          testInfo,
        },
        async (started) => {
          sessionUrls[key] = started.url;
          try {
            await check();
          } finally {
            delete sessionUrls[key];
          }
        },
      );
    });
  }
});
