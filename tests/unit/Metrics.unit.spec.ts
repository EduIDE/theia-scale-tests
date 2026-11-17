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
  workspaceName,
  matchSessions,
  pkcePair,
  tokenExpiresSoon,
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

test("matchSessions finds exactly one template, never a sibling", () => {
  const user = "alice";
  const maven = workspaceName("java-17-standalone", "maven", user);
  const sessions = [
    { name: "a", appDefinition: "java-17-standalone", workspace: maven },
    {
      name: "b",
      appDefinition: "java-17-standalone",
      envVars: { TEMPLATE: "gradle" },
    },
    { name: "c", appDefinition: "go-standalone" },
  ];
  const names = (app: string, template: string) =>
    matchSessions(sessions, { app, template }, user).map((s) => s.name);
  expect(names("java-17-standalone", "maven")).toEqual(["a"]);
  expect(names("java-17-standalone", "gradle")).toEqual(["b"]);
  // No fallback to "every session of the app" for a session that says nothing.
  expect(names("go-standalone", "go")).toEqual([]);
  expect(names("rust-standalone", "cargo")).toEqual([]);
});

test("workspaceName follows the landing page", () => {
  const name = workspaceName("java-17-standalone", "maven", "Alice.Example");
  expect(name).toMatch(
    /^ws-java-17-stan-playground-alice-exampl-[0-9a-f]{8}$/,
  );
  expect(
    workspaceName("java-17-standalone", "gradle", "Alice.Example"),
  ).not.toBe(name);
});

test("tokenExpiresSoon looks at the exp claim", () => {
  const jwt = (exp: number) =>
    `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
  const now = 1_000_000_000_000;
  expect(tokenExpiresSoon(jwt(now / 1000 + 30), 60, now)).toBe(true);
  expect(tokenExpiresSoon(jwt(now / 1000 + 300), 60, now)).toBe(false);
});
