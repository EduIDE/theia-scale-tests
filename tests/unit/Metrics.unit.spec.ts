import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  METRICS_DIR,
  metricFileName,
  recordMetric,
} from "../../fixtures/utils/metrics";
import { chooseStateTemplate } from "../../fixtures/utils/catalog";
import {
  activeSessions,
  ApiError,
  decodeJwt,
  ignoreNotFound,
  matchByVariant,
  parseConfig,
  pkcePair,
  SessionInfo,
  Template,
  tileIndex,
  tokenExpiresSoon,
  unavailableReason,
  workspacesToReset,
} from "../../fixtures/utils/service";
import { createHash } from "crypto";

test("metric file names are filesystem safe", () => {
  expect(
    metricFileName({
      name: "launch",
      app: "java-17-standalone",
      template: "maven",
    }),
  ).toBe("launch-java-17-standalone-maven.json");
  expect(metricFileName({ name: "a/b c" })).toBe("a_b_c.json");
});

test("recordMetric writes one JSON with the documented shape", () => {
  const annotations: { type: string; description?: string }[] = [];
  const name = `unit-${Date.now()}`;
  recordMetric({ annotations } as never, {
    name,
    app: "x",
    template: "y",
    ms: 12.6,
  });
  const file = path.join(
    METRICS_DIR,
    metricFileName({ name, app: "x", template: "y" }),
  );
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.rmSync(file);
  expect(json).toMatchObject({ name, app: "x", template: "y", ms: 13 });
  expect(json.timestamp).toBeTruthy();
  expect(annotations[0].type).toBe("metric");
});

test("decodeJwt reads the payload", () => {
  const payload = Buffer.from(JSON.stringify({ email: "a@b.c" })).toString(
    "base64url",
  );
  expect(decodeJwt(`h.${payload}.s`).email).toBe("a@b.c");
});

test("pkce challenge is the S256 hash of the verifier", () => {
  const { verifier, challenge } = pkcePair();
  expect(challenge).toBe(
    createHash("sha256").update(verifier).digest("base64url"),
  );
});

const template = (
  name: string,
  listed: boolean,
  variants?: { id: string; name: string }[],
): Template => ({
  name,
  displayName: "Java 17",
  listed,
  defaultPersistence: "volume",
  injectableKeys: ["TEMPLATE"],
  variants,
});
const templates = [
  template("java-17", false),
  template("java-17-standalone", true, [
    { id: "maven", name: "Maven" },
    { id: "gradle", name: "Gradle" },
  ]),
  template("go-standalone", true),
];

test("matchByVariant finds exactly one variant, never a sibling", () => {
  const items = [
    { name: "a", template: "java-17-standalone", display: { title: "Maven" } },
    { name: "b", template: "java-17-standalone", display: { title: "Gradle" } },
    { name: "c", template: "go-standalone" },
    { name: "d", template: "java-17", display: { title: "Maven" } },
  ];
  const names = (app: string, id: string) =>
    matchByVariant(items, { app, template: id }, templates).map((i) => i.name);
  expect(names("java-17-standalone", "maven")).toEqual(["a"]);
  expect(names("java-17-standalone", "gradle")).toEqual(["b"]);
  // Without variant metadata the template alone decides.
  expect(names("go-standalone", "go")).toEqual(["c"]);
  expect(names("rust-standalone", "cargo")).toEqual([]);
});

test("tileIndex counts listed templates only, in API order", () => {
  expect(tileIndex(templates, "java-17-standalone")).toBe(0);
  expect(tileIndex(templates, "go-standalone")).toBe(1);
  expect(tileIndex(templates, "java-17")).toBe(-1);
  expect(tileIndex(templates, "missing")).toBe(-1);
});

test("unavailableReason skips a missing template and fails a catalog bug", () => {
  const catalog = [
    { app: "java-17-standalone", template: "maven" },
    { app: "java-17-standalone", template: "gradle" },
    { app: "go-standalone", template: "go" },
    { app: "go-standalone", template: "other" },
    { app: "java-17", template: "maven" },
  ];
  const reason = (app: string, id: string) =>
    unavailableReason(templates, { app, template: id }, catalog);
  expect(reason("java-17-standalone", "gradle")).toBeUndefined();
  // The template exists but not the variant: a bug of the catalog, no skip.
  expect(() => reason("java-17-standalone", "bazel")).toThrow(/bazel/);
  expect(reason("java-17", "maven")).toContain("no tile");
  expect(reason("rust-standalone", "cargo")).toContain("not offered");
  // Without variant metadata only the first spec of the template is available.
  expect(reason("go-standalone", "go")).toBeUndefined();
  expect(reason("go-standalone", "other")).toContain("only go");
});

