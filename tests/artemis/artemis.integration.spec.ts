import { test, expect } from "../../fixtures/theia.fixture";
import { ExercisePage } from "../../pages/artemis/ExercisePage";
import { IDEPage } from "../../pages/ide/IDEPage";
import { TheiaApp } from "../../pages/ide/theia-pom/theia-app";
import { TheiaWorkspace } from "../../pages/ide/theia-pom/theia-workspace";
import { TheiaExplorerView } from "../../pages/ide/theia-pom/theia-explorer-view";
import { TheiaTextEditor } from "../../pages/ide/theia-pom/theia-text-editor";
import { deleteAll, pasteFromString } from "../../fixtures/utils/commands";
import { readFileSync } from "fs";
import path from "path";
import { TheiaVSCView } from "../../pages/ide/custom-pom/theia-vsc";
import {
  PreferenceIds,
  TheiaPreferenceView,
} from "../../pages/ide/theia-pom/theia-preference-view";

/* eslint-disable  @typescript-eslint/no-explicit-any */
test.describe("Theia Artemis Integration - No Scorpio", () => {
  test.describe.configure({ mode: "serial" });

  test.use({
    permissions: ["clipboard-write", "clipboard-read"],
  });

  let course: any;
  let exercise: any;
  let theiaURL: string;
  let courseRepositoryName: string;

  const bubbleSortTemplatePath = path.resolve(
    __dirname,
    "../../fixtures/utils/templates/exercise_solutions/BubbleSort.txt",
  );
  const bubbleSortTemplate = readFileSync(bubbleSortTemplatePath, "utf8");
  const mergeSortTemplatePath = path.resolve(
    __dirname,
    "../../fixtures/utils/templates/exercise_solutions/MergeSort.txt",
  );
  const mergeSortTemplate = readFileSync(mergeSortTemplatePath, "utf8");
  /*
  const sortStrategyTemplatePath = path.resolve(
    __dirname,
    "../../fixtures/utils/templates/exercise_solutions/SortStrategy.txt",
  );
  const sortStrategyTemplate = readFileSync(sortStrategyTemplatePath, "utf8");
  */

  test.beforeAll(async ({ artemis }) => {
    await artemis.login(process.env.ARTEMIS_USER!, process.env.ARTEMIS_PWD!);
    course = await artemis.createSimpleCourse();
    exercise = await artemis.createTheiaEnabledExercise(course);
    courseRepositoryName =
      course.shortName + exercise.shortName + "-" + process.env.ARTEMIS_USER!;
  });

  test.beforeAll("Theia IDE loads from Artemis", async ({ artemis }) => {
    test.slow();
    await artemis.login(process.env.ARTEMIS_USER!, process.env.ARTEMIS_PWD!);
    await artemis.page.goto(
      artemis.baseURL + `/courses/${course.id}/exercises/${exercise.id}`,
    );
    const exercisePage = new ExercisePage(artemis.page, exercise.id);
    await exercisePage.startParticipation();
    await exercisePage.page.waitForTimeout(3000);
    const [redirect] = await Promise.all([
      artemis.page.context().waitForEvent("page"),
      exercisePage.openInOnlineIDE(),
    ]);
    await redirect.waitForURL(/.*#\/home\/project/); //signalizes that theia session is loading

    //Setup theiaPage for sequential tests
    const workspace = new TheiaWorkspace();
    workspace.setPath("/home/project");
    const theiaApp = new TheiaApp(redirect, workspace, false);
    const theiaPage = new IDEPage(redirect, theiaApp, redirect.url());
    theiaURL = redirect.url();
    await theiaPage.waitForReady();
  });

  test.beforeEach(async ({ artemisTheia }) => {
    console.log("theiaURL", theiaURL);
    artemisTheia.page.goto(theiaURL);
    await artemisTheia.waitForReady();
    await artemisTheia.directAuthenticateScorpio();
  });

  test("Creation of course and exercise is possible", async () => {
    expect(course).toBeDefined();
    expect(exercise).toBeDefined();
  });

  test("Repository is cloned", async ({ artemisTheia }) => {
    await artemisTheia.directAuthenticateScorpio();
    const explorer = await artemisTheia.theiaApp.openView(TheiaExplorerView);
    const directoryNode =
      await explorer.existsDirectoryNode(courseRepositoryName);
    expect(directoryNode).toBe(true);
  });

  test("Student submits code", async ({ artemisTheia }) => {
    const preferences =
      await artemisTheia.theiaApp.openView(TheiaPreferenceView);
    const preferenceId = PreferenceIds.Explorer.CompactFolder;
    await preferences.setBooleanPreferenceById(preferenceId, false);
    await preferences.waitForModified(preferenceId);
    const autoSaveDelay = PreferenceIds.Files.AutoSaveDelay;
    await preferences.setStringPreferenceById(autoSaveDelay, "0");
    await preferences.waitForModified(autoSaveDelay);
    await writeIntoFile(
      "BubbleSort.java",
      bubbleSortTemplate,
      courseRepositoryName,
      artemisTheia,
    );
    await writeIntoFile(
      "MergeSort.java",
      mergeSortTemplate,
      courseRepositoryName,
      artemisTheia,
    );
    //await artemisTheia.createNewFile(`${courseRepositoryName}/src/de/test/SortStrategy.java`);
    //await writeIntoFile("SortStrategy.java", sortStrategyTemplate, courseRepositoryName, artemisTheia);
    const VSC = await artemisTheia.theiaApp.openView(TheiaVSCView);
    await VSC.commitAllandPush("Initial commit from Theia");
  });

  test("check result on Artemis", async ({ artemis }) => {
    await artemis.login(process.env.ARTEMIS_USER!, process.env.ARTEMIS_PWD!);
    await artemis.page.goto(
      artemis.baseURL + `/courses/${course.id}/exercises/${exercise.id}`,
    );
    const exercisePage = new ExercisePage(artemis.page, exercise.id);
    await exercisePage.checkResultScore("15.4%");
  });

  test.afterAll(async ({ artemis }) => {
    await artemis.login(process.env.ARTEMIS_USER!, process.env.ARTEMIS_PWD!);
    await artemis.deleteCourse(course.id);
  });
});

async function writeIntoFile(
  fileName: string,
  content: string,
  courseRepositoryName: string,
  artemisTheia: IDEPage,
) {
  let editor: TheiaTextEditor | undefined;
  const maxRetries = 3;
  const timeout = 10000; // 10 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      editor = await Promise.race([
        artemisTheia.theiaApp.openEditor(
          `${courseRepositoryName}/src/test/${fileName}`,
          TheiaTextEditor,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Timeout opening editor")),
            timeout,
          ),
        ),
      ]);
      break;
    } catch (error) {
      console.log(
        `Attempt ${attempt}/${maxRetries} to open editor failed:`,
        error,
      );
      if (attempt === maxRetries) {
        throw new Error(
          `Failed to open editor after ${maxRetries} attempts: ${error}`,
        );
      }
      await artemisTheia.page.waitForTimeout(1000); // Wait 1 second before retry
    }
  }

  if (!editor) {
    throw new Error("Editor is undefined after retries");
  }

  await editor.activate();
  await editor.focus();
  await deleteAll(editor.page);
  await editor.activate();
  await editor.focus();
  await pasteFromString(editor.page, content);
  await editor.save();
}
