#!/usr/bin/env node
// IDE startup benchmark. Each run creates one session CR, records when the control plane, the pod,
// the public route and the Theia workbench are ready, deletes the session and waits for cleanup.
// Results go to a JSONL file, one line per run; report.mjs turns them into tables.
import { spawn } from "node:child_process";
import http from "node:http";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  isRouted,
  parseWatchLine,
  Milestones,
  routeAccepted,
  pulledIdeImage,
} from "./lib.mjs";

const { values: opt } = parseArgs({
  options: {
    variant: { type: "string" },
    mode: { type: "string", default: "cold" },
    runs: { type: "string", default: "1" },
    gap: { type: "string", default: "20" },
    out: { type: "string", default: "results.jsonl" },
    context: { type: "string", default: "stud" },
    chrome: { type: "string", default: process.env.CHROME_PATH },
    timeout: { type: "string", default: "300" },
  },
});

const LABEL = "app.kubernetes.io/part-of=startup-bench";
// The same IDE image runs on every variant; see setup/.
const BENCH_IMAGE = "ghcr.io/eduide/eduide/java-17-standalone";
const VARIANTS = {
  // EduIDE Cloud (Java operator, theia.cloud CRDs) on test2.
  "eduide-cloud": {
    ns: "eduide-test2",
    host: "instance.test2.eduide.student.k8s.aet.cit.tum.de",
    resource: "sessions.theia.cloud",
    publicRouteCheck: true,
    app: "bench-java-17",
    ideContainer: "bench-java-17",
    controlPlanePods: /^(operator|service|landing-page)-deployment-/,
    manifest: (name, v) => ({
      apiVersion: "theia.cloud/v1beta8",
      kind: "Session",
      metadata: {
        name,
        labels: { "app.kubernetes.io/part-of": "startup-bench" },
      },
      spec: {
        name,
        appDefinition: v.app,
        user: `${name}@startup-bench.invalid`,
        sessionSecret: randomUUID(),
      },
    }),
    url: (status) => status?.url,
    controlPlaneReady: (status) =>
      status?.operatorStatus === "HANDLED" && !!status?.url,
    failed: (status) => status?.operatorStatus === "ERROR",
    // Cold sessions get their own pod; a warm session takes pool instance N (URL path "<app>-N/").
    ownsPod: (pod, name, status, v) => {
      if (pod.labels?.["theia-cloud.io/session"] === name) return true;
      const m = status?.url?.match(new RegExp(`/${v.app}-(\\d+)/$`));
      return !!m && pod.name.startsWith(`instance-${m[1]}-${v.app}-`);
    },
    poolPod: (pod, v) =>
      pod.name.startsWith("instance-") && pod.name.includes(`-${v.app}-`),
    setPool: async (v, size) =>
      kubectl(v, [
        "patch",
        "appdefinition",
        v.app,
        "--type",
        "merge",
        "-p",
        JSON.stringify({ spec: { minInstances: size } }),
      ]),
  },
  // Go control plane (eduide.github.io CRDs) on test3.
  go: {
    ns: "eduide-test3",
    host: "instance.test3.eduide.student.k8s.aet.cit.tum.de",
    resource: "idesessions.eduide.github.io",
    // The gateway asks for a login on every path, so an anonymous request cannot tell a live session route apart.
    publicRouteCheck: false,
    app: "bench-java-17",
    ideContainer: "ide",
    controlPlanePods:
      /^eduide-(eduide-control-plane-|oidc-bridge|landing-page)/,
    manifest: (name, v) => ({
      apiVersion: "eduide.github.io/v1alpha1",
      kind: "IDESession",
      metadata: {
        name,
        labels: { "app.kubernetes.io/part-of": "startup-bench" },
      },
      spec: { owner: `${name}@startup-bench.invalid`, templateRef: v.app },
    }),
    url: (status) => status?.url,
    controlPlaneReady: (status) => status?.phase === "Ready",
    failed: (status) => status?.phase === "Failed",
    ownsPod: (pod, name, status) =>
      pod.labels?.["eduide.github.io/session"] === name ||
      (!!status?.podName && pod.name === status.podName),
    poolPod: (pod, v) =>
      pod.labels?.["eduide.github.io/template"] === v.app &&
      pod.labels?.["eduide.github.io/state"] === "idle",
    setPool: async (v, size) => {
      if (size === 0)
        return kubectl(v, ["delete", "idepool", v.app, "--ignore-not-found"]);
      const pool = {
        apiVersion: "eduide.github.io/v1alpha1",
        kind: "IDEPool",
        metadata: {
          name: v.app,
          labels: { "app.kubernetes.io/part-of": "startup-bench" },
        },
        spec: {
          templateRef: v.app,
          minIdle: size,
          targetIdle: size,
          maxInstances: 5,
        },
      };
      return kubectl(v, ["apply", "-f", "-"], JSON.stringify(pool));
    },
  },
};

