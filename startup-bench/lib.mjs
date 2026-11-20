// Pure helpers of the startup benchmark, kept apart so they can be tested without a cluster.

export function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarize(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(
    v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length - 1),
  );
  return {
    n: v.length,
    min: v[0],
    median: quantile(v, 0.5),
    p90: quantile(v, 0.9),
    max: v[v.length - 1],
    mean,
    sd,
  };
}

// A route counts as live once the session path answers differently from a path that has no session.
export function isRouted(response, baseline) {
  if (!response || [0, 404, 502, 503, 504].includes(response.status))
    return false;
  return !(
    response.status === baseline.status &&
    hostOf(response.location) === hostOf(baseline.location)
  );
}

function hostOf(location) {
  try {
    return location ? new URL(location).host + new URL(location).pathname : "";
  } catch {
    return location ?? "";
  }
}

// One line of `kubectl get --watch -o jsonpath=...` with fields separated by '|'.
// JSON fields (labels, status) are parsed, empty ones become null.
export function parseWatchLine(line, fields) {
  const parts = line.split("|");
  const out = {};
  fields.forEach((f, i) => {
    const raw = parts[i] ?? "";
    if (f.json) {
      try {
        out[f.name] = raw ? JSON.parse(raw) : null;
      } catch {
        out[f.name] = null;
      }
    } else {
      out[f.name] = raw || null;
    }
  });
  return out;
}

// Records the first time a milestone is reached; later calls keep the first value.
export class Milestones {
  constructor(t0) {
    this.t0 = t0;
    this.ms = {};
  }
  mark(name, at = Date.now()) {
    if (this.ms[name] === undefined) this.ms[name] = at - this.t0;
  }
}

// The gateway accepted the HTTPRoute that serves the session path. Shared routes list several parents
// (one per gateway listener) and only the matching one accepts, so one accepting parent is enough.
export function routeAccepted(route, path) {
  const trim = (p) => (p ?? "").replace(/^\/+|\/+$/g, "");
  const serves = (route.spec?.rules ?? []).some((r) =>
    (r.matches ?? []).some((m) => trim(m.path?.value) === trim(path)),
  );
  const parents = route.status?.parents ?? [];
  const ok = (p, type) =>
    (p.conditions ?? []).some((c) => c.type === type && c.status === "True");
  return (
    serves && parents.some((p) => ok(p, "Accepted") && ok(p, "ResolvedRefs"))
  );
}

// True if the pod events show a pull of the IDE image. Pulls of other images (upstream pulls its oauth2-proxy
// with imagePullPolicy Always on every start) are part of the start time and do not count.
export function pulledIdeImage(events, ideImage) {
  return events
    .split("\n")
    .some((l) => l.startsWith("Pulling ") && l.includes(`"${ideImage}`));
}
