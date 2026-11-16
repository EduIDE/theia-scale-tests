import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { METRICS_DIR, metricFileName, recordMetric } from "../../fixtures/utils/metrics";
import { decodeJwt, matchSessions, pkcePair } from "../../fixtures/utils/service";
import { createHash } from "crypto";

test("metric file names are filesystem safe", () => {
  expect(
    metricFileName({ name: "launch", app: "java-17-standalone", template: "maven" }),
  ).toBe("launch-java-17-standalone-maven.json");
  expect(metricFileName({ name: "a/b c" })).toBe("a_b_c.json");
});

test("recordMetric writes one JSON with the documented shape", () => {
  const annotations: { type: string; description?: string }[] = [];
  const name = `unit-${Date.now()}`;
  recordMetric({ annotations } as never, { name, app: "x", template: "y", ms: 12.6 });
  const file = path.join(METRICS_DIR, metricFileName({ name, app: "x", template: "y" }));
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.rmSync(file);
  expect(json).toMatchObject({ name, app: "x", template: "y", ms: 13 });
  expect(json.timestamp).toBeTruthy();
  expect(annotations[0].type).toBe("metric");
});

test("decodeJwt reads the payload", () => {
  const payload = Buffer.from(JSON.stringify({ email: "a@b.c" })).toString("base64url");
  expect(decodeJwt(`h.${payload}.s`).email).toBe("a@b.c");
});

test("pkce challenge is the S256 hash of the verifier", () => {
  const { verifier, challenge } = pkcePair();
  expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
});

test("matchSessions narrows by template only when sessions say which they are", () => {
  const sessions = [
    { name: "a", appDefinition: "java-17-standalone", envVars: { TEMPLATE: "maven" } },
    { name: "b", appDefinition: "java-17-standalone", envVars: { TEMPLATE: "gradle" } },
    { name: "c", appDefinition: "go-standalone" },
  ];
  const names = (app: string, template: string) =>
    matchSessions(sessions, { app, template }).map((s) => s.name);
  expect(names("java-17-standalone", "gradle")).toEqual(["b"]);
  expect(names("go-standalone", "go")).toEqual(["c"]);
  expect(names("rust-standalone", "cargo")).toEqual([]);
});
