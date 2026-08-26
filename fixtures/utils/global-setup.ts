import fs from "fs";
import path from "path";
import { debugLog } from "./debug-logging";

/**
 * Global setup for Playwright tests.
 * Checks for env variables and sets the IDE URL incase of local tests.
 */
async function globalSetup(config: { projects: { name: string }[] }) {
  console.log("Running global setup...");
  debugLog("global-setup", "entered global setup");

  const isAuthDisabled = process.env.DISABLE_AUTH === "1";
  debugLog("global-setup", "computed auth mode", { isAuthDisabled });

  if (!isAuthDisabled && (!process.env.KEYCLOAK_USER || !process.env.KEYCLOAK_PWD)) {
    throw new Error("KEYCLOAK_USER or KEYCLOAK_PWD environment variable is not set");
  }

  const isLocal = config.projects.some((project) => project.name === "local");
  debugLog("global-setup", "detected local project", { isLocal });

  if (isLocal) {
    const testDataDir = path.join(process.cwd(), "test-data/functional");
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(testDataDir, "ide-url-c.txt"),
      process.env.LOCAL_URL_C || "",
    );
    fs.writeFileSync(
      path.join(testDataDir, "ide-url-java-17.txt"),
      process.env.LOCAL_URL_JAVA || "",
    );
    fs.writeFileSync(
      path.join(testDataDir, "ide-url-python.txt"),
      process.env.LOCAL_URL_PYTHON || "",
    );
    fs.writeFileSync(
      path.join(testDataDir, "ide-url-ocaml.txt"),
      process.env.LOCAL_URL_OCAML || "",
    );
    fs.writeFileSync(
      path.join(testDataDir, "ide-url-rust.txt"),
      process.env.LOCAL_URL_RUST || "",
    );
    fs.writeFileSync(
      path.join(testDataDir, "ide-url-javascript.txt"),
      process.env.LOCAL_URL_JS || "",
    );
  } else {
    if (!process.env.LANDINGPAGE_URL) {
      throw new Error(
        "LANDINGPAGE_URL environment variable is not set, please set the base URL for the Theiea instance to be tested against",
      );
    }
  }

  // config.projects is NOT filtered by --project here, so "scale" is present
  // even for `--project=functional`. Requiring NUM_INSTANCES on that basis
  // failed the functional suite in CI, which does not use it at all. The check
  // belongs in scale.setup.ts, which only runs for the scale project.
  const isScale = config.projects.some((project) => project.name === "scale");
  debugLog("global-setup", "scale project present in config", { isScale });

  if (isScale) {
    const testDataDir = path.join(process.cwd(), "test-data/scale");
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
  }

  console.log("Global setup completed.");
  debugLog("global-setup", "global setup complete");
}

export default globalSetup;
