import { expect, test } from "../../../fixtures/theia.fixture";
import { serializeOnSession } from "../../../fixtures/utils/session-lock";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import { TheiaTextEditor } from "../../../pages/ide/theia-pom/theia-text-editor";
import { readFileSync } from "fs";
import { TheiaExplorerView } from "../../../pages/ide/theia-pom/theia-explorer-view";
import path from "path";
import { pasteFromString } from "../../../fixtures/utils/commands";

const testPrefix = "C-";

test.describe("C Language Test", () => {
  serializeOnSession("c");
  test.describe.configure({ mode: "serial" });

  test.use({
    permissions: ["clipboard-write", "clipboard-read"],
  });

  const cTemplatePath = path.resolve(
    __dirname,
    "../../../fixtures/utils/templates/programming_languages/c.template",
  );
  const cTemplate = readFileSync(cTemplatePath, "utf8");
  const expectedResultPath = path.resolve(
    __dirname,
    "../../../fixtures/utils/templates/programming_languages/expected_result.template",
  );
  const expectedResult = readFileSync(expectedResultPath, "utf8");
  const fileName = testPrefix + "Test1.c";

  const workspacePath = "c-test";

  test.beforeAll(async ({ cApp }) => {
    await cApp.createAndOpenWorkspace(workspacePath);
  });

  test.beforeEach(async ({ cApp }) => {
    await cApp.openWorkspace(workspacePath);
    await cApp.theiaApp.workspace.setPath("/home/project/" + workspacePath);
  });

  test("C modules installed", async ({ cApp }) => {
    const terminal = await cApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit("gcc");
    const contents = await terminal.contents();
    await expect(contents).toContain("no input files");
  });

  test("Create C file", async ({ cApp }) => {
    await cApp.createNewFile(fileName);
    const editor = await cApp.theiaApp.openEditor(fileName, TheiaTextEditor);
    await editor.activate();
    await editor.focus();
    await pasteFromString(cApp.page, cTemplate);
    await editor.save();
    await expect(
      await editor.textContentOfLineContainingText(
        "Language is working and loops are running!",
      ),
    ).toBeDefined();
  });

  test("Compile C file", async ({ cApp }) => {
    const terminal = await cApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`gcc -o ${fileName}.out ${fileName}`);
    const explorer = await cApp.theiaApp.openView(TheiaExplorerView);
    await explorer.waitForVisible();
    await expect(await explorer.existsFileNode(`${fileName}.out`)).toBeTruthy();
  });

  test("Run C file", async ({ cApp }) => {
    const terminal = await cApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`./${fileName}.out`);
    const contents = await terminal.contents();
    await expect(contents).toContain(expectedResult);
  });

  test.afterAll(async ({ cApp }) => {
    await cApp.openWorkspace("");
    const terminal = await cApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`rm -rf ${workspacePath}`);
  });
});
