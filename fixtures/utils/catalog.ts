/**
 * The apps and templates of EduIDE 3.0 as the landing page offers them.
 * Commands and expected output come from the template sources in
 * EduIDE/images/<lang>/templates/<template>/.vscode/tasks.json.
 */
export interface Task {
  label: string;
  command: string;
  /** Text the output must contain, on top of a zero exit code. */
  output?: string;
}

export interface TemplateSpec {
  app: string;
  template: string;
  /** Entries expected at the top level of the workspace. */
  files: string[];
  run?: Task;
  test?: Task;
  build?: Task;
}

const hello = "Hello, World!";

export const TEMPLATES: TemplateSpec[] = [
  {
    app: "c-standalone",
    template: "make",
    files: ["Makefile", "src"],
    run: { label: "Run", command: "make run", output: "Hello from Make + C!" },
    build: { label: "Build", command: "make build" },
  },
  {
    app: "c-standalone",
    template: "bazel",
    files: ["BUILD.bazel", "MODULE.bazel", "src"],
    run: {
      label: "Run",
      command: "bazel run //:app",
      output: "Hello from Bazel + C!",
    },
  },
  {
    app: "go-standalone",
    template: "go",
    files: ["go.mod", "main.go", "main_test.go"],
    run: { label: "Run", command: "go run .", output: hello },
    test: { label: "Test", command: "go test ./..." },
  },
  {
    app: "java-17-standalone",
    template: "maven",
    files: ["pom.xml", "src"],
    run: {
      label: "Run",
      command: "mvn compile exec:java -Dexec.mainClass=com.example.App",
      output: hello,
    },
    test: { label: "Test", command: "mvn test" },
  },
  {
    app: "java-17-standalone",
    template: "gradle",
    files: ["build.gradle", "gradlew", "src"],
    run: { label: "Run", command: "./gradlew run", output: hello },
    test: { label: "Test", command: "./gradlew test" },
  },
  {
    app: "java-25-standalone",
    template: "maven",
    files: ["pom.xml", "src"],
    run: {
      label: "Run",
      command: "mvn compile exec:java -Dexec.mainClass=com.example.App",
      output: hello,
    },
    test: { label: "Test", command: "mvn test" },
  },
  {
    app: "java-25-standalone",
    template: "gradle",
    files: ["build.gradle", "gradlew", "src"],
    run: { label: "Run", command: "./gradlew run", output: hello },
    test: { label: "Test", command: "./gradlew test" },
  },
  {
    app: "javascript-standalone",
    template: "node",
    files: ["package.json", "tsconfig.json", "src", "test"],
    run: { label: "Run", command: "tsx src/index.ts", output: hello },
    test: { label: "Test", command: 'tsx --test "test/**/*.test.ts"' },
  },
  {
    app: "javascript-standalone",
    template: "web",
    files: ["index.html", "style.css", "src", "tsconfig.json"],
    // Start is a watcher that never exits, so only Build is run.
    build: { label: "Build", command: "tsc" },
  },
  {
    app: "python-standalone",
    template: "python",
    files: ["pyproject.toml", "src", "tests"],
    run: { label: "Run", command: "PYTHONPATH=src python -m example.main", output: hello },
    test: { label: "Test", command: "pytest" },
  },
  {
    app: "rust-standalone",
    template: "cargo",
    files: ["Cargo.toml", "src"],
    run: { label: "Run", command: "cargo run", output: hello },
    test: { label: "Test", command: "cargo test" },
  },
];

/**
 * One template per app stays launched for the whole run, because the editor,
 * search, terminal, source control and language specs work inside it. Keeping
 * this set small keeps the run under the per-user session limit.
 */
export const BASE_TEMPLATES: Record<string, TemplateSpec> = {
  c: find("c-standalone", "make"),
  java: find("java-17-standalone", "maven"),
  python: find("python-standalone", "python"),
  rust: find("rust-standalone", "cargo"),
  javascript: find("javascript-standalone", "node"),
};

/** Its session is restarted and its experience level changed, so nothing else may use it. */
export const STATE_TEMPLATE = find("go-standalone", "go");

export const EXTRA_TEMPLATES = TEMPLATES.filter(
  (t) => !Object.values(BASE_TEMPLATES).includes(t) && t !== STATE_TEMPLATE,
);

function find(app: string, template: string): TemplateSpec {
  const spec = TEMPLATES.find((t) => t.app === app && t.template === template);
  if (!spec) throw new Error(`Unknown template ${app}/${template}`);
  return spec;
}

export function urlFileName(spec: TemplateSpec): string {
  return `ide-url-${spec.app}-${spec.template}.txt`;
}
