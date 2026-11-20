import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quantile,
  summarize,
  isRouted,
  parseWatchLine,
  Milestones,
  routeAccepted,
  pulledIdeImage,
} from "./lib.mjs";

test("quantile interpolates between neighbours", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([10], 0.9), 10);
  assert.ok(Number.isNaN(quantile([], 0.5)));
});

test("summarize ignores missing values", () => {
  const s = summarize([3, undefined, 1, NaN, 2]);
  assert.equal(s.n, 3);
  assert.equal(s.median, 2);
  assert.equal(s.min, 1);
  assert.equal(s.max, 3);
  assert.equal(s.sd, 1);
  assert.deepEqual(summarize([]), { n: 0 });
});

test("isRouted compares with the response of a path without a session", () => {
  const baseline = {
    status: 302,
    location: "https://test2.example/session-ended",
  };
  assert.equal(
    isRouted(
      { status: 302, location: "https://test2.example/session-ended" },
      baseline,
    ),
    false,
  );
  assert.equal(isRouted({ status: 503 }, baseline), false);
  assert.equal(isRouted({ status: 0 }, baseline), false);
  assert.equal(
    isRouted(
      { status: 302, location: "https://keycloak.example/auth?x=1" },
      baseline,
    ),
    true,
  );
  assert.equal(isRouted({ status: 401 }, baseline), true);
  assert.equal(isRouted({ status: 404 }, { status: 404 }), false);
});

test("parseWatchLine splits fields and parses JSON ones", () => {
  const fields = [
    { name: "name" },
    { name: "node" },
    { name: "labels", json: true },
  ];
  assert.deepEqual(parseWatchLine('p1||{"a":"b"}', fields), {
    name: "p1",
    node: null,
    labels: { a: "b" },
  });
  assert.deepEqual(parseWatchLine("p1|n1|not json", fields), {
    name: "p1",
    node: "n1",
    labels: null,
  });
});

test("Milestones keeps the first time", () => {
  const m = new Milestones(1000);
  m.mark("a", 1500);
  m.mark("a", 2500);
  assert.deepEqual(m.ms, { a: 500 });
});

test("routeAccepted needs the session path and accepted parents", () => {
  const cond = (status) => [
    { type: "Accepted", status },
    { type: "ResolvedRefs", status: "True" },
  ];
  const route = (path, status) => ({
    spec: {
      rules: [{ matches: [{ path: { type: "PathPrefix", value: path } }] }],
    },
    status: { parents: status ? [{ conditions: cond(status) }] : [] },
  });
  assert.equal(routeAccepted(route("/abc/", "True"), "/abc"), true);
  assert.equal(
    routeAccepted(route("/bench-java-17-1", "True"), "/bench-java-17-1/"),
    true,
  );
  assert.equal(routeAccepted(route("/abc/", "False"), "/abc/"), false);
  assert.equal(routeAccepted(route("/abc/", null), "/abc/"), false);
  assert.equal(routeAccepted(route("/other/", "True"), "/abc/"), false);
  const shared = route("/abc/", "False");
  shared.status.parents.push({ conditions: cond("True") });
  assert.equal(routeAccepted(shared, "/abc/"), true);
});

test("pulledIdeImage ignores pulls of sidecar images", () => {
  const ide = "ghcr.io/eduide/eduide/java-17-standalone";
  const sidecar =
    'Pulling Pulling image "quay.io/oauth2-proxy/oauth2-proxy:v7.12.0"\nPulled Container image "x" already present';
  assert.equal(pulledIdeImage(sidecar, ide), false);
  assert.equal(
    pulledIdeImage(`Pulling Pulling image "${ide}@sha256:abc"`, ide),
    true,
  );
  assert.equal(pulledIdeImage("", ide), false);
});
