import {
  sessionAfterSpecs,
  sessionForSpecs,
} from "../../../fixtures/utils/sessions";
import { TEST_FILE_CLEANUP } from "../../../pages/ide/IDEPage";
import { test, expect } from "../../../fixtures/theia.fixture";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import { TheiaExplorerView } from "../../../pages/ide/theia-pom/theia-explorer-view";

const testPrefix = "Terminal-";

test.describe("Theia IDE Terminal Tests", () => {
  sessionForSpecs("ide");
  test.describe.configure({ mode: "serial" });

  test.use({
    permissions: ["clipboard-write", "clipboard-read"],
  });

  const workspacePath = "terminal-test";

  test.beforeAll(async ({ ideApp }) => {
    await ideApp.createAndOpenWorkspace(workspacePath);
  });

  test.beforeEach(async ({ ideApp }) => {
    await ideApp.openWorkspace(workspacePath);
    await ideApp.theiaApp.workspace.setPath("/home/project/" + workspacePath);
  });

  test("Open Terminal", async ({ ideApp }) => {
    const terminal = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    await expect(terminal.page.locator(terminal.viewSelector)).toBeVisible();
    expect(await terminal.isTabVisible()).toBe(true);
    expect(await terminal.isDisplayed()).toBe(true);
    expect(await terminal.isActive()).toBe(true);
  });

  test("Terminal command: ls", async ({ ideApp }) => {
    const terminal = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    await expect(terminal.page.locator(terminal.viewSelector)).toBeVisible();
    const fileName = testPrefix + "Test1";
    await ideApp.createNewFile(fileName);
    await terminal.submit("ls");
    const contents = await terminal.contents();
    expect(contents).toContain(fileName);
  });

  test("Terminal command: touch", async ({ ideApp }) => {
    const terminal = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    await expect(terminal.page.locator(terminal.viewSelector)).toBeVisible();
    const fileName = testPrefix + "Test2";
    await terminal.submit("touch " + fileName);
    await terminal.submit("ls");
    const contents = await terminal.contents();
    expect(contents).toContain(fileName);
    const explorer = await ideApp.theiaApp.openView(TheiaExplorerView);
    await explorer.refresh();
    expect(await explorer.existsFileNode(fileName)).toBe(true);
  });

  test("Terminal command: rm", async ({ ideApp }) => {
    const terminal = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    const fileName = testPrefix + "Test3";
    await terminal.submit("touch " + fileName);
    const explorer = await ideApp.theiaApp.openView(TheiaExplorerView);
    expect(await explorer.existsFileNode(fileName)).toBe(true);
    await terminal.submit("rm " + fileName);
    await terminal.submit("clear");
    await terminal.submit("ls");
    const contents = await terminal.contents();
    expect(contents).not.toContain(fileName);
  });

  test("Terminal multiple tabs", async ({ ideApp }) => {
    const terminal1 = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    const terminal2 = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    expect(await terminal1.isTabVisible()).toBe(true);
    expect(await terminal2.isTabVisible()).toBe(true);
    await terminal1.activate();
    await terminal1.submit('echo "Hello" > ' + testPrefix + "Test4");
    await terminal2.activate();
    await terminal2.submit("cat " + testPrefix + "Test4");
    const contents = await terminal2.contents();
    expect(contents).toContain("Hello");
    await terminal1.close();
    await terminal2.close();
    expect(await terminal1.isTabVisible()).toBe(false);
    expect(await terminal2.isTabVisible()).toBe(false);
  });

  test.afterAll(async ({ ideApp }) => {
    await ideApp.openWorkspace("");
    const terminal = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`rm -rf ${workspacePath}`);
    await terminal.submit(TEST_FILE_CLEANUP);
  });
  sessionAfterSpecs("ide");
});