// Theia Cloud upstream 1.2.0 in its own namespace on stud. It uses an nginx Ingress, the DNS name points to the
// Envoy gateway, so the route probe goes to the nginx IP. Lazy start publishes no URL in the session status;
// the path is /instances/<session uid>/ once the operator handled the session.
VARIANTS.upstream = {
  ...VARIANTS["eduide-cloud"],
  ns: "eduide-upstream",
  host: "upstream.eduide.student.k8s.aet.cit.tum.de",
  probeIp: "131.159.88.14",
  gatewayRoutes: false,
  controlPlanePods: /^(operator|service)-deployment-/,
  // Eager start writes status.url once the instance answers; lazy start only sets HANDLED.
  url: (status) =>
    status?.url ??
    (status?.operatorStatus === "HANDLED"
      ? `upstream.eduide.student.k8s.aet.cit.tum.de/instances/${status.crUid}/`
      : null),
  controlPlaneReady: (status) =>
    status?.operatorStatus === "HANDLED" || !!status?.url,
};

function kubectl(v, args, stdin) {
  return new Promise((resolve, reject) => {
    const p = spawn("kubectl", ["--context", opt.context, "-n", v.ns, ...args]);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`kubectl ${args.join(" ")}: ${err.trim()}`)),
    );
    if (stdin) p.stdin.end(stdin);
    else p.stdin.end();
  });
}

// Streams `kubectl get --watch` lines to a callback until stop() is called.
function watch(v, args, fields, onItem) {
  const tpl = fields.map((f) => `{${f.path}}`).join("|") + '{"\\n"}';
  const p = spawn("kubectl", [
    "--context",
    opt.context,
    "-n",
    v.ns,
    "get",
    ...args,
    "--watch",
    "-o",
    `jsonpath=${tpl}`,
  ]);
  let buf = "";
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) onItem(parseWatchLine(line, fields), Date.now());
    }
  });
  return { stop: () => p.kill() };
}

const POD_FIELDS = [
  { name: "name", path: ".metadata.name" },
  { name: "labels", path: ".metadata.labels", json: true },
  { name: "node", path: ".spec.nodeName" },
  { name: "phase", path: ".status.phase" },
  { name: "deleting", path: ".metadata.deletionTimestamp" },
  { name: "conditions", path: ".status.conditions", json: true },
  { name: "containers", path: ".status.containerStatuses", json: true },
];
const CR_FIELDS = [
  { name: "name", path: ".metadata.name" },
  { name: "uid", path: ".metadata.uid" },
  { name: "status", path: ".status", json: true },
];

const condTrue = (pod, type) =>
  (pod.conditions ?? []).some((c) => c.type === type && c.status === "True");
const containerRunning = (pod, name) =>
  (pod.containers ?? []).some((c) => c.name === name && c.state?.running);

async function routeProbe(url, v) {
  if (v.probeIp) return probeViaIp(url, v);
  try {
    const r = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    return { status: r.status, location: r.headers.get("location") };
  } catch {
    return { status: 0 };
  }
}

