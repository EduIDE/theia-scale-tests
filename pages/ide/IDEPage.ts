import { Page, expect, test } from "@playwright/test";
import { TheiaApp } from "./theia-pom/theia-app";
import { TheiaExplorerView } from "./theia-pom/theia-explorer-view";
import { TheiaTerminal } from "./theia-pom/theia-terminal";

/**
 * What the specs leave behind in the workspace. The IDE does not always open
 * the folder a spec asked for, so files can land in the project root of a Saved
 * workspace, where the next run would find them.
 */
export const TEST_FILE_CLEANUP =
  "rm -rf Editor-* Search-* Terminal-* VSC-* LoopExample* C-Test* __pycache__ *-test";

/**
 * Main IDE page class that composes all IDE components
 * Provides high-level operations that may involve multiple components
 */
export class IDEPage {
  page: Page;
  readonly theiaApp: TheiaApp;
  readonly baseURL: string;
  /** App name for reports, set by the fixture that opened this IDE. */
  label = "";
  private readyAt = 0;

  constructor(page: Page, app: TheiaApp, baseURL: string) {
    this.page = page;
    this.theiaApp = app;
    this.baseURL = baseURL;
  }

  /**
   * Custom goto method that appends the base URL to the path
   * @param path The relative path to the IDE URL
   */
  async goto(path: string) {
    await this.page.goto(this.baseURL + path);
  }

  /**
   * Wait for all essential IDE components to be ready
   */
  async waitForReady(): Promise<void> {
    // The Welcome page is not always open, so the shell is the signal.
    await this.theiaApp.waitForShellAndInitialized();
    this.readyAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  /**
   * Creates a new file with the given name
   * @param fileName Name of the file to create
   */
  async createNewFile(fileName: string = "Test-1"): Promise<void> {
    await this.createNewFileOnce(fileName);
    // Right after a reload the first creation is sometimes lost without an
    // error, so a file that does not show up in the explorer is created once more.
    if (fileName.includes("/")) return;
    for (let attempt = 0; ; attempt++) {
      await this.theiaApp.openView(TheiaExplorerView);
      const shown = await this.page
        .locator(".theia-TreeNodeSegmentGrow")
        .getByText(fileName, { exact: true })
        .first()
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (shown) return;
      if (attempt >= 1) {
        throw new Error(
          `New file "${fileName}" did not show up after two attempts`,
        );
      }
      // Not hidden: a lost first "New File" is something a student would see.
      test.info().annotations.push({
        type: "recovered",
        description:
          `recovered: file creation lost on first attempt (${this.label || "unknown app"}, ${fileName}) ` +
          `[ms since IDE ready: ${this.readyAt ? Date.now() - this.readyAt : "n/a"}]`,
      });
      await this.createNewFileOnce(fileName);
    }
  }

  private async createNewFileOnce(fileName: string): Promise<void> {
    await (
      await this.theiaApp.menuBar.openMenu("File")
    ).clickMenuItem("New File...");
    const quickPick = this.theiaApp.page.getByPlaceholder(
      "Select File Type or Enter",
    );
    // type file name and press enter
    await quickPick.fill(fileName);
    await quickPick.press("Enter");

    // check file dialog is opened and accept with ENTER
    const fileDialog = await this.theiaApp.page.waitForSelector(
      'div[class="dialogBlock"]',
    );
    expect(await fileDialog.isVisible()).toBe(true);
    await this.theiaApp.page.locator("#theia-dialog-shell").press("Enter");
    expect(await fileDialog.isVisible()).toBe(false);
  }

  async createNewFolder(folderPath: string = "project"): Promise<void> {
    await (
      await this.theiaApp.menuBar.openMenu("File")
    ).clickMenuItem("New Folder...");

    const fileDialog = await this.theiaApp.page.waitForSelector(
      'div[class="dialogBlock"]',
    );
    expect(await fileDialog.isVisible()).toBe(true);
    await this.theiaApp.page
      .locator("#theia-dialog-shell")
      .locator(".theia-input")
      .fill(folderPath);
    await this.theiaApp.page.locator("#theia-dialog-shell").press("Enter");
    expect(await fileDialog.isVisible()).toBe(false);
  }

  async createAndOpenWorkspace(workspacePath: string): Promise<void> {
    const workspaceURL = this.getWorkspaceURL("");
    await this.page.goto(workspaceURL);
    await this.waitForReady();

    const terminal = await this.theiaApp.openTerminal(TheiaTerminal);
    await terminal.submit(TEST_FILE_CLEANUP);
    await terminal.submit(`mkdir ${workspacePath}`);
    await this.page.goto(this.getWorkspaceURL(workspacePath));
    await this.reloadUntilReady();
    await this.waitForReady();
  }

  async openWorkspace(workspacePath: string): Promise<void> {
    await this.page.goto(this.getWorkspaceURL(workspacePath));
    await this.reloadUntilReady();
    await this.waitForReady;
  }

  async directAuthenticateScorpio(): Promise<void> {
    const allowButton = this.page
      .locator(".dialogBlock")
      .getByRole("button", { name: "Allow" });

    if (await allowButton.isVisible({ timeout: 5000 })) {
      await allowButton.click();
    } else {
      console.log(
        "Scorpio authentication dialog not shown, skipping authentication.",
      );
    }
  }

  setPage(page: Page) {
    this.page = page;
  }

  private getWorkspaceURL(workspacePath: string): string {
    let url = this.page.url();
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    return url.split("/#")[0] + `/#/home/project/${workspacePath}`;
  }

  async reloadUntilReady(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await this.page.reload();
      try {
        await Promise.race([
          this.waitForReady(),
          this.page.waitForTimeout(60_000).then(() => {
            throw new Error("timeout");
          }),
        ]);
        return;
      } catch {
        // not ready yet, reload and try again
      }
    }
    throw new Error("waitForReady failed after 3 reloads");
  }
}