test("activeSessions leaves out Failed sessions", () => {
  const s = (name: string, phase: SessionInfo["phase"]) => ({
    name,
    template: "x",
    phase,
  });
  expect(
    activeSessions([s("a", "Failed"), s("b", "Ready"), s("c", "Pending")]).map(
      (i) => i.name,
    ),
  ).toEqual(["b", "c"]);
});

test("a variant the template does not list matches nothing", () => {
  const items = [
    { template: "java-17-standalone", display: { title: "Maven" } },
    { template: "java-17-standalone" },
  ];
  const none = { app: "java-17-standalone", template: "" };
  expect(matchByVariant(items, none, templates)).toEqual([]);
});

test("workspacesToReset follows the session, then the title, and says when it cannot match", () => {
  const ws = (name: string, title?: string) => ({
    name,
    template: "java-17-standalone",
    display: title ? { title } : undefined,
  });
  const spec = { app: "java-17-standalone", template: "gradle" };
  const workspaces = [ws("w-1", "Maven"), ws("w-2", "Gradle"), ws("w-3")];
  const session = {
    name: "s",
    template: "java-17-standalone",
    phase: "Ready" as const,
    workspace: "w-3",
    display: { title: "Gradle" },
  };
  const names = (r: ReturnType<typeof workspacesToReset>) =>
    r.matched.map((w) => w.name);
  expect(
    names(workspacesToReset(workspaces, [session], spec, templates)),
  ).toEqual(["w-3"]);
  const byTitle = workspacesToReset(workspaces, [], spec, templates);
  expect(names(byTitle)).toEqual(["w-2"]);
  expect(byTitle.clean).toBe(true);
  // Workspaces of the template exist, but none carries the variant's title.
  const unmatched = workspacesToReset([ws("w-3")], [], spec, templates);
  expect(unmatched.matched).toEqual([]);
  expect(unmatched.clean).toBe(false);
  expect(workspacesToReset([], [], spec, templates).clean).toBe(true);
});

test("ignoreNotFound swallows a 404 and nothing else", async () => {
  await ignoreNotFound(Promise.reject(new ApiError("gone", 404)));
  await expect(
    ignoreNotFound(Promise.reject(new ApiError("down", 500))),
  ).rejects.toThrow("down");
  await expect(ignoreNotFound(Promise.reject(new Error("x")))).rejects.toThrow(
    "x",
  );
});

test("chooseStateTemplate prefers a saved Java template and never a base one", () => {
  const t = (name: string, volume: boolean): Template => ({
    ...template(name, true),
    defaultPersistence: volume ? "volume" : "none",
  });
  expect(
    chooseStateTemplate([
      t("go-standalone", true),
      t("java-17-standalone", true),
      t("java-25-standalone", true),
    ]).app,
  ).toBe("java-25-standalone");
  expect(
    chooseStateTemplate([
      t("go-standalone", true),
      t("java-25-standalone", false),
    ]).app,
  ).toBe("go-standalone");
  expect(chooseStateTemplate([t("java-25-standalone", false)]).app).toBe(
    "java-25-standalone",
  );
  // Only the base template is offered: nothing fits.
  expect(() => chooseStateTemplate([t("java-17-standalone", true)])).toThrow();
});

test("parseConfig keeps what the suite needs and rejects the rest", () => {
  const keycloak = { url: "https://k/", realm: "tum", clientId: "eduide" };
  expect(parseConfig({ apiBaseUrl: "/api/v1", keycloak, title: "x" })).toEqual({
    apiBaseUrl: "/api/v1",
    keycloak,
  });
  expect(() => parseConfig({ apiBaseUrl: "/api/v1" })).toThrow(/keycloak/);
  // The old Theia Cloud config.js shape is not an EduIDE 3.0 config.
  expect(() => parseConfig({ serviceUrl: "https://x", keycloak })).toThrow();
});

test("tokenExpiresSoon looks at the exp claim", () => {
  const jwt = (exp: number) =>
    `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
  const now = 1_000_000_000_000;
  expect(tokenExpiresSoon(jwt(now / 1000 + 30), 60, now)).toBe(true);
  expect(tokenExpiresSoon(jwt(now / 1000 + 300), 60, now)).toBe(false);
});
