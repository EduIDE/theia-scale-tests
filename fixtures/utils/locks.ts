import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export const LOCK_DIR = path.join(process.cwd(), "test-data/locks");
const HEARTBEAT_MS = 30_000;
/** A holder that has not refreshed its lock for this long is gone. */
const STALE_MS = 3 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Held {
  release(): void;
}

/** Called once per run by global setup: nothing from an earlier run stays locked. */
export function clearLocks() {
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
}

function tryTake(dir: string, owner: string): boolean {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > STALE_MS) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // released between the two calls
    }
    return false;
  }
  fs.writeFileSync(path.join(dir, "owner"), owner);
  return true;
}

function hold(dir: string, owner: string): Held {
  // The heartbeat is what tells a waiter that the holder is still working.
  const timer = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(dir, now, now);
    } catch {
      // lock gone, nothing to keep alive
    }
  }, HEARTBEAT_MS);
  timer.unref();
  return {
    release() {
      clearInterval(timer);
      try {
        // Only the owner removes it: a lock that was stolen belongs to someone else.
        if (fs.readFileSync(path.join(dir, "owner"), "utf8") === owner) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // already gone
      }
    },
  };
}

/**
 * Takes one of `count` named slots, or waits for one. Workers are separate
 * processes, so directories on disk are what they can agree on.
 */
export async function takeSlot(
  pool: string,
  count: number,
  maxWaitMs: number,
): Promise<Held> {
  const owner = randomUUID();
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    for (let i = 0; i < count; i++) {
      const dir = path.join(LOCK_DIR, "slots", pool, String(i));
      if (tryTake(dir, owner)) return hold(dir, owner);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Waited ${maxWaitMs / 60_000} min for a free "${pool}" slot, they are held by other specs`,
      );
    }
    await sleep(2000);
  }
}

/** Takes the exclusive lock of a name, or waits for it. */
export async function takeLock(name: string, maxWaitMs: number): Promise<Held> {
  const owner = randomUUID();
  const dir = path.join(LOCK_DIR, "keys", name);
  const deadline = Date.now() + maxWaitMs;
  while (!tryTake(dir, owner)) {
    if (Date.now() > deadline) {
      throw new Error(
        `Waited ${maxWaitMs / 60_000} min for the lock "${name}", another spec holds that session`,
      );
    }
    await sleep(2000);
  }
  return hold(dir, owner);
}
