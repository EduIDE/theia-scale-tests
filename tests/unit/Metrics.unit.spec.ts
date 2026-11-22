import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  METRICS_DIR,
  metricFileName,
  recordMetric,
} from "../../fixtures/utils/metrics";
import {
  decodeJwt,
  matchByVariant,
  parseConfig,
  pkcePair,
  Template,
  tileIndex,
  tokenExpiresSoon,
  unavailableReason,
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

test("unavailableReason names why a spec cannot run", () => {
  const reason = (app: string, id: string) =>
    unavailableReason(templates, { app, template: id });
  expect(reason("java-17-standalone", "gradle")).toBeUndefined();
  expect(reason("go-standalone", "go")).toBeUndefined();
  expect(reason("java-17-standalone", "bazel")).toContain("bazel");
  expect(reason("java-17", "maven")).toContain("no tile");
  expect(reason("rust-standalone", "cargo")).toContain("not offered");
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
