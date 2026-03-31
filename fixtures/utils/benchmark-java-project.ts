import path from "path";

import { debugLog } from "./debug-logging";
import { TheiaApp } from "../../pages/ide/theia-pom/theia-app";
import { TheiaTerminal } from "../../pages/ide/theia-pom/theia-terminal";

export async function ensureMinimalJavaProjectViaTerminal(
  theiaApp: TheiaApp,
  terminal: TheiaTerminal,
  debugStepDelayMs = 0,
): Promise<void> {
  const projectName = "benchmark-workspace";
  const projectFile = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<projectDescription>",
    `  <name>${projectName}</name>`,
    "  <comment></comment>",
    "  <projects></projects>",
    "  <buildSpec>",
    "    <buildCommand>",
    "      <name>org.eclipse.jdt.core.javabuilder</name>",
    "      <arguments></arguments>",
    "    </buildCommand>",
    "  </buildSpec>",
    "  <natures>",
    "    <nature>org.eclipse.jdt.core.javanature</nature>",
    "  </natures>",
    "</projectDescription>",
  ].join("\n");
  const classpathFile = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<classpath>",
    '  <classpathentry kind="src" path="src"/>',
    '  <classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/>',
    '  <classpathentry kind="output" path="bin"/>',
    "</classpath>",
  ].join("\n");
  const jdtPrefsFile = [
    "eclipse.preferences.version=1",
    "org.eclipse.jdt.core.compiler.codegen.targetPlatform=17",
    "org.eclipse.jdt.core.compiler.compliance=17",
    "org.eclipse.jdt.core.compiler.source=17",
  ].join("\n");

  debugLog("benchmark", "java project setup: mkdir start");
  await terminal.submit("mkdir -p src/de src/bench bin .settings");
  debugLog("benchmark", "java project setup: mkdir done");
  await debugStepPause(theiaApp, debugStepDelayMs, "java project directories created");

  await writeTerminalFile(
    theiaApp,
    terminal,
    ".project",
    projectFile,
    debugStepDelayMs,
    "java project .project",
  );
  await writeTerminalFile(
    theiaApp,
    terminal,
    ".classpath",
    classpathFile,
    debugStepDelayMs,
    "java project .classpath",
  );
  await writeTerminalFile(
    theiaApp,
    terminal,
    ".settings/org.eclipse.jdt.core.prefs",
    jdtPrefsFile,
    debugStepDelayMs,
    "java project prefs",
  );
}

async function writeTerminalFile(
  theiaApp: TheiaApp,
  terminal: TheiaTerminal,
  filePath: string,
  content: string,
  debugStepDelayMs = 0,
  label = "terminal file write",
): Promise<void> {
  const dirPath = path.dirname(filePath);
  if (dirPath && dirPath !== ".") {
    debugLog("benchmark", `${label}: mkdir start`, { dirPath, filePath });
    await terminal.submit(`mkdir -p ${shellQuote(dirPath)}`);
    debugLog("benchmark", `${label}: mkdir done`, { dirPath, filePath });
    await debugStepPause(theiaApp, debugStepDelayMs, `${label} mkdir done`);
  }

  debugLog("benchmark", `${label}: truncate start`, { filePath });
  await terminal.submit(`: > ${shellQuote(filePath)}`);
  debugLog("benchmark", `${label}: truncate done`, { filePath });
  await debugStepPause(theiaApp, debugStepDelayMs, `${label} truncate done`);

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    debugLog("benchmark", `${label}: append line start`, {
      filePath,
      lineNumber: index + 1,
      preview: line.slice(0, 80),
    });
    await terminal.submit(`printf '%s\\n' ${shellQuote(line)} >> ${shellQuote(filePath)}`);
    debugLog("benchmark", `${label}: append line done`, {
      filePath,
      lineNumber: index + 1,
    });
    await debugStepPause(theiaApp, debugStepDelayMs, `${label} append line ${index + 1} done`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function debugStepPause(
  theiaApp: TheiaApp,
  delayMs: number,
  label: string,
): Promise<void> {
  if (delayMs <= 0) {
    return;
  }
  debugLog("benchmark", "debug step pause start", { label, delayMs });
  await theiaApp.page.waitForTimeout(delayMs);
  debugLog("benchmark", "debug step pause done", { label, delayMs });
}
