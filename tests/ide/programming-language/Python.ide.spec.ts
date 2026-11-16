import { expect, test } from "../../../fixtures/theia.fixture";
import { serializeOnSession } from "../../../fixtures/utils/session-lock";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import { TheiaTextEditor } from "../../../pages/ide/theia-pom/theia-text-editor";
import { readFileSync } from "fs";
import { TheiaExplorerView } from "../../../pages/ide/theia-pom/theia-explorer-view";
import path from "path";
import { pasteFromString } from "../../../fixtures/utils/commands";

const testPrefix = "LoopExample";

test.describe("Python Language Test", () => {
  serializeOnSession("python");
  test.describe.configure({ mode: "serial" });

  test.use({
    permissions: ["clipboard-write", "clipboard-read"],
  });

  const pythonTemplatePath = path.resolve(
    __dirname,
    "../../../fixtures/utils/templates/programming_languages/python.template",
  );
  const pythonTemplate = readFileSync(pythonTemplatePath, "utf8");
  const expectedResultPath = path.resolve(
    __dirname,
    "../../../fixtures/utils/templates/programming_languages/expected_result.template",
  );
  const expectedResult = readFileSync(expectedResultPath, "utf8");
  const fileName = testPrefix + ".py";

  const workspacePath = "python-test";

  test.beforeAll(async ({ pythonApp }) => {
    await pythonApp.createAndOpenWorkspace(workspacePath);
  });

  test.beforeEach(async ({ pythonApp }) => {
    await pythonApp.openWorkspace(workspacePath);
    await pythonApp.theiaApp.workspace.setPath(
      "/home/project/" + workspacePath,
    );
  });

  test("Python modules installed", async ({ pythonApp }) => {
    const terminal = await pythonApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit("python --help");
    await terminal.submit("python3 --help");
    const contents = await terminal.contents();
    await expect(contents).toContain("python [option]");
    await expect(contents).toContain("python3 [option]");
  });

  test("Create Python file", async ({ pythonApp }) => {
    await pythonApp.createNewFile(fileName);
    const editor = await pythonApp.theiaApp.openEditor(
      fileName,
      TheiaTextEditor,
    );
    await editor.activate();
    await editor.focus();
    await pasteFromString(pythonApp.page, pythonTemplate);
    await editor.save();
    await expect(
      await editor.textContentOfLineContainingText(
        "Language is working and loops are running!",
      ),
    ).toBeDefined();
  });

  test("Compile Python file", async ({ pythonApp }) => {
    const terminal = await pythonApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`python3 -m py_compile ${fileName}`);
    const explorer = await pythonApp.theiaApp.openView(TheiaExplorerView);
    await explorer.waitForVisible();
    await expect(
      await explorer.existsDirectoryNode(`__pycache__`),
    ).toBeTruthy();
  });

  test("Run Python file", async ({ pythonApp }) => {
    const terminal = await pythonApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`python3 ${fileName}`);
    const contents = await terminal.contents();
    await expect(contents).toContain(expectedResult);
  });

  test.afterAll(async ({ pythonApp }) => {
    await pythonApp.openWorkspace("");
    const terminal = await pythonApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`rm -rf ${workspacePath}`);
  });
});
