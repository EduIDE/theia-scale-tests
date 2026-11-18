import { Page } from "@playwright/test";
import { TheiaApp } from "../../../pages/ide/theia-pom/theia-app";
import { TheiaWorkspace } from "../../../pages/ide/theia-pom/theia-workspace";
import { IDEPage } from "../../../pages/ide/IDEPage";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import {
  loadRepositoryURL,
  loadRepositoryName,
} from "../../../fixtures/utils/constants";
import {
  PreferenceIds,
  TheiaPreferenceView,
} from "../../../pages/ide/theia-pom/theia-preference-view";
import { TheiaExplorerView } from "../../../pages/ide/theia-pom/theia-explorer-view";
import { sleep } from "../../../fixtures/utils/commands";
import {
  changePreferences,
  commit,
  createAndEditRandomFile,
  createNewRandomFile,
  editBubbleSort,
  editClient,
  editContext,
  editMergeSort,
  editPolicy,
  editSortStrategy,
  openAboutPage,
  runTests,
  searchForWords,
  useTerminal,
} from "./Scenarios";
import { determinsticRun } from "./Deterministic";
import path from "path";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(__dirname, "../../../../../playwright.env"),
});

const deterministic: boolean = process.env.DETERMINISTIC
  ? parseInt(process.env.DETERMINISTIC!, 10) === 1
  : false;

/**
 * This function is used to simulate a virtual student in the IDE for the load tests.
 * @param page The page expects Theia to be loaded and the user to be logged in
 */
// Playwright's test and Artillery's test both pass a step(name, fn) helper.
export async function virtualStudent(
  page: Page,
  test: {
    step: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
  },
) {
  const { step } = test;
  console.log("Starting virtual student");

  await step("Waiting for theia to be loaded", async () => {
    await page.waitForURL(/.*#\/home\/project/);
  });

  let theiaApp: TheiaApp;
  let idePage: IDEPage;
  let terminal: TheiaTerminal;

  await step("Setting up theia", async () => {
    const workspace = new TheiaWorkspace();
    workspace.setPath("/home/project");
    theiaApp = new TheiaApp(page, workspace, false);
    idePage = new IDEPage(page, theiaApp, page.url());
  });

  await step("Cloning the repository", async () => {
    terminal = await theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit("git clone " + loadRepositoryURL);
    let output = await terminal.contents();
    while (!output.includes("Resolving deltas: 100% (1/1), done.")) {
      await sleep(1000);
      output = await terminal.contents();
    }
    await terminal.close();
  });

  await step("Opening the explorer", async () => {
    const explorer = await theiaApp.openView(TheiaExplorerView);
    await explorer.waitForVisible();
    await explorer.waitForFileNodesToIncrease(0);
  });

  await step("Opening the workspace", async () => {
    await idePage.openWorkspace(loadRepositoryName);
    await theiaApp.workspace.setPath("/home/project/" + loadRepositoryName);
  });

  await step("Opening the preferences", async () => {
    const preferences = await theiaApp.openView(TheiaPreferenceView);
    const preferenceId = PreferenceIds.Explorer.CompactFolder;
    await preferences.setBooleanPreferenceById(preferenceId, false);
    await preferences.waitForModified(preferenceId);
  });

  /*await step("Creating necessary files", async () => {
    await createNewFile(theiaApp, "Context.java");
    await createNewFile(theiaApp, "Policy.java");
    await createNewFile(theiaApp, "SortStrategy.java");
  });*/

  await step("Running the scenarios", async () => {
    const explorer = await theiaApp.openView(TheiaExplorerView);
    await explorer.waitForVisible();
    await explorer.waitForFileNodesToIncrease(0);

    await idePage.openWorkspace(loadRepositoryName);
    await theiaApp.workspace.setPath("/home/project/" + loadRepositoryName);

    //Step 2: Disable compact folder view
    const preferences = await theiaApp.openView(TheiaPreferenceView);
    const preferenceId = PreferenceIds.Explorer.CompactFolder;
    await preferences.setBooleanPreferenceById(preferenceId, false);
    await preferences.waitForModified(preferenceId);

    const scenarios = [
      editBubbleSort,
      editMergeSort,
      editClient,
      editContext,
      editPolicy,
      editSortStrategy,
      commit,
      createNewRandomFile,
      createAndEditRandomFile,
      useTerminal,
      runTests,
      searchForWords,
      changePreferences,
      openAboutPage,
    ]; //TODO: Add more scenarios and make them more reusable

    terminal = await theiaApp.openTerminal(TheiaTerminal);

    if (deterministic) {
      await determinsticRun(theiaApp);
    } else {
      await runWithTimeout(
        async () => {
          //Step 3: Run a random scenario
          const scenario =
            scenarios[Math.floor(Math.random() * scenarios.length)];
          console.log("Running scenario: " + scenario.name);
          await scenario(theiaApp);

          //Step 4: Build the project
          await buildProject(terminal);
        },
        parseInt(process.env.LOAD_TIMEOUT!, 10) * 1000,
      );
    }
  });
}

/**
 * This function is used to build the project and wait for the build to finish.
 * @param terminal The terminal to use to build the project
 */
export async function buildProject(terminal: TheiaTerminal) {
  await terminal.activate();
  await terminal.focus();
  await terminal.submit("./gradlew build");
  let output = await terminal.contents();
  while (
    !output.includes("BUILD SUCCESSFUL") &&
    !output.includes("BUILD FAILED")
  ) {
    await sleep(1000);
    output = await terminal.contents();
  }
  await terminal.submit("clear");
}

/**
 * This function is used to run a task until it succeeds or the timeout is reached.
 * @param task The task to run
 * @param timeoutMs The timeout in milliseconds
 * @param intervalMs The interval in milliseconds between iterations
 */
async function runWithTimeout(
  task: () => Promise<void> | void,
  timeoutMs: number,
  intervalMs = 1000,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await task();

    if (intervalMs > 0) {
      await new Promise((res) => setTimeout(res, intervalMs));
    }
  }

  console.log("Timeout reached, student stopped");
}
