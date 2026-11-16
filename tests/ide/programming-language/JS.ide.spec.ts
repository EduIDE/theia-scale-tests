import { expect, test } from "../../../fixtures/theia.fixture";
import { serializeOnSession } from "../../../fixtures/utils/session-lock";
import { TEST_FILE_CLEANUP } from "../../../pages/ide/IDEPage";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import { TheiaTextEditor } from "../../../pages/ide/theia-pom/theia-text-editor";
import { readFileSync } from "fs";
import path from "path";
import { pasteFromString } from "../../../fixtures/utils/commands";

const testPrefix = "LoopExample";

test.describe("JavaScript Language Test", () => {
  serializeOnSession("javascript");
  test.describe.configure({ mode: "serial" });

  test.use({
    permissions: ["clipboard-write", "clipboard-read"],
  });

  const jsTemplatePath = path.resolve(
    __dirname,
    "../../../fixtures/utils/templates/programming_languages/js.template",
  );
  const jsTemplate = readFileSync(jsTemplatePath, "utf8");
  const expectedResultPath = path.resolve(
    __dirname,
    "../../../fixtures/utils/templates/programming_languages/expected_result.template",
  );
  const expectedResult = readFileSync(expectedResultPath, "utf8");
  const fileName = testPrefix + ".js";

  const workspacePath = "js-test";

  test.beforeAll(async ({ jsApp }) => {
    await jsApp.createAndOpenWorkspace(workspacePath);
  });

  test.beforeEach(async ({ jsApp }) => {
    await jsApp.openWorkspace(workspacePath);
    await jsApp.theiaApp.workspace.setPath("/home/project/" + workspacePath);
  });

  test("JavaScript modules installed", async ({ jsApp }) => {
    const terminal = await jsApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit("node --help");
    await terminal.submit("npm");
    const contents = await terminal.contents();
    await expect(contents).toContain(
      "node [options] [ script.js ] [arguments]",
    );
    await expect(contents).toContain("npm <command>");
  });

  test("Create JavaScript file", async ({ jsApp }) => {
    await jsApp.createNewFile(fileName);
    const editor = await jsApp.theiaApp.openEditor(fileName, TheiaTextEditor);
    await editor.activate();
    await editor.focus();
    await pasteFromString(jsApp.page, jsTemplate);
    await editor.save();
    await expect(
      await editor.textContentOfLineContainingText(
        "Language is working and loops are running!",
      ),
    ).toBeDefined();
  });

  test("Run JavaScript file", async ({ jsApp }) => {
    const terminal = await jsApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`node ${fileName}`);
    const contents = await terminal.contents();
    await expect(contents).toContain(expectedResult);
  });

  test.afterAll(async ({ jsApp }) => {
    await jsApp.openWorkspace("");
    const terminal = await jsApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`rm -rf ${workspacePath}`);
    await terminal.submit(TEST_FILE_CLEANUP);
  });
});
