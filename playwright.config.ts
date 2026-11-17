import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import {
  ARTEMIS_SESSION_FILE,
  SESSION_FILE,
} from "./fixtures/utils/auth-files";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
dotenv.config({ path: `./playwright.env` });

const authDisabled = process.env.DISABLE_AUTH === "1";
const keycloakStorageState = authDisabled ? undefined : SESSION_FILE;
const artemisStorageState = authDisabled ? undefined : ARTEMIS_SESSION_FILE;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 1 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI
    ? process.env.NUM_INSTANCES
      ? parseInt(process.env.NUM_INSTANCES)
      : 1
    : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  // The JSON file feeds scripts/ci-summary.mjs.
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],

  timeout: 60 * 1000,

  // Without these a missing element waits for the whole test timeout, which is
  // what made failing specs cost six minutes each. Slow steps (session launch,
  // tasks) pass their own timeouts.
  expect: { timeout: 15 * 1000 },

  // Logs in once, see the file for why this is not a test project.
  globalSetup: require.resolve("./fixtures/utils/global-login.ts"),

  globalTeardown: require.resolve("./fixtures/utils/global-teardown.ts"),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://127.0.0.1:3000',
    baseURL: process.env.LANDINGPAGE_URL,

    // Off in CI: a trace records every request with its headers and cookies,
    // and the reports are public. Set PW_TRACE=1 to keep traces of failed
    // tests when debugging locally.
    trace: process.env.PW_TRACE
      ? {
          mode: "retain-on-failure",
          snapshots: false,
          screenshots: false,
          sources: false,
        }
      : "off",
    video: "off",
    screenshot: "only-on-failure",

    ignoreHTTPSErrors: true,

    actionTimeout: 30 * 1000,
  },

  /* Configure projects for major browsers */
  projects: [
    // Pure helpers, no environment needed
    {
      name: "unit",
      testMatch: /.*\.unit\.spec\.ts/,
    },
    // Setup project for Scale tests
    {
      name: "scale-setup",
      testMatch: "**/scale.setup.ts",
      use: {
        storageState: keycloakStorageState,
      },
      teardown: "scale-teardown",
    },

    // Stops the session scale-setup launched
    {
      name: "scale-teardown",
      testMatch: "**/scale.teardown.ts",
      use: {
        storageState: keycloakStorageState,
      },
    },

    // Main test projects
    {
      name: "functional",
      testMatch: /.*\.(functional|ide)\.spec\.ts/,
      // An IDE reload under ten parallel browsers takes well over a minute.
      timeout: 3 * 60 * 1000,
      use: {
        ...devices["Desktop Chrome"],
        storageState: keycloakStorageState,
        launchOptions: {
          slowMo: 500, //TODO: 500ms delay between actions as temp solution for slow UI
        },
      },
    },

    // Landing page, login and the templates the functional specs do not work
    // in. Runs next to functional, needs only the stored login.
    {
      name: "platform",
      testMatch: /.*\.platform\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: keycloakStorageState,
        launchOptions: { slowMo: 500 },
      },
    },

    // Scale testing on deployed version
    {
      name: "scale",
      testMatch: /.*\.scale\.spec\.ts/,
      workers: process.env.NUM_INSTANCES
        ? parseInt(process.env.NUM_INSTANCES)
        : 1,
      timeout: process.env.LOAD_TIMEOUT
        ? parseInt(process.env.LOAD_TIMEOUT) * 1000
        : 60 * 1000,
      use: {
        ...devices["Desktop Chrome"],
        storageState: keycloakStorageState,
        launchOptions: {
          slowMo: 500, //TODO: 500ms delay between actions as temp solution for slow UI
        },
      },
      dependencies: ["scale-setup"],
    },

    // Deterministic benchmark testing on a deployed Theia instance
    {
      name: "benchmark",
      testMatch: /.*\.benchmark\.spec\.ts/,
      workers: 1,
      timeout: 480 * 1000,
      use: {
        ...devices["Desktop Chrome"],
        storageState: keycloakStorageState,
        launchOptions: {
          slowMo: 0,
        },
      },
    },

    {
      name: "artemis",
      testMatch: /.*\.integration\.spec\.ts/,
      fullyParallel: true,
      workers: process.env.NUM_INSTANCES
        ? parseInt(process.env.NUM_INSTANCES)
        : 1,
      use: {
        ...devices["Desktop Chrome"],
        bypassCSP: true,
        storageState: artemisStorageState,
        launchOptions: {
          slowMo: 100, //TODO: 100ms delay between actions as temp solution for slow UI
          args: [
            "--disable-web-security",
            "--disable-site-isolation-trials",
            "--disable-features=IsolateOrigins,site-per-process",
          ],
        },
      },
    },

    // Local testing for functional tests
    {
      name: "local",
      testMatch: /.*\.(functional|ide)\.spec\.ts/,
      use: {
        baseURL: process.env.LOCAL_URL,
        launchOptions: {
          slowMo: 100, //TODO: 100ms delay between actions as temp solution for slow UI
        },
      },
    },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