// Sends the request to a fixed IP with the session host as Host header, for hosts whose DNS points elsewhere.
function probeViaIp(url, v) {
  const { pathname } = new URL(url);
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: v.probeIp,
        path: pathname,
        headers: { host: v.host },
        timeout: 5000,
      },
      (res) => {
        res.resume();
        resolve({
          status: res.statusCode,
          location: res.headers.location ?? null,
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve({ status: 0 }));
  });
}

async function portForward(v, pod) {
  const p = spawn("kubectl", [
    "--context",
    opt.context,
    "-n",
    v.ns,
    "port-forward",
    `pod/${pod}`,
    ":3000",
  ]);
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      p.kill();
      reject(new Error("port-forward timeout"));
    }, 15000);
    p.stdout.on("data", (d) => {
      const m = String(d).match(/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(t);
        resolve(Number(m[1]));
      }
    });
    p.on("close", () => reject(new Error("port-forward exited")));
  });
  // kubectl port-forward exits on the first refused connection, which happens while Theia is still starting.
  let alive = true;
  p.on("close", () => (alive = false));
  return { port, alive: () => alive, stop: () => p.kill() };
}

// Port-forwards the IDE pod and loads the workbench: Theia answers HTTP, the shell renders, the Explorer shows the tree.
async function loadWorkbench(v, podName, m, deadline, browser) {
  let pf;
  const connect = async () => {
    pf?.stop();
    pf = null;
    while (!pf && Date.now() < deadline)
      pf = await portForward(v, podName).catch(() =>
        sleep(250).then(() => null),
      );
    if (!pf) throw new Error("no port-forward");
  };
  await connect();
  try {
    let ok = false;
    while (!ok && Date.now() < deadline) {
      const r = await fetch(`http://127.0.0.1:${pf.port}/`, {
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);
      ok = Boolean(r?.ok);
      if (!ok) await sleep(200);
      if (!ok && !pf.alive()) await connect();
    }
    if (!ok) throw new Error("Theia never answered HTTP 200");
    m.mark("http200");
    const base = `http://127.0.0.1:${pf.port}/`;
    // A user opens the IDE only once the public URL works, so the page load waits for the route.
    const gate = v.publicRouteCheck ? "routed" : "routeAccepted";
    while (m.ms[gate] === undefined && Date.now() < deadline) await sleep(100);
    const page = await browser.newPage();
    try {
      await page.goto(base, {
        waitUntil: "domcontentloaded",
        timeout: deadline - Date.now(),
      });
      await page
        .locator("#theia-app-shell")
        .waitFor({ state: "visible", timeout: deadline - Date.now() });
      m.mark("shell");
      // The bench sessions start without a repository, so the tree is rendered but empty.
      await page
        .locator("#files .theia-TreeContainer")
        .first()
        .waitFor({ state: "visible", timeout: deadline - Date.now() });
      m.mark("explorer");
    } finally {
      await page.close();
    }
  } finally {
    pf?.stop();
  }
}

async function snapshotObjects(v) {
  const kinds =
    "deployments,replicasets,pods,services,configmaps,secrets,persistentvolumeclaims,networkpolicies,httproutes.gateway.networking.k8s.io,ingresses";
  const out = await kubectl(v, ["get", kinds, "-o", "name"]).catch(() => "");
  return new Set(
    out.split("\n").filter((l) => l && !l.includes("bench-prepull")),
  );
}

async function controlPlaneTop(v) {
  const out = await kubectl(v, ["top", "pods", "--no-headers"]).catch(() => "");
  let cpu = 0;
  let mem = 0;
  for (const line of out.split("\n")) {
    const [name, c, mm] = line.trim().split(/\s+/);
    if (!name || !v.controlPlanePods.test(name)) continue;
    cpu += parseInt(c, 10);
    mem += parseInt(mm, 10);
  }
  return { cpuMilli: cpu, memMi: mem };
}

async function pulledImage(v, podName) {
  const out = await kubectl(v, [
    "get",
    "events",
    "--field-selector",
    `involvedObject.name=${podName}`,
    "-o",
    'jsonpath={range .items[*]}{.reason} {.message}{"\\n"}{end}',
  ]).catch(() => "");
  return pulledIdeImage(out, BENCH_IMAGE);
}

async function waitPoolReady(v, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const out = await kubectl(v, ["get", "pods", "-o", "json"]);
    const ready = JSON.parse(out).items.filter((p) => {
      const pod = {
        name: p.metadata.name,
        labels: p.metadata.labels,
        conditions: p.status.conditions,
      };
      return (
        !p.metadata.deletionTimestamp &&
        v.poolPod(pod, v) &&
        condTrue(pod, "Ready")
      );
    });
    const sessions = JSON.parse(
      await kubectl(v, ["get", v.resource, "-l", LABEL, "-o", "json"]),
    ).items;
    if (ready.length > 0 && sessions.length === 0) return;
    await sleep(2000);
  }
  throw new Error("pool not ready");
}

