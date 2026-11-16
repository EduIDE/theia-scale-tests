import { test } from "@playwright/test";
import fs from "fs";
import path from "path";

const LOCK_DIR = path.join(process.cwd(), "test-data/locks");
const STALE_MS = 15 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Specs that share one launched session must not run at the same time: two
 * browser frontends on one backend race on the workspace and on file creation.
 * Workers are separate processes, so a lock directory is the cheapest way to
 * make the spec files of one session take turns while other sessions run in
 * parallel. A lock older than STALE_MS belongs to a crashed worker.
 */
export async function acquireSession(key: string, maxWaitMs = 25 * 60_000) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const lock = path.join(LOCK_DIR, key);
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > STALE_MS) {
          fs.rmSync(lock, { recursive: true });
          continue;
        }
      } catch {
        continue; // released between the two calls
      }
      if (Date.now() > deadline) {
        throw new Error(`Waited too long for the session lock "${key}"`);
      }
      await sleep(2000);
    }
  }
}

export function releaseSession(key: string) {
  fs.rmSync(path.join(LOCK_DIR, key), { recursive: true, force: true });
}

/** Call at the top of a describe block: holds the lock from its first test to its last. */
export function serializeOnSession(key: string) {
  test.beforeAll(async () => {
    test.setTimeout(30 * 60_000);
    await acquireSession(key);
  });
  test.afterAll(() => {
    releaseSession(key);
  });
}
