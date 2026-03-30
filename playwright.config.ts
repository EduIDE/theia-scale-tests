import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
dotenv.config({ path: `./playwright.env` });

const authDisabled = process.env.DISABLE_AUTH === "1";
const keycloakStorageState = authDisabled
  ? undefined
  : ".auth/keycloak_user.json";
const artemisStorageState = authDisabled
  ? undefined
  : ".auth/artemis_user.json";

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
  retries: process.env.CI ? 2 : 1,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI
    ? process.env.NUM_INSTANCES
      ? parseInt(process.env.NUM_INSTANCES)
      : 1
    : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",

  timeout: 60 * 1000,

  globalSetup: require.resolve("./fixtures/utils/global-setup.ts"),

  globalTeardown: require.resolve("./fixtures/utils/global-teardown.ts"),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://127.0.0.1:3000',
    baseURL: process.env.LANDINGPAGE_URL || "https://theia.artemis.cit.tum.de",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",

    ignoreHTTPSErrors: true,
  },

  /* Configure projects for major browsers */
  projects: [
    // Setup project for auth
    {
      name: "auth-keycloak-setup",
      testMatch: "**/auth_keycloak_user.setup.ts",
      use: {
        storageState: undefined,
      },
    },
    // Setup project for auth with Artemis user
    {
      name: "auth-artemis-setup",
      testMatch: "**/auth_artemis_user.setup.ts",
      use: {
        storageState: undefined,
      },
    },

    // Setup project for IDE URL
    {
      name: "functional-setup",
      testMatch: "**/functional.setup.ts",
      use: {
        storageState: keycloakStorageState,
      },
      dependencies: ["auth-keycloak-setup"],
    },

    // Setup project for Scale tests
    {
      name: "scale-setup",
      testMatch: "**/scale.setup.ts",
      use: {
        storageState: keycloakStorageState,
      },
      dependencies: ["auth-keycloak-setup"],
    },

    // Main test projects
    {
      name: "functional",
      testMatch: /.*\.(functional|ide)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: keycloakStorageState,
        launchOptions: {
          slowMo: 500, //TODO: 500ms delay between actions as temp solution for slow UI
        },
      },
      dependencies: ["functional-setup"],
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

    // Deterministic benchmark testing on deployed version (test3)
    {
      name: "benchmark",
      testMatch: [/.*\.benchmark\.spec\.ts/, /.*\.unit\.spec\.ts/],
      workers: 1,
      timeout: 480 * 1000,
      use: {
        ...devices["Desktop Chrome"],
        storageState: keycloakStorageState,
        launchOptions: {
          slowMo: 0,
        },
      },
      dependencies: authDisabled ? [] : ["auth-keycloak-setup"],
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
      dependencies: ["auth-artemis-setup"],
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