async function runOnce(v, runIndex, browser) {
  const name = `bench-${opt.mode}-${Date.now().toString(36)}`;
  const timeoutMs = Number(opt.timeout) * 1000;
  const baseline = await routeProbe(`https://${v.host}/${randomUUID()}/`, v);
  const before = await snapshotObjects(v);
  const topBefore = await controlPlaneTop(v);

  const t0 = Date.now();
  const m = new Milestones(t0);
  const deadline = t0 + timeoutMs;
  let status = null;
  let pod = null;
  let failure = null;
  const pods = new Map();

  // A field selector instead of the name: watching a named object that does not exist yet makes kubectl exit.
  const crWatch = watch(
    v,
    [v.resource, "--field-selector", `metadata.name=${name}`],
    CR_FIELDS,
    (item, at) => {
      // The CR uid is kept with the status because upstream Theia Cloud builds the session path from it.
      status = { ...item.status, crUid: item.uid };
      if (v.url(status)) m.mark("url", at);
      if (v.controlPlaneReady(status)) m.mark("controlPlaneReady", at);
      if (v.failed(status))
        failure = `control plane failed: ${JSON.stringify(status)}`;
    },
  );
  const podWatch = watch(v, ["pods"], POD_FIELDS, (item, at) => {
    pods.set(item.name, item);
    if (!pod && v.ownsPod(item, name, status, v)) pod = item.name;
    if (pod !== item.name) return;
    if (item.node) m.mark("scheduled", at);
    if (containerRunning(item, v.ideContainer)) m.mark("running", at);
    if (condTrue(item, "Ready")) m.mark("podReady", at);
  });

  await kubectl(v, ["apply", "-f", "-"], JSON.stringify(v.manifest(name, v)));
  m.mark("created");

  // Route and workbench run side by side once the URL and the pod are known.
  const routeTask = (async () => {
    while (v.publicRouteCheck && !failure && Date.now() < deadline) {
      const url = v.url(status);
      if (url && isRouted(await routeProbe(`https://${url}`, v), baseline))
        return m.mark("routed");
      await sleep(250);
    }
  })();
  const routeAcceptedTask = (async () => {
    while (v.gatewayRoutes !== false && !failure && Date.now() < deadline) {
      const url = v.url(status);
      if (url) {
        const path = new URL(`https://${url.replace(/^https?:\/\//, "")}`)
          .pathname;
        const routes = JSON.parse(
          await kubectl(v, [
            "get",
            "httproutes.gateway.networking.k8s.io",
            "-o",
            "json",
          ]).catch(() => '{"items":[]}'),
        ).items;
        if (routes.some((r) => routeAccepted(r, path)))
          return m.mark("routeAccepted");
      }
      await sleep(250);
    }
  })();
  const workbenchTask = (async () => {
    while (!failure && Date.now() < deadline) {
      if (!pod) {
        for (const p of pods.values())
          if (v.ownsPod(p, name, status, v)) pod = p.name;
      }
      if (pod && containerRunning(pods.get(pod) ?? {}, v.ideContainer))
        return loadWorkbench(v, pod, m, deadline, browser);
      await sleep(100);
    }
  })();
  try {
    await Promise.all([routeTask, routeAcceptedTask, workbenchTask]);
    // The Go control plane only reports Ready after the agent in the IDE checked in, so give it the rest of the time.
    while (
      !failure &&
      m.ms.controlPlaneReady === undefined &&
      Date.now() < deadline
    )
      await sleep(100);
  } catch (e) {
    failure = failure ?? String(e.message ?? e);
  }
  if (!failure && Date.now() >= deadline) failure = "timeout";

  const after = await snapshotObjects(v);
  const created = [...after].filter((o) => !before.has(o));
  const topAfter = await controlPlaneTop(v);
  const node = pod ? pods.get(pod)?.node : null;
  const pulled = pod ? await pulledImage(v, pod) : null;
  const finalStatus = status;

  // Cleanup: from delete until the session pod is gone (cold) or replaced by a ready pool pod (warm).
  const tDel = Date.now();
  await kubectl(v, ["delete", v.resource, name, "--wait=false"]).catch(
    () => {},
  );
  crWatch.stop();
  podWatch.stop();
  let cleanupMs = null;
  while (pod && Date.now() - tDel < 300000) {
    const stillThere = (
      await kubectl(v, [
        "get",
        "pod",
        pod,
        "--ignore-not-found",
        "-o",
        "name",
      ]).catch(() => "x")
    ).trim();
    if (!stillThere) {
      cleanupMs = Date.now() - tDel;
      break;
    }
    await sleep(500);
  }
  // A session that is still there would distort the next run.
  if (pod && cleanupMs === null) failure = failure ?? "cleanup timeout";
  let poolRefillMs = null;
  if (opt.mode === "warm") {
    try {
      await waitPoolReady(v, 300000);
      poolRefillMs = Date.now() - tDel;
    } catch (e) {
      failure = failure ?? `pool refill: ${e.message}`;
    }
  }

  return {
    variant: opt.variant,
    mode: opt.mode,
    run: runIndex,
    session: name,
    startedAt: new Date(t0).toISOString(),
    ms: m.ms,
    cleanupMs,
    poolRefillMs,
    failure,
    pod,
    node,
    imagePulled: pulled,
    startStrategy: finalStatus?.startStrategy ?? null,
    controlPlaneTimestamps: finalStatus?.timestamps ?? null,
    objectsCreated: created,
    controlPlaneTop: { before: topBefore, after: topAfter },
  };
}

