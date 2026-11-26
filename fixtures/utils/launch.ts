import { Browser, expect, Page, TestInfo } from "@playwright/test";
import { LandingPage } from "../../pages/landing/LandingPage";
import { IDEPage } from "../../pages/ide/IDEPage";
import { TheiaApp } from "../../pages/ide/theia-pom/theia-app";
import { TheiaTerminal } from "../../pages/ide/theia-pom/theia-terminal";
import { TheiaWorkspace } from "../../pages/ide/theia-pom/theia-workspace";
import { TemplateSpec, Task } from "./catalog";
import type { CloudService } from "./service";
import { SESSION_FILE } from "./auth-files";
import { recordMetric } from "./metrics";

export interface LaunchedIde {
  page: Page;
  ide: IDEPage;
  url: string;
  /** Tile click until the IDE shell is initialized. */
  launchMs: number;
}

/**
 * Launches a template and variant from the landing page and waits until the
 * IDE is usable. The caller owns the returned page.
 */
export async function launchIde(
  browser: Browser,
  service: CloudService,
  spec: Pick<TemplateSpec, "app" | "template">,
  testInfo?: TestInfo,
  metricName = "launch",
): Promise<LaunchedIde> {
  const context = await browser.newContext({
    storageState: SESSION_FILE,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  // Cold image pulls make the IDE load slower than a normal action.
  context.setDefaultTimeout(3 * 60_000);
  const page = await context.newPage();
  await page.goto("/");
  const landing = new LandingPage(page);
  await landing.waitForLoggedIn();
  const templates = await service.listTemplates();
  const start = Date.now();
  await landing.launch(spec, templates);
  await landing.waitForIdeUrl();
  const url = page.url();
  const workspace = new TheiaWorkspace();
  workspace.setPath("/home/project");
  const theiaApp = new TheiaApp(page, workspace, false);
  await theiaApp.waitForShellAndInitialized();
  const launchMs = Date.now() - start;
  recordMetric(testInfo, { name: metricName, ...spec, ms: launchMs });
  return { page, ide: new IDEPage(page, theiaApp, url), url, launchMs };
}

let counter = 0;

/**
 * Runs a shell command in the terminal and waits for it to finish. The exit
 * code is echoed behind a marker, because a terminal has no other way to say
 * that a command is done. Returns what the terminal shows.
 */
export async function runInTerminal(
  terminal: TheiaTerminal,
  command: string,
  timeoutMs = 5 * 60_000,
): Promise<{ output: string; exitCode: number }> {
  const marker = `DONE${Date.now()}x${counter++}`;
  await terminal.submit(`${command}; echo "${marker}:$?"`);
  let output = "";
  await expect
    .poll(
      async () => {
        output = await terminal.contents();
        return new RegExp(`${marker}:\\d+`).test(output);
      },
      { timeout: timeoutMs, intervals: [3000] },
    )
    .toBe(true);
  const exitCode = Number(new RegExp(`${marker}:(\\d+)`).exec(output)![1]);
  return { output, exitCode };
}

/** Waits until the template is copied in, then lists the workspace. */
export async function expectTemplateFiles(
  terminal: TheiaTerminal,
  files: string[],
) {
  const probe = files.map((f) => `[ -e "${f}" ]`).join(" && ");
  const { output } = await runInTerminal(
    terminal,
    `for i in $(seq 120); do ${probe} && break; sleep 1; done; ls -A`,
    3 * 60_000,
  );
  for (const f of files) expect(output).toContain(f);
}

/** Runs a template task's command and checks exit code and printed output. */
export async function expectTask(
  terminal: TheiaTerminal,
  task: Task,
  testInfo: TestInfo,
  spec: Pick<TemplateSpec, "app" | "template">,
) {
  let start = Date.now();
  let { output, exitCode } = await runInTerminal(terminal, task.command);
  if (exitCode !== 0) {
    // Build tools fetch from remote repositories, which fails now and then.
    // The repeat is reported, not hidden: a student runs the same command.
    testInfo.annotations.push({
      type: "recovered",
      description: `recovered: ${task.label} task failed on first attempt (${spec.app} / ${spec.template}, exit ${exitCode}): ${lastLines(output, 3)}`,
    });
    start = Date.now();
    ({ output, exitCode } = await runInTerminal(terminal, task.command));
  }
  recordMetric(testInfo, {
    name: `task-${task.label.toLowerCase()}`,
    ...spec,
    ms: Date.now() - start,
  });
  expect(
    exitCode,
    `${task.command} exit code, output ends: ${lastLines(output, 8)}`,
  ).toBe(0);
  if (task.output) expect(output).toContain(task.output);
}

/** The last non-empty lines of terminal output, on one line. */
export function lastLines(output: string, n: number): string {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .join(" / ")
    .slice(0, 400);
}

/** Template files are present and every task the template defines works. */
export async function checkTemplate(
  ide: IDEPage,
  spec: TemplateSpec,
  testInfo: TestInfo,
) {
  const terminal = await ide.theiaApp.openTerminal(TheiaTerminal);
  await expectTemplateFiles(terminal, spec.files);
  for (const task of [spec.run, spec.build, spec.test]) {
    if (task) await expectTask(terminal, task, testInfo, spec);
  }
}
