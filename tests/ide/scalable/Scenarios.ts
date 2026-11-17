import { expect } from "@playwright/test";
import { TheiaApp } from "../../../pages/ide/theia-pom/theia-app";
import { TheiaTextEditor } from "../../../pages/ide/theia-pom/theia-text-editor";
import {
  deleteAll,
  getRandomWord,
  pasteFromString,
  sleep,
} from "../../../fixtures/utils/commands";
import { readFileSync } from "fs";
import path from "path";
import { TheiaVSCView } from "../../../pages/ide/custom-pom/theia-vsc";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import { TheiaSearchView } from "../../../pages/ide/custom-pom/theia-search";
import {
  PreferenceIds,
  TheiaPreferenceView,
} from "../../../pages/ide/theia-pom/theia-preference-view";
import { loremIpsum100 } from "../../../fixtures/utils/example-texts/lorem-ipsum";
import { TheiaExplorerView } from "../../../pages/ide/theia-pom/theia-explorer-view";

const bubbleSortTemplatePath = path.resolve(
  process.cwd(),
  "fixtures/utils/templates/exercise_solutions/BubbleSort.txt",
);
const bubbleSortTemplate = readFileSync(bubbleSortTemplatePath, "utf8");
const mergeSortTemplatePath = path.resolve(
  process.cwd(),
  "fixtures/utils/templates/exercise_solutions/MergeSort.txt",
);
const mergeSortTemplate = readFileSync(mergeSortTemplatePath, "utf8");
const clientTemplatePath = path.resolve(
  process.cwd(),
  "fixtures/utils/templates/exercise_solutions/Client.txt",
);
const clientTemplate = readFileSync(clientTemplatePath, "utf8");
const contextTemplatePath = path.resolve(
  process.cwd(),
  "fixtures/utils/templates/exercise_solutions/Context.txt",
);
const contextTemplate = readFileSync(contextTemplatePath, "utf8");
const policyTemplatePath = path.resolve(
  process.cwd(),
  "fixtures/utils/templates/exercise_solutions/Policy.txt",
);
const policyTemplate = readFileSync(policyTemplatePath, "utf8");
const sortStrategyTemplatePath = path.resolve(
  process.cwd(),
  "fixtures/utils/templates/exercise_solutions/SortStrategy.txt",
);
const sortStrategyTemplate = readFileSync(sortStrategyTemplatePath, "utf8");

/**
 * This function is used to edit the BubbleSort.java file.
 * @param theiaApp The TheiaApp instance
 */
export async function editBubbleSort(theiaApp: TheiaApp) {
  const editor = await theiaApp.openEditor(
    `src/de/BubbleSort.java`,
    TheiaTextEditor,
  );
  await editor.waitForVisible();
  await editor.focus();
  await deleteAll(theiaApp.page);
  await sleep(1000);
  await pasteFromString(theiaApp.page, bubbleSortTemplate);
}

/**
 * This function is used to edit the MergeSort.java file.
 * @param theiaApp The TheiaApp instance
 */
export async function editMergeSort(theiaApp: TheiaApp) {
  const editor = await theiaApp.openEditor(
    `src/de/MergeSort.java`,
    TheiaTextEditor,
  );
  await editor.waitForVisible();
  await editor.focus();
  await deleteAll(theiaApp.page);
  await sleep(1000);
  await pasteFromString(theiaApp.page, mergeSortTemplate);
  await sleep(1000);
}

/**
 * This function is used to edit the MergeSort.java file.
 * @param theiaApp The TheiaApp instance
 */
export async function editClient(theiaApp: TheiaApp) {
  const editor = await theiaApp.openEditor(
    `src/de/Client.java`,
    TheiaTextEditor,
  );
  await editor.waitForVisible();
  await editor.focus();
  await deleteAll(theiaApp.page);
  await sleep(1000);
  await pasteFromString(theiaApp.page, clientTemplate);
  await sleep(1000);
}

/**
 * This function is used to edit the Context.java file.
 * @param theiaApp The TheiaApp instance
 */
export async function editContext(theiaApp: TheiaApp) {
  await createNewFile(theiaApp, "Context.java");
  const editor = await theiaApp.openEditor(
    `src/de/Context.java`,
    TheiaTextEditor,
  );
  await editor.waitForVisible();
  await editor.focus();
  await deleteAll(theiaApp.page);
  await sleep(1000);
  await pasteFromString(theiaApp.page, contextTemplate);
  await sleep(1000);
}

/**
 * This function is used to edit the Policy.java file.
 * @param theiaApp The TheiaApp instance
 */
export async function editPolicy(theiaApp: TheiaApp) {
  await createNewFile(theiaApp, "Policy.java");
  const editor = await theiaApp.openEditor(
    `src/de/Policy.java`,
    TheiaTextEditor,
  );
  await editor.waitForVisible();
  await editor.focus();
  await deleteAll(theiaApp.page);
  await sleep(1000);
  await pasteFromString(theiaApp.page, policyTemplate);
  await sleep(1000);
}

/**
 * This function is used to edit the SortStrategy.java file.
 * @param theiaApp The TheiaApp instance
 */
export async function editSortStrategy(theiaApp: TheiaApp) {
  await createNewFile(theiaApp, "SortStrategy.java");
  const editor = await theiaApp.openEditor(
    `src/de/SortStrategy.java`,
    TheiaTextEditor,
  );
  await editor.waitForVisible();
  await editor.focus();
  await deleteAll(theiaApp.page);
  await sleep(1000);
  await pasteFromString(theiaApp.page, sortStrategyTemplate);
  await sleep(1000);
}

