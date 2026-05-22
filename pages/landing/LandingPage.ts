import { Locator, Page } from "@playwright/test";
import { debugLog } from "../../fixtures/utils/debug-logging";

/**
 * A class which encapsulates the landing page of Theia with UI selectors.
 */
export class LandingPage {
  page: Page;

  readonly languageCLocator: Locator;
  readonly languageJavaLocator: Locator;
  readonly languageJSLocator: Locator;
  readonly languageOcamlLocator: Locator;
  readonly languagePythonLocator: Locator;
  readonly languageRustLocator: Locator;

  constructor(page: Page) {
    this.page = page;
    this.languageCLocator = this.page.getByRole("button", { name: "Launch C" });
    this.languageJavaLocator = this.page.getByRole("button", {
      name: "Launch Java",
      exact: true,
    });
    this.languageJSLocator = this.page.getByRole("button", {
      name: "Launch Javascript",
    });
    this.languageOcamlLocator = this.page.getByRole("button", {
      name: "Launch Ocaml",
    });
    this.languagePythonLocator = this.page.getByRole("button", {
      name: "Launch Python",
    });
    this.languageRustLocator = this.page.getByRole("button", {
      name: "Launch Rust",
    });
  }

  async waitForReady() {
    await this.page.locator("img").waitFor();
  }

  async clickLoginButton() {
    debugLog("landing", "click login button", { testId: "loginButton" });
    return this.page.getByTestId("loginButton").click();
  }

  async login(username: string, password: string) {
    debugLog("landing", "start login", {
      hasUsername: Boolean(username),
      url: this.page.url(),
    });
    await this.clickLoginButton();
    debugLog("landing", "fill username");
    await this.page.getByRole("textbox", { name: "Username" }).fill(username);
    debugLog("landing", "fill password");
    await this.page.getByRole("textbox", { name: "Password" }).fill(password);
    debugLog("landing", "submit sign in");
    await this.page.getByRole("button", { name: "Sign in" }).click();
  }

  async logout() {
    await this.page.getByTestId("logoutButton").click();
  }

  async launchLanguage(language: string) {
    const preferredTestIds = [`launch-app-${language}`, `launch-app-${language}-latest`];
    const launchButtons = this.page.locator('[data-testid^="launch-app-"]');
    await launchButtons.first().waitFor({ state: "visible" });
    const availableLaunchIds = await launchButtons.evaluateAll((nodes) =>
        nodes
          .map((n) => n.getAttribute("data-testid"))
          .filter((v): v is string => Boolean(v)),
      );

    debugLog("landing", "try launch language", {
      language,
      preferredTestIds,
      availableLaunchIds,
      url: this.page.url(),
    });

    const foundTestId = preferredTestIds.find((id) => availableLaunchIds.includes(id));
    if (!foundTestId) {
      throw new Error(
        `No launch button found for '${language}'. Tried ${preferredTestIds.join(", ")} but available ids are: ${availableLaunchIds.join(", ")}`,
      );
    }

    const languageButton = this.page.getByTestId(foundTestId);
    debugLog("landing", "click launch language", { language, foundTestId });
    await languageButton.click();
    debugLog("landing", "launch click done", { language, foundTestId });
  }

  retrieveAllLanguageLocators() {
    return [
      this.languageCLocator,
      this.languageJavaLocator,
      this.languageJSLocator,
      this.languageOcamlLocator,
      this.languagePythonLocator,
      this.languageRustLocator,
    ];
  }

  setPage(page: Page) {
    this.page = page;
  }
}
