import { serializeOnSession } from "../../../fixtures/utils/session-lock";
import { TEST_FILE_CLEANUP } from "../../../pages/ide/IDEPage";
import { test, expect } from "../../../fixtures/theia.fixture";
import { TheiaTextEditor } from "../../../pages/ide/theia-pom/theia-text-editor";
import {
  uniqueWords10,
  uniqueWords20,
} from "../../../fixtures/utils/example-texts/lorem-ipsum";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import { TheiaSearchView } from "../../../pages/ide/custom-pom/theia-search";
import { getRandomWord } from "../../../fixtures/utils/commands";

/**
 * @description This test suite is used to test the search functionality of the IDE.
 */

const testPrefix = "Search-";

test.describe("IDE Search Tests", () => {
  serializeOnSession("javascript");
  test.describe.configure({ mode: "serial" });

  const workspacePath = "search-test";

  test.beforeAll(async ({ jsApp }) => {
    await jsApp.createAndOpenWorkspace(workspacePath);
  });

  test.beforeEach(async ({ jsApp }) => {
    await jsApp.openWorkspace(workspacePath);
    await jsApp.theiaApp.workspace.setPath("/home/project/" + workspacePath);
  });

  test("Search for text in the editor", async ({ jsApp }) => {
    const fileName = testPrefix + "Test1";
    await jsApp.createNewFile(fileName);
    const editor = await jsApp.theiaApp.openEditor(fileName, TheiaTextEditor);
    await editor.activate();
    await editor.addTextToNewLineAfterLineByLineNumber(1, uniqueWords10);
    await editor.save();
    const randomWord = getRandomWord(uniqueWords10);
    expect(randomWord).not.toBeNull();
    const line = await editor.textContentOfLineContainingText(randomWord!);
    expect(line).not.toBeNull();
    expect(line).toContain(randomWord!);
  });

  test("Search for text using menu bar", async ({ jsApp }) => {
    const fileName = testPrefix + "Test2";
    const randomWord = getRandomWord(uniqueWords10);
    expect(randomWord).not.toBeNull();
    await jsApp.createNewFile(fileName);
    const editor = await jsApp.theiaApp.openEditor(fileName, TheiaTextEditor);
    await editor.activate();
    await editor.addTextToNewLineAfterLineByLineNumber(1, uniqueWords10);
    await editor.save();
    await (await jsApp.theiaApp.menuBar.openMenu("Edit")).clickMenuItem("Find");
    await editor.page.keyboard.type(randomWord!);
    await expect(
      editor.page.locator(".editor-widget").locator(".input").first(),
    ).toBeVisible();
    await expect(
      editor.page
        .locator(".editor-widget")
        .locator(".input")
        .getByText(randomWord!),
    ).toBeDefined();
  });

  test("Search for text using sidebar", async ({ jsApp }) => {
    const fileName = testPrefix + "Test3";
    const randomWord = getRandomWord(uniqueWords10);
    expect(randomWord).not.toBeNull();
    await jsApp.createNewFile(fileName);
    const editor = await jsApp.theiaApp.openEditor(fileName, TheiaTextEditor);
    await editor.activate();
    await editor.addTextToNewLineAfterLineByLineNumber(1, uniqueWords10);
    await editor.save();
    const search = await jsApp.theiaApp.openView(TheiaSearchView);
    await search.search(randomWord!);
    const result = search.page
      .locator(search.viewSelector)
      .locator(".resultContainer")
      .getByText(randomWord!)
      .first();
    await result.waitFor();
    await expect(result).toBeVisible();
  });

  test("Search for text using sidebar multiple files", async ({ jsApp }) => {
    const fileName = testPrefix + "Test4";
    const randomWord = getRandomWord(uniqueWords20);
    expect(randomWord).not.toBeNull();
    await jsApp.createNewFile(fileName + "1");
    await jsApp.createNewFile(fileName + "2");
    const editor1 = await jsApp.theiaApp.openEditor(
      fileName + "1",
      TheiaTextEditor,
    );
    await editor1.activate();
    await editor1.addTextToNewLineAfterLineByLineNumber(1, uniqueWords20);
    await editor1.save();
    const editor2 = await jsApp.theiaApp.openEditor(
      fileName + "2",
      TheiaTextEditor,
    );
    await editor2.activate();
    await editor2.addTextToNewLineAfterLineByLineNumber(1, uniqueWords20);
    await editor2.save();
    const search = await jsApp.theiaApp.openView(TheiaSearchView);
    await search.search(randomWord!);
    const result = search.page
      .locator(search.viewSelector)
      .locator(".resultContainer")
      .getByText(randomWord!);
    const occurences = await result.all();
    // At least one hit per file: a random word can also be part of another word.
    expect(occurences.length).toBeGreaterThanOrEqual(2);
  });

  test.afterAll(async ({ jsApp }) => {
    await jsApp.openWorkspace("");
    const terminal = await jsApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`rm -rf ${workspacePath}`);
    await terminal.submit(TEST_FILE_CLEANUP);
  });
});
