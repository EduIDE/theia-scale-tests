import { TheiaApp } from "../theia-pom/theia-app";
import { TheiaView } from "../theia-pom/theia-view";
import { Locator } from "@playwright/test";

const TheiaVSCViewData = {
  tabSelector: "#shell-tab-scm-view-container",
  viewSelector: "#scm-view-container--scm-view",
  viewName: "Source Control",
};

export class TheiaVSCView extends TheiaView {
  constructor(app: TheiaApp) {
    super(TheiaVSCViewData, app);
  }

  override async activate(): Promise<void> {
    await super.activate();
    const viewElement = await this.viewElement();
    await viewElement?.waitForSelector(".theia-scm-main-container");
  }

async commit(message: string): Promise<void> {
  await this.page
    .locator(".theia-scm-main-container .theia-scm-input-message")
    .fill(message);
  const commitButton = this.page
    .locator(".theia-sidepanel-toolbar .codicon-check")
    .or(this.page.getByRole("button", { name: /Commit/ }))
    .first();
  await commitButton.click();
  try {
    const commitDialog = await this.page.waitForSelector(
      'div[class="dialogBlock"]',
      { timeout: 5000 }
    );
    await commitDialog.press("Enter");
  } catch (e) {
    console.log("Nothing to commit skipping.");
  }
}

  async commitAllandPush(message: string): Promise<void> {
    await this.page
      .locator(".theia-scm-main-container")
      .locator(".theia-scm-input-message")
      .fill(message);
    const commitButton = await this.page
      .locator(".theia-sidepanel-toolbar")
      .locator(".codicon-check");
    await commitButton.click();
    const commitDialog = await this.page.waitForSelector(
      'div[class="dialogBlock"]',
    );
    await commitDialog.press("Enter");
    await this.push();
  }

  async pull(): Promise<void> {
    const pullButton = await this.page
      .locator(".theia-scm-main-container")
      .locator(".theia-scm-pull-button");
    await pullButton.click();
  }

  async push(): Promise<void> {
    const moreActionsButton = await this.getMoreActionsButton();
    await moreActionsButton.click();
    const pushButton = await this.page.locator('li[data-command="git.push"]');
    await pushButton.click();
  }

  async pushAll(): Promise<void> {
    const pushAllButton = await this.page
      .locator(".theia-scm-main-container")
      .locator(".theia-scm-push-all-button");
    await pushAllButton.click();
  }

  getMoreActionsButton(): Locator {
    return this.page
      .locator(".theia-sidepanel-toolbar")
      .getByTitle("More Actions...");
  }
}
