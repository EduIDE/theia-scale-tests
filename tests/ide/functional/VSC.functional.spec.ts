import {
  sessionAfterSpecs,
  sessionForSpecs,
} from "../../../fixtures/utils/sessions";
import { TEST_FILE_CLEANUP } from "../../../pages/ide/IDEPage";
import { test, expect } from "../../../fixtures/theia.fixture";
import { runInTerminal } from "../../../fixtures/utils/launch";
import { TheiaTerminal } from "../../../pages/ide/theia-pom/theia-terminal";
import { TheiaVSCView } from "../../../pages/ide/custom-pom/theia-vsc";

const testPrefix = "VSC-";

test.describe("Theia IDE VSC Tests", () => {
  sessionForSpecs("ide");
  test.describe.configure({ mode: "serial" });

  test.use({
    permissions: ["clipboard-write", "clipboard-read"],
  });

  const workspacePath = "vsc-test";

  test.beforeAll(async ({ ideApp }) => {
    test.slow();
    await ideApp.createAndOpenWorkspace(workspacePath);
    const terminal = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    // runInTerminal waits for each command to finish before the next one.
    await runInTerminal(terminal, "git init");
    await runInTerminal(
      terminal,
      'git config --global user.email "test@test.com"',
    );
    await runInTerminal(terminal, 'git config --global user.name "Test User"');
    const status = await runInTerminal(terminal, "git status");
    expect(status.exitCode).toBe(0);
  });

  test.beforeEach(async ({ ideApp }) => {
    await ideApp.openWorkspace(workspacePath);
    await ideApp.theiaApp.workspace.setPath("/home/project/" + workspacePath);
  });

  test("Commit", async ({ ideApp }) => {
    const terminal = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    await expect(terminal.page.locator(terminal.viewSelector)).toBeVisible();
    await runInTerminal(terminal, "touch " + testPrefix + "Test1");
    const vsc = await ideApp.theiaApp.openView(TheiaVSCView);
    await vsc.commit("Initial commit");
    // HEAD only resolves once a commit exists.
    const head = await runInTerminal(terminal, "git rev-parse --verify HEAD");
    expect(head.exitCode, "the commit exists").toBe(0);
  });

  test.fixme("Push", async () => {});

  test.afterAll(async ({ ideApp }) => {
    await ideApp.openWorkspace("");
    const terminal = await ideApp.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(`rm -rf ${workspacePath}`);
    await terminal.submit(TEST_FILE_CLEANUP);
    await terminal.submit("rm -rf .git");
  });
  sessionAfterSpecs("ide");
});
