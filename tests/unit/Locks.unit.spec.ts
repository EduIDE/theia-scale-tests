import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  LOCK_DIR,
  clearLocks,
  takeLock,
  takeSlot,
} from "../../fixtures/utils/locks";

// They share one lock directory, so they must not run in parallel.
test.describe.configure({ mode: "serial" });
test.beforeAll(() => clearLocks());
test.afterAll(() => clearLocks());

test("a lock is exclusive and only its owner releases it", async () => {
  const first = await takeLock("a", 1000);
  await expect(takeLock("a", 300)).rejects.toThrow("Waited");
  first.release();
  const second = await takeLock("a", 1000);
  // A holder that already lost the lock must not delete the new one.
  first.release();
  expect(fs.existsSync(path.join(LOCK_DIR, "keys", "a"))).toBe(true);
  second.release();
  expect(fs.existsSync(path.join(LOCK_DIR, "keys", "a"))).toBe(false);
});

test("slots are limited to their count", async () => {
  const a = await takeSlot("p", 2, 1000);
  const b = await takeSlot("p", 2, 1000);
  await expect(takeSlot("p", 2, 300)).rejects.toThrow("Waited");
  a.release();
  const c = await takeSlot("p", 2, 1000);
  b.release();
  c.release();
});

test("a lock nobody refreshed is taken over", async () => {
  const stale = await takeLock("old", 1000);
  const dir = path.join(LOCK_DIR, "keys", "old");
  const past = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(dir, past, past);
  const taken = await takeLock("old", 1000);
  stale.release();
  expect(fs.existsSync(dir)).toBe(true);
  taken.release();
});
