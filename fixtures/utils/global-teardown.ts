import fs from "fs";
import {
  ARTEMIS_SESSION_FILE,
  LOGOUT_SESSION_FILE,
  SESSION_FILE,
} from "./auth-files";

/**
 * Global teardown for Playwright tests.
 * Deletes the stored logins after the tests are run.
 */
async function globalTeardown() {
  console.log("Running global teardown...");

  for (const file of [
    SESSION_FILE,
    LOGOUT_SESSION_FILE,
    ARTEMIS_SESSION_FILE,
  ]) {
    fs.rmSync(file, { force: true });
  }

  console.log("Global teardown completed.");
}

export default globalTeardown;