/**
 * This function is used to commit the changes to the repository.
 * @param theiaApp The TheiaApp instance
 */
export async function commit(theiaApp: TheiaApp) {
  const vsc = await theiaApp.openView(TheiaVSCView);
  await sleep(1000);
  await vsc.commit(
    "Initial commit from Theia" + Math.random().toString(36).substring(2, 15),
  );
}

/**
 * This function is used to create a new random file.
 * @param theiaApp The TheiaApp instance
 */
export async function createNewRandomFile(theiaApp: TheiaApp) {
  await theiaApp.openEditor(
    `src/de/BubbleSort.java`,
    TheiaTextEditor,
  );
  await theiaApp.openView(TheiaExplorerView);
  await (await theiaApp.menuBar.openMenu("File")).clickMenuItem("New File...");
  const quickPick = theiaApp.page.getByPlaceholder("Select File Type or Enter");
  await sleep(1000);

  const fileName =
    "RandomFile" + Math.random().toString(36).substring(2, 15);
  await quickPick.fill(fileName);
  await quickPick.press("Enter");
  await sleep(1000);

  const fileDialog = await theiaApp.page.waitForSelector(
    'div[class="dialogBlock"]',
  );
  expect(await fileDialog.isVisible()).toBe(true);
  await theiaApp.page.locator("#theia-dialog-shell").press("Enter");
  expect(await fileDialog.isVisible()).toBe(false);

  return "src/de/" + fileName;
}

/**
 * This function is used to create a new file.
 * @param theiaApp The TheiaApp instance
 */
export async function createNewFile(theiaApp: TheiaApp, newFileName: string) {
  await theiaApp.openEditor(
    `src/de/BubbleSort.java`,
    TheiaTextEditor,
  );
  await (await theiaApp.menuBar.openMenu("File")).clickMenuItem("New File...");
  const quickPick = theiaApp.page.getByPlaceholder("Select File Type or Enter");
  await sleep(1000);

  const fileName =
    newFileName;
  await quickPick.fill(fileName);
  await quickPick.press("Enter");
  await sleep(1000);

  const fileDialog = await theiaApp.page.waitForSelector(
    'div[class="dialogBlock"]',
  );
  expect(await fileDialog.isVisible()).toBe(true);
  await theiaApp.page.locator("#theia-dialog-shell").press("Enter");
  expect(await fileDialog.isVisible()).toBe(false);

  return fileName;
}

/**
 * This function is used to edit a random file.
 * @param theiaApp The TheiaApp instance
 */
export async function createAndEditRandomFile(theiaApp: TheiaApp) {
  const fileName = await createNewRandomFile(theiaApp);
  const editor = await theiaApp.openEditor(fileName, TheiaTextEditor);
  await editor.waitForVisible();
  await editor.focus();
  await deleteAll(theiaApp.page);
  await sleep(1000);
  await pasteFromString(theiaApp.page, loremIpsum100);
  await sleep(1000);
}

/**
 * This function is used to use the terminal.
 * @param theiaApp The TheiaApp instance
 */
export async function useTerminal(theiaApp: TheiaApp) {
  const terminal = await theiaApp.openTerminal(TheiaTerminal);
  await terminal.waitForVisible();
  await terminal.focus();
  await sleep(1000);
  await terminal.submit("ls");
  await sleep(1000);
  await terminal.submit("clear");
  await sleep(1000);
  await terminal.submit("pwd");
  await sleep(1000);
  await terminal.submit("clear");
  await sleep(1000);
  await terminal.submit("cd ..");
  await sleep(1000);
  await terminal.submit("clear");
  await sleep(1000);
}

/**
 * This function is used to run the tests.
 * @param theiaApp The TheiaApp instance
 */
export async function runTests(theiaApp: TheiaApp) {
  const terminal = await theiaApp.openTerminal(TheiaTerminal);
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
  await terminal.close();
}

/**
 * This function is used to search for words in the editor.
 * @param theiaApp The TheiaApp instance
 */
export async function searchForWords(theiaApp: TheiaApp) {
  const search = await theiaApp.openView(TheiaSearchView);
  const randomWord = getRandomWord(bubbleSortTemplate);
  await search.search(randomWord!);
  await search.close();
}

/**
 * This function is used to change preferences.
 * @param theiaApp The TheiaApp instance
 */
export async function changePreferences(theiaApp: TheiaApp) {
  const preferences = await theiaApp.openView(TheiaPreferenceView);
  await sleep(1000);
  await preferences.setBooleanPreferenceById(
    PreferenceIds.Files.EnableTrash,
    true,
  );
  await preferences.waitForModified(PreferenceIds.Files.EnableTrash);
  await sleep(1000);
  await preferences.close();
}

/**
 * This function is used to open the about page.
 * @param theiaApp The TheiaApp instance
 */
export async function openAboutPage(theiaApp: TheiaApp) {
  await (await theiaApp.menuBar.openMenu("Help")).clickMenuItem("About");
  await sleep(1000);
  await theiaApp.page.waitForSelector('div[class="dialogBlock"]');
  await theiaApp.page.locator(".dialogBlock").locator(".theia-button").click();
  await sleep(1000);
}

/**
 * This function is used to reload the page.
 * @param theiaApp The TheiaApp instance
 */
export async function reloadPage(theiaApp: TheiaApp) {
  await theiaApp.page.reload();
  await sleep(1000);
  await theiaApp.page.waitForSelector(".gs-header");
  await sleep(1000);
}
