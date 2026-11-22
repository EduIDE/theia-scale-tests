import { createHash, randomBytes } from "crypto";
import fs from "fs";
import { SESSION_FILE } from "./auth-files";

/** The part of the landing page's /config.json used here. */
export interface LandingConfig {
  apiBaseUrl: string;
  keycloak: { url: string; realm: string; clientId: string };
}

/** The part of the 3.0 API's Template used here. */
export interface Template {
  name: string;
  displayName: string;
  listed: boolean;
  defaultPersistence: "none" | "volume";
  injectableKeys: string[];
  variants?: { id: string; name: string }[];
}

interface Display {
  title?: string;
}

export interface SessionInfo {
  name: string;
  template: string;
  phase: "Pending" | "Starting" | "Ready" | "Failed";
  workspace?: string;
  display?: Display;
}

/** A Failed session is listed but a launch ignores it, so it does not occupy the template. */
export const activeSessions = (sessions: SessionInfo[]) =>
  sessions.filter((s) => s.phase !== "Failed");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** A delete of something that is already gone has reached its goal. */
export async function ignoreNotFound(request: Promise<unknown>) {
  try {
    await request;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
}

export interface WorkspaceInfo {
  name: string;
  template: string;
  display?: Display;
}

/**
 * In the suite a spec's `app` is the 3.0 template name (java-17-standalone) and
 * its `template` the id of a variant, which is what a launch sends as
 * data.TEMPLATE.
 */
export type SpecKey = { app: string; template: string };

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export function decodeJwt(jwt: string): Record<string, string> {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Reads the landing page's /config.json, throws on a shape the suite cannot use. */
export function parseConfig(raw: unknown): LandingConfig {
  const c = raw as Partial<LandingConfig> | undefined;
  if (
    !c ||
    typeof c.apiBaseUrl !== "string" ||
    !c.keycloak?.url ||
    !c.keycloak.realm ||
    !c.keycloak.clientId
  ) {
    throw new Error(
      "config.json needs apiBaseUrl and keycloak.url, keycloak.realm, keycloak.clientId",
    );
  }
  return { apiBaseUrl: c.apiBaseUrl, keycloak: c.keycloak };
}

export async function fetchConfig(
  landingUrl = process.env.LANDINGPAGE_URL!,
): Promise<LandingConfig> {
  const res = await fetch(new URL("/config.json", landingUrl));
  if (!res.ok) throw new Error(`GET /config.json failed: ${res.status}`);
  return parseConfig(await res.json());
}

/**
 * Items of exactly this template and variant, never of a sibling variant. A
 * session or workspace does not name its variant, only the landing page's
 * display title does, which is the variant's name. Without variant metadata
 * the template alone decides. With it, a variant id it does not list matches
 * nothing instead of everything.
 */
export function matchByVariant<
  T extends { template: string; display?: Display },
>(items: T[], spec: SpecKey, templates: Template[]): T[] {
  const variants = templates.find((t) => t.name === spec.app)?.variants;
  const hasVariants = variants !== undefined && variants.length > 0;
  const name = variants?.find((v) => v.id === spec.template)?.name;
  if (hasVariants && name === undefined) return [];
  return items.filter(
    (i) =>
      i.template === spec.app &&
      (name === undefined || i.display?.title === name),
  );
}

/**
 * The workspaces a spec's launch used: the ones its sessions run on when there
 * are sessions, else those matching template and variant. `clean` is false when
 * the template has workspaces but none could be matched, so a reset cannot say
 * that it left nothing behind.
 */
export function workspacesToReset(
  workspaces: WorkspaceInfo[],
  sessions: SessionInfo[],
  spec: SpecKey,
  templates: Template[],
): { matched: WorkspaceInfo[]; clean: boolean } {
  const used = new Set(
    matchByVariant(sessions, spec, templates).flatMap((s) =>
      s.workspace ? [s.workspace] : [],
    ),
  );
  const matched = used.size
    ? workspaces.filter((w) => used.has(w.name))
    : matchByVariant(workspaces, spec, templates);
  const candidates = workspaces.some((w) => w.template === spec.app);
  return { matched, clean: matched.length > 0 || !candidates };
}

/** Position of a template among the tiles of the landing page, -1 if it has none. */
export function tileIndex(templates: Template[], name: string): number {
  return templates.filter((t) => t.listed).findIndex((t) => t.name === name);
}

/**
 * Why a spec cannot run in this environment, undefined when it can. Only an
 * environment without the template skips: a variant the template does not
 * list is a bug of the catalog and throws. Without variant metadata sibling
 * variants share one launch key, session and workspace, so only the first spec
 * of a template in `catalog` is available.
 */
export function unavailableReason(
  templates: Template[],
  spec: SpecKey,
  catalog: SpecKey[],
): string | undefined {
  const template = templates.find((t) => t.name === spec.app);
  if (!template) return `${spec.app} is not offered by this environment`;
  if (!template.listed) return `${spec.app} has no tile on the landing page`;
  if (template.variants?.length) {
    if (!template.variants.some((v) => v.id === spec.template)) {
      throw new Error(
        `${spec.app} offers no project template ${spec.template}, fix the catalog`,
      );
    }
    return undefined;
  }
  const first = catalog.find((c) => c.app === spec.app);
  if (first && first.template !== spec.template) {
    return `${spec.app} lists no variants, so only ${first.template} can run`;
  }
  return undefined;
}

export function cookieHeader(cookies: Cookie[], url: URL): string {
  const host = url.hostname;
  return cookies
    .filter((c) => {
      const domain = c.domain.replace(/^\./, "");
      const hostOk = c.domain.startsWith(".")
        ? host === domain || host.endsWith(`.${domain}`)
        : host === domain;
      return hostOk && url.pathname.startsWith(c.path);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/**
 * Gets an access token with the SSO cookies of a stored login: an authorization
 * code flow with PKCE, the way the landing page logs in, and the access token
 * is what it sends to the API. Plain fetch, not a browser context, so that no
 * Playwright trace can ever hold the cookies, the code or the tokens.
 */
async function fetchAccessToken(
  cookies: Cookie[],
  cfg: LandingConfig,
  landingUrl: string,
): Promise<string> {
  const { verifier, challenge } = pkcePair();
  const redirectUri = new URL("/", landingUrl).toString();
  const { url, realm: name, clientId } = cfg.keycloak;
  const realm = `${url.replace(/\/$/, "")}/realms/${name}/protocol/openid-connect`;
  const authUrl = new URL(`${realm}/auth`);
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const auth = await fetch(authUrl, {
    redirect: "manual",
    headers: { cookie: cookieHeader(cookies, authUrl) },
  });
  const location = auth.headers.get("location") ?? "";
  const code = location.startsWith(redirectUri)
    ? new URL(location).searchParams.get("code")
    : null;
  if (!code) {
    throw new Error(`No authorization code, auth answered ${auth.status}`);
  }
  const res = await fetch(`${realm}/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status}`);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

/** True when the token has less than `marginS` seconds left. */
export function tokenExpiresSoon(jwt: string, marginS = 60, now = Date.now()) {
  return Number(decodeJwt(jwt).exp) * 1000 - now < marginS * 1000;
}

/**
 * Talks to the EduIDE API the way the landing page does, with the access token
 * of the test user. The landing page keeps its token in memory, so a fresh one
 * is fetched from the SSO cookies of the stored login. This is the only way to
 * end a session: logging out of the landing page leaves it running and
 * counting against the per-user session limit.
 */
export class CloudService {
  private constructor(
    private cookies: Cookie[],
    private cfg: LandingConfig,
    private landingUrl: string,
    private token: string,
  ) {}

  static async fromCookies(cookies: Cookie[], landingUrl: string) {
    const cfg = await fetchConfig(landingUrl);
    const token = await fetchAccessToken(cookies, cfg, landingUrl);
    return new CloudService(cookies, cfg, landingUrl, token);
  }

  static async fromStorage(landingUrl: string, file = SESSION_FILE) {
    const state = JSON.parse(fs.readFileSync(file, "utf8")) as {
      cookies: Cookie[];
    };
    return CloudService.fromCookies(state.cookies, landingUrl);
  }

  /** The token lives a few minutes, a spec can outlast it. */
  private async headers() {
    if (tokenExpiresSoon(this.token)) {
      this.token = await fetchAccessToken(
        this.cookies,
        this.cfg,
        this.landingUrl,
      );
    }
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  /** `what` names the call in errors, error text ends up in reports. */
  private async call<T>(what: string, method: string, path: string) {
    const base = new URL(this.cfg.apiBaseUrl, this.landingUrl).href;
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method,
      headers: await this.headers(),
    });
    // Errors are problem+json, whose code is a fixed word and safe to report.
    const text = await res.text();
    if (!res.ok) {
      const code = (() => {
        try {
          return (JSON.parse(text) as { code?: string }).code;
        } catch {
          return undefined;
        }
      })();
      throw new ApiError(
        `${what} failed: ${res.status}${code ? ` ${code}` : ""}`,
        res.status,
      );
    }
    // A delete answers 204 without a body.
    return (text ? JSON.parse(text) : undefined) as T;
  }

  listTemplates(): Promise<Template[]> {
    return this.call("List templates", "GET", "/templates");
  }

  listSessions(): Promise<SessionInfo[]> {
    return this.call("List sessions", "GET", "/sessions");
  }

  listWorkspaces(): Promise<WorkspaceInfo[]> {
    return this.call("List workspaces", "GET", "/workspaces");
  }

  async stopSession(name: string): Promise<void> {
    await ignoreNotFound(
      this.call("Stop session", "DELETE", `/sessions/${name}`),
    );
  }

  async deleteWorkspace(name: string): Promise<void> {
    await ignoreNotFound(
      this.call("Delete workspace", "DELETE", `/workspaces/${name}`),
    );
  }

  /** The running sessions of exactly this template and variant. */
  async sessionsOf(spec: SpecKey): Promise<SessionInfo[]> {
    return matchByVariant(
      await this.listSessions(),
      spec,
      await this.listTemplates(),
    );
  }

  /** Stops the sessions of a template, Failed ones included, and returns how many there were. */
  async stopTemplate(spec: SpecKey): Promise<number> {
    const sessions = await this.sessionsOf(spec);
    for (const s of sessions) await this.stopSession(s.name);
    return sessions.length;
  }

  /**
   * Removes the workspaces of a template, so the next launch copies the
   * template into an empty one. The server stops a session on them first and
   * answers once they are gone. Returns false when the template has workspaces
   * but none could be matched to the spec, which leaves old files behind.
   */
  async resetWorkspace(spec: SpecKey): Promise<boolean> {
    const { matched, clean } = workspacesToReset(
      await this.listWorkspaces(),
      await this.listSessions(),
      spec,
      await this.listTemplates(),
    );
    for (const w of matched) await this.deleteWorkspace(w.name);
    return clean;
  }
}
