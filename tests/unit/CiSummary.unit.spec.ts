import { test, expect } from "@playwright/test";
import {
  collectTests,
  escapeHtml,
  firstErrorLine,
  renderHtml,
  renderMarkdown,
  summarize,
} from "../../scripts/lib/ci-summary.mjs";

const result = (status: string, duration = 1000, message?: string) => ({
  status,
  duration,
  attachments: [],
  ...(message ? { error: { message } } : {}),
});

const report = {
  stats: { duration: 90_000 },
  suites: [
    {
      file: "ide/Editor.functional.spec.ts",
      specs: [],
      suites: [
        {
          file: "ide/Editor.functional.spec.ts",
          specs: [
            {
              title: "passes",
              file: "ide/Editor.functional.spec.ts",
              tests: [
                {
                  projectName: "functional",
                  status: "expected",
                  results: [result("passed")],
                },
              ],
            },
            {
              title: "fails <b>loud</b> | pipe",
              file: "ide/Editor.functional.spec.ts",
              tests: [
                {
                  projectName: "functional",
                  status: "unexpected",
                  results: [
                    result(
                      "failed",
                      2000,
                      `\x1b[31mTimeout <script>alert(1)</script>${"x".repeat(400)}\x1b[39m\nsecond line`,
                    ),
                    result("failed", 2000, "again"),
                  ],
                },
              ],
            },
            {
              title: "flaky one",
              file: "ide/Editor.functional.spec.ts",
              tests: [
                {
                  projectName: "functional",
                  status: "flaky",
                  results: [
                    result("failed", 500, "first try"),
                    result("passed", 500),
                  ],
                },
              ],
            },
            {
              title: "recovered one",
              file: "ide/Editor.functional.spec.ts",
              tests: [
                {
                  projectName: "functional",
                  status: "expected",
                  annotations: [
                    {
                      type: "recovered",
                      description:
                        "recovered: file creation lost on first attempt (c-standalone, <f>)",
                    },
                  ],
                  results: [result("passed")],
                },
              ],
            },
            {
              title: "never started",
              file: "ide/Editor.functional.spec.ts",
              tests: [
                { projectName: "functional", status: "skipped", results: [] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

test("collectTests tells failed, flaky, passed and did-not-run apart", () => {
  const tests = collectTests(report);
  expect(tests.map((t: { outcome: string }) => t.outcome)).toEqual([
    "expected",
    "unexpected",
    "flaky",
    "expected",
    "notrun",
  ]);
  expect(tests[1].attempts).toBe(2);
});

test("summary counts and verdict", () => {
  const s = summarize({ report, environment: "e2e.example" });
  expect(s.counts).toEqual({
    passed: 2,
    failed: 1,
    flaky: 1,
    skipped: 0,
    notRun: 1,
  });
  expect(s.green).toBe(false);
  expect(summarize({ report: undefined }).noResults).toBe(true);
});

test("error text loses colour codes and is cut to one short line", () => {
  const line = firstErrorLine({
    error: { message: `\x1b[31m${"y".repeat(500)}\x1b[39m\nnext` },
  });
  expect(line).not.toContain("\x1b");
  expect(line.length).toBeLessThanOrEqual(200);
  expect(line.endsWith("...")).toBe(true);
});

test("markdown keeps table cells intact", () => {
  const md = renderMarkdown(summarize({ report }));
  expect(md).toContain("### Failed");
  expect(md).toContain("fails <b>loud</b> \\| pipe");
  expect(md).not.toContain("second line");
});

test("markdown escapes backslashes before pipes", () => {
  const md = renderMarkdown(
    summarize({
      report: {
        stats: { duration: 1000 },
        suites: [
          {
            file: "a.spec.ts",
            specs: [
              {
                title: "path a\\|b",
                file: "a.spec.ts",
                tests: [
                  {
                    projectName: "functional",
                    status: "unexpected",
                    results: [result("failed", 1000, "boom")],
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );
  expect(md).toContain("path a\\\\\\|b");
});

test("html escapes test titles and error text", () => {
  const html = renderHtml(summarize({ report }), () => []);
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("fails &lt;b&gt;loud&lt;/b&gt;");
  expect(escapeHtml('"&<>')).toBe("&quot;&amp;&lt;&gt;");
});

test("recovered steps are listed and escaped", () => {
  const s = summarize({ report });
  expect(s.recovered).toHaveLength(1);
  expect(renderMarkdown(s)).toContain("### Recovered");
  const html = renderHtml(s, () => []);
  expect(html).toContain("Recovered");
  expect(html).not.toContain("<f>");
  expect(html).toContain("&lt;f&gt;");
});
