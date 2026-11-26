import {
  sessionAfterSpecs,
  sessionForSpecs,
} from "../../../fixtures/utils/sessions";
import { TEST_FILE_CLEANUP } from "../../../pages/ide/IDEPage";
import { test, expect } from "../../../fixtures/theia.fixture";
import { pasteFromString } from "../../../fixtures/utils/commands";
import { TheiaExplorerView } from "../../../pages/ide/theia-pom/theia-explorer-view";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import { TheiaTextEditor } from "../../../pages/ide/theia-pom/theia-text-editor";

const testPrefix = "Editor-";

/**
 * The language-independent specs share one Java session and take turns, each in
 * a folder of its own.
 */

test.describe("Theia IDE Editor Tests", () => {
  sessionForSpecs("ide");
  test.describe.configure({ mode: "serial" });

  test.use({
    permissions: ["clipboard-write", "clipboard-read"],
  });

  const workspacePath = "editor-test";

  test.beforeAll(async ({ ideApp }) => {
    await ideApp.createAndOpenWorkspace(workspacePath);
  });

  test.beforeEach(async ({ ideApp }) => {
    await ideApp.openWorkspace(workspacePath);
    await ideApp.theiaApp.workspace.setPath("/home/project/" + workspacePath);
  });

  test("Create new File", async ({ ideApp }) => {
    const fileName = testPrefix + "Test1";
    await ideApp.createNewFile(fileName);
    const explorer = await ideApp.theiaApp.openView(TheiaExplorerView);
    await explorer.refresh();
    expect(await explorer.existsFileNode(fileName)).toBe(true);
    await ideApp.theiaApp.page
      .locator("#theia\\:menubar .p-MenuBar-itemLabel")
      .locator("text=File");
  });

  test("Create File with content", async ({ ideApp }) => {
    const fileName = testPrefix + "Test2";
    await ideApp.createNewFile(fileName);
    const editor = await ideApp.theiaApp.openEditor(fileName, TheiaTextEditor);
    await editor.activate();
    await editor.addTextToNewLineAfterLineByLineNumber(1, "Hello World");
    expect(await editor.textContentOfLineByLineNumber(2)).toContain(
      "Hello World",
    );
  });

  test("Undo and Redo text in file", async ({ ideApp }) => {
    const fileName = testPrefix + "Test3";
    const text = "undoredo";
    await ideApp.createNewFile(fileName);
    const editor = await ideApp.theiaApp.openEditor(fileName, TheiaTextEditor);
    await editor.activate();
    await editor.addTextToNewLineAfterLineByLineNumber(1, text);
    await (
      await ideApp.theiaApp.menuBar.openMenu("Edit")
    ).clickMenuItem("Undo");
    expect(await editor.numberOfLines()).toBe(1);
    await (
      await ideApp.theiaApp.menuBar.openMenu("Edit")
    ).clickMenuItem("Redo");
    expect(await editor.textContentOfLineByLineNumber(2)).toContain(text);
  });

  test("Delete File", async ({ ideApp }) => {
    const fileName = testPrefix + "Test4";
    await ideApp.createNewFile(fileName);
    const editor = await ideApp.theiaApp.openEditor(fileName, TheiaTextEditor);
    await editor.activate();
    await editor.save();
    const explorer = await ideApp.theiaApp.openView(TheiaExplorerView);
    expect(await explorer.existsFileNode(fileName)).toBe(true);
    await explorer.deleteNode(fileName);
    const terminal = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit("ls");
    const contents = await terminal.contents();
    expect(contents).not.toContain(fileName);
  });

  test("Create new File in folder", async ({ ideApp }) => {
    const fileName = testPrefix + "Test5";
    const folderPath = testPrefix + "Folder-1";
    await ideApp.createNewFolder(folderPath);
    // Theia selects the new folder and creates the next file inside it, so a
    // name with the folder in front would end up one level too deep.
    await ideApp.createNewFile(fileName);
    const explorer = await ideApp.theiaApp.openView(TheiaExplorerView);
    expect(await explorer.existsDirectoryNode(folderPath)).toBe(true);
    expect(await explorer.existsFileNode(`${folderPath}/${fileName}`)).toBe(
      true,
    );
  });

  test("Test copy from String", async ({ ideApp }) => {
    const text = "Hello World";
    const fileName = testPrefix + "Test6";
    await ideApp.createNewFile(fileName);
    const editor = await ideApp.theiaApp.openEditor(fileName, TheiaTextEditor);
    await editor.activate();
    await pasteFromString(ideApp.page, text);
    expect(await editor.textContentOfLineContainingText(text)).toBeDefined();
  });

  test.afterAll(async ({ ideApp }) => {
    await ideApp.openWorkspace("");
    const terminal = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`rm -rf ${workspacePath}`);
    await terminal.submit(TEST_FILE_CLEANUP);
  });
  sessionAfterSpecs("ide");
});
