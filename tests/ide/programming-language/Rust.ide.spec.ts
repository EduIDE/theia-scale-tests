import { expect, test } from "../../../fixtures/theia.fixture";
import {
  sessionAfterSpecs,
  sessionForSpecs,
} from "../../../fixtures/utils/sessions";
import { TEST_FILE_CLEANUP } from "../../../pages/ide/IDEPage";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import { TheiaTextEditor } from "../../../pages/ide/theia-pom/theia-text-editor";
import { readFileSync } from "fs";
import { TheiaExplorerView } from "../../../pages/ide/theia-pom/theia-explorer-view";
import path from "path";
import { pasteFromString } from "../../../fixtures/utils/commands";

const testPrefix = "LoopExample";

test.describe("Rust Language Test", () => {
  sessionForSpecs("rust");
  test.describe.configure({ mode: "serial" });

  test.use({
    permissions: ["clipboard-write", "clipboard-read"],
  });

  const rustTemplatePath = path.resolve(
    __dirname,
    "../../../fixtures/utils/templates/programming_languages/rust.template",
  );
  const rustTemplate = readFileSync(rustTemplatePath, "utf8");
  const expectedResultPath = path.resolve(
    __dirname,
    "../../../fixtures/utils/templates/programming_languages/expected_result.template",
  );
  const expectedResult = readFileSync(expectedResultPath, "utf8");
  const fileName = testPrefix + ".rs";

  const workspacePath = "rust-test";

  test.beforeAll(async ({ rustApp }) => {
    await rustApp.createAndOpenWorkspace(workspacePath);
  });

  test.beforeEach(async ({ rustApp }) => {
    await rustApp.openWorkspace(workspacePath);
    await rustApp.theiaApp.workspace.setPath("/home/project/" + workspacePath);
  });

  test("Rust modules installed", async ({ rustApp }) => {
    const terminal = await rustApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit("rustc");
    await terminal.submit("rustup");
    const contents = await terminal.contents();
    await expect(contents).toContain("rustc [OPTIONS] INPUT");
    await expect(contents).toContain("The Rust toolchain installer");
  });

  test("Create Rust file", async ({ rustApp }) => {
    await rustApp.createNewFile(fileName);
    const editor = await rustApp.theiaApp.openEditor(fileName, TheiaTextEditor);
    await editor.activate();
    await editor.focus();
    await pasteFromString(rustApp.page, rustTemplate);
    await editor.save();
    await expect(
      await editor.textContentOfLineContainingText(
        "Language is working and loops are running!",
      ),
    ).toBeDefined();
  });

  test("Compile Rust file", async ({ rustApp }) => {
    const terminal = await rustApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`rustc ${fileName}`);
    const explorer = await rustApp.theiaApp.openView(TheiaExplorerView);
    await explorer.waitForVisible();
    await expect(await explorer.existsFileNode(`${testPrefix}`)).toBeTruthy();
  });

  test("Run Rust file", async ({ rustApp }) => {
    const terminal = await rustApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`./${testPrefix}`);
    const contents = await terminal.contents();
    await expect(contents).toContain(expectedResult);
  });

  test.afterAll(async ({ rustApp }) => {
    await rustApp.openWorkspace("");
    const terminal = await rustApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`rm -rf ${workspacePath}`);
    await terminal.submit(TEST_FILE_CLEANUP);
  });
  sessionAfterSpecs("rust");
});
