import { expect, test } from "../../../fixtures/theia.fixture";
import { sessionForSpecs } from "../../../fixtures/utils/sessions";
import { TEST_FILE_CLEANUP } from "../../../pages/ide/IDEPage";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import { TheiaTextEditor } from "../../../pages/ide/theia-pom/theia-text-editor";
import { readFileSync } from "fs";
import { TheiaExplorerView } from "../../../pages/ide/theia-pom/theia-explorer-view";
import path from "path";
import { pasteFromString } from "../../../fixtures/utils/commands";

const testPrefix = "LoopExample";

test.describe("Java Language Test", () => {
  sessionForSpecs("java");
  test.describe.configure({ mode: "serial" });

  test.use({
    permissions: ["clipboard-write", "clipboard-read"],
  });

  const javaTemplatePath = path.resolve(
    __dirname,
    "../../../fixtures/utils/templates/programming_languages/java.template",
  );
  const javaTemplate = readFileSync(javaTemplatePath, "utf8");
  const expectedResultPath = path.resolve(
    __dirname,
    "../../../fixtures/utils/templates/programming_languages/expected_result.template",
  );
  const expectedResult = readFileSync(expectedResultPath, "utf8");
  const fileName = testPrefix + ".java";

  const workspacePath = "java-test";

  test.beforeAll(async ({ javaApp }) => {
    await javaApp.createAndOpenWorkspace(workspacePath);
  });

  test.beforeEach(async ({ javaApp }) => {
    await javaApp.openWorkspace(workspacePath);
    await javaApp.theiaApp.workspace.setPath("/home/project/" + workspacePath);
  });

  test("Java modules installed", async ({ javaApp }) => {
    const terminal = await javaApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit("javac");
    await terminal.submit("java");
    const contents = await terminal.contents();
    await expect(contents).toContain("javac <options> <source files>");
    await expect(contents).toContain("java [options]");
  });

  test("Create Java file", async ({ javaApp }) => {
    await javaApp.createNewFile(fileName);
    const editor = await javaApp.theiaApp.openEditor(fileName, TheiaTextEditor);
    await editor.activate();
    await editor.focus();
    await pasteFromString(javaApp.page, javaTemplate);
    await editor.save();
    await expect(
      await editor.textContentOfLineContainingText(
        "Language is working and loops are running!",
      ),
    ).toBeDefined();
  });

  test("Compile Java file", async ({ javaApp }) => {
    const terminal = await javaApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`javac ${fileName}`);
    const explorer = await javaApp.theiaApp.openView(TheiaExplorerView);
    await explorer.waitForVisible();
    await expect(
      await explorer.existsFileNode(`${testPrefix}.class`),
    ).toBeTruthy();
  });

  test("Run Java file", async ({ javaApp }) => {
    const terminal = await javaApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`java ${fileName}`);
    const contents = await terminal.contents();
    await expect(contents).toContain(expectedResult);
  });

  test.afterAll(async ({ javaApp }) => {
    await javaApp.openWorkspace("");
    const terminal = await javaApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`rm -rf ${workspacePath}`);
    await terminal.submit(TEST_FILE_CLEANUP);
  });
});
