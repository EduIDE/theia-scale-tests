import { test } from "@playwright/test";
import { EXTRA_TEMPLATES } from "../../fixtures/utils/catalog";
import { checkTemplate } from "../../fixtures/utils/launch";
import { PLATFORM_SLOTS, withSession } from "../../fixtures/utils/sessions";

/**
 * Every template that the functional specs do not work in: launch it in a
 * fresh workspace, check its files and tasks, then stop the session again. One
 * template at a time, and each test stands on its own, so a failing template
 * does not hide the ones after it.
 */
test.describe("Remaining templates", () => {
  for (const spec of EXTRA_TEMPLATES) {
    test(`${spec.app} / ${spec.template}`, async ({ browser }, testInfo) => {
      test.setTimeout(25 * 60_000);
      await withSession(
        {
          key: "platform-templates",
          pool: "platform",
          slots: PLATFORM_SLOTS,
          spec,
          browser,
          testInfo,
          keepOpen: true,
        },
        ({ ide }) => checkTemplate(ide, spec, testInfo),
      );
    });
  }
});
