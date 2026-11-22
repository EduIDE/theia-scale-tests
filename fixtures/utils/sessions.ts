import { Browser, Page, test, TestInfo } from "@playwright/test";
import { BASE_TEMPLATES, TemplateSpec } from "./catalog";
import { launchIde, LaunchedIde } from "./launch";
import { Held, takeLock, takeSlot } from "./locks";
import { CloudService, unavailableReason } from "./service";

/**
 * Sessions the functional specs may hold at the same time, and the same for the
 * platform specs. With the per-user limit of 10 the two overlapping runs of
 * one environment still fit: 3 + 2 sessions each.
 */
export const FUNCTIONAL_SLOTS = 3;
export const PLATFORM_SLOTS = 2;
// A wait this long means another spec is stuck holding what we need, so the
// run fails with a message instead of using up the job.
const MAX_WAIT_MS = 20 * 60_000;

/** Session URLs of the specs of this worker, by base template key. */
export const sessionUrls: Record<string, string> = {};

/** LOCAL_URL_<KEY> points at a local container instead of a launched session. */
const LOCAL_KEYS: Record<string, string> = {
  c: "C",
  java: "JAVA",
  python: "PYTHON",
  rust: "RUST",
  javascript: "JS",
};
export const localUrl = (key: string) =>
  process.env[`LOCAL_URL_${LOCAL_KEYS[key]}`];

export interface Started extends LaunchedIde {
  service: CloudService;
  /** True when this run started the session, so only then it may stop it. */
  owned: boolean;
}

/**
 * Launches a template variant, in a fresh workspace if no session of it runs yet. A
 * session that was already running (another run, or a leftover) is used but
 * never stopped by us, because it is not ours.
 */
export async function startSession(
  browser: Browser,
  spec: Pick<TemplateSpec, "app" | "template">,
  testInfo: TestInfo,
  opts: { keepOpen?: boolean; metricName?: string } = {},
): Promise<Started> {
  const service = await CloudService.fromStorage(process.env.LANDINGPAGE_URL!);
  // Environments differ in what they offer, a missing template is no failure.
  const reason = unavailableReason(await service.listTemplates(), spec);
  test.skip(reason !== undefined, reason);

  const owned = (await service.sessionsOf(spec)).length === 0;
  if (owned && !(await service.resetWorkspace(spec).catch(() => false))) {
    testInfo.annotations.push({
      type: "workspace-not-reset",
      description: `${spec.app} / ${spec.template}: the old workspace could not be removed, template files may be left over`,
    });
  }

  const launched = await launchIde(
    browser,
    service,
    spec,
    testInfo,
    opts.metricName,
  );
  try {
    if (spec.app === "c-standalone") {
      await recordMakefileToolsPrompt(launched.page, testInfo);
    }
    if ((await service.sessionsOf(spec)).length === 0) {
      throw new Error(
        `Launched ${spec.app} / ${spec.template}, but no session of it is listed`,
      );
    }
  } catch (e) {
    await launched.page.context().close();
    if (owned) await service.stopTemplate(spec).catch(() => undefined);
    throw e;
  }
  if (!opts.keepOpen) await launched.page.context().close();
  return { ...launched, service, owned };
}

/** Stops the session if it is ours and closes the browser of the launch. */
export async function endSession(started: Started, spec: TemplateSpec) {
  await started.page
    .context()
    .close()
    .catch(() => undefined);
  if (started.owned) await started.service.stopTemplate(spec);
}

export async function acquire(key: string, pool: string, slots: number) {
  const held: Held[] = [];
  try {
    held.push(await takeLock(key, MAX_WAIT_MS));
    held.push(await takeSlot(pool, slots, MAX_WAIT_MS));
  } catch (e) {
    release(held);
    throw e;
  }
  return held;
}

export const release = (held: Held[]) =>
  held.reverse().forEach((h) => h.release());

/**
 * Runs `fn` with exclusive use of a named session and a free slot, then ends
 * the session and gives both back, also when `fn` fails.
 */
export async function withSession<T>(
  opts: {
    key: string;
    pool: string;
    slots: number;
    spec: TemplateSpec;
    browser: Browser;
    testInfo: TestInfo;
    keepOpen?: boolean;
  },
  fn: (started: Started) => Promise<T>,
): Promise<T> {
  const held = await acquire(opts.key, opts.pool, opts.slots);
  let started: Started | undefined;
  try {
    started = await startSession(opts.browser, opts.spec, opts.testInfo, {
      keepOpen: opts.keepOpen,
    });
    return await fn(started);
  } finally {
    try {
      if (started) await endSession(started, opts.spec);
    } finally {
      release(held);
    }
  }
}

// Per worker: what sessionForSpecs started and still has to give back.
const open_: Record<string, { held: Held[]; started?: Started }> = {};

/**
 * Call at the top of a describe block of specs that work in the session of a
 * base template: the block launches it, and the spec files of one session take
 * turns. Call sessionAfterSpecs at the END of the block, so the session is
 * stopped after the afterAll hooks of the specs, which still use it.
 */
export function sessionForSpecs(key: string) {
  const spec = BASE_TEMPLATES[key];
  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(35 * 60_000);
    if (localUrl(key)) return;
    const held = await acquire(key, "functional", FUNCTIONAL_SLOTS);
    open_[key] = { held };
    open_[key].started = await startSession(browser, spec, testInfo);
    sessionUrls[key] = open_[key].started!.url;
  });
}

/** The last afterAll of a block that used sessionForSpecs: hooks run in the order they are declared. */
export function sessionAfterSpecs(key: string) {
  test.afterAll(async () => {
    const entry = open_[key];
    if (!entry) return;
    try {
      if (entry.started) await endSession(entry.started, BASE_TEMPLATES[key]);
    } finally {
      delete sessionUrls[key];
      release(entry.held);
      delete open_[key];
    }
  });
}

/**
 * The C image ships Makefile Tools, which asks "Configuring project ... Do you
 * want to continue?" when a Makefile is opened, and file creation can go wrong
 * while that question is open. Whether it shows on first open is recorded in the
 * report, with a screenshot.
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