async function main() {
  const v = VARIANTS[opt.variant];
  if (!v)
    throw new Error(
      `--variant must be one of ${Object.keys(VARIANTS).join(", ")}`,
    );
  if (!["cold", "warm"].includes(opt.mode))
    throw new Error("--mode must be cold or warm");
  const browser = await chromium.launch({
    executablePath: opt.chrome,
    headless: true,
  });
  try {
    await v.setPool(v, opt.mode === "warm" ? 1 : 0);
    for (let i = 1; i <= Number(opt.runs); i++) {
      if (opt.mode === "warm") await waitPoolReady(v, 300000);
      const rec = await runOnce(v, i, browser);
      appendFileSync(opt.out, JSON.stringify(rec) + "\n");
      // The record is saved first; later runs would start on a cluster that is not back to its start state.
      if (/^(cleanup timeout|pool refill)/.test(rec.failure ?? ""))
        throw new Error(`stopping the series: ${rec.failure}`);
      const s = Object.entries(rec.ms)
        .map(([k, ms]) => `${k}=${(ms / 1000).toFixed(1)}s`)
        .join(" ");
      console.log(
        `[${opt.variant} ${opt.mode} ${i}/${opt.runs}] ${rec.failure ?? "ok"} ${s} cleanup=${rec.cleanupMs}ms pulled=${rec.imagePulled}`,
      );
      await sleep(Number(opt.gap) * 1000);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
