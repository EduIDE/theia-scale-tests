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
  display?: Display;
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
 * the template alone decides.
 */
export function matchByVariant<
  T extends { template: string; display?: Display },
>(items: T[], spec: SpecKey, templates: Template[]): T[] {
  const variant = templates
    .find((t) => t.name === spec.app)
    ?.variants?.find((v) => v.id === spec.template)?.name;
  return items.filter(
    (i) =>
      i.template === spec.app &&
      (variant === undefined || i.display?.title === variant),
  );
}

/** Position of a template among the tiles of the landing page, -1 if it has none. */
export function tileIndex(templates: Template[], name: string): number {
  return templates.filter((t) => t.listed).findIndex((t) => t.name === name);
}

/** Why a spec cannot run in this environment, undefined when it can. */
export function unavailableReason(
  templates: Template[],
  spec: SpecKey,
): string | undefined {
  const template = templates.find((t) => t.name === spec.app);
  if (!template) return `${spec.app} is not offered by this environment`;
  if (!template.listed) return `${spec.app} has no tile on the landing page`;
  // Without variant metadata the id cannot be checked, the launch tells.
  if (
    template.variants?.length &&
    !template.variants.some((v) => v.id === spec.template)
  ) {
    return `${spec.app} has no project template ${spec.template}`;
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
      throw new Error(`${what} failed: ${res.status}${code ? ` ${code}` : ""}`);
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
    await this.call("Stop session", "DELETE", `/sessions/${name}`);
  }

  async deleteWorkspace(name: string): Promise<void> {
    await this.call("Delete workspace", "DELETE", `/workspaces/${name}`);
  }

  /** The running sessions of exactly this template and variant. */
  async sessionsOf(spec: SpecKey): Promise<SessionInfo[]> {
    return matchByVariant(
      await this.listSessions(),
      spec,
      await this.listTemplates(),
    );
  }

  /** Stops the sessions of a template and returns how many were running. */
  async stopTemplate(spec: SpecKey): Promise<number> {
    const sessions = await this.sessionsOf(spec);
    for (const s of sessions) await this.stopSession(s.name);
    return sessions.length;
  }

  /**
   * Removes the workspaces of a template, so the next launch copies the
   * template into an empty one. The server stops a session on them first.
   * Returns false when they could not be removed in time.
   */
  async resetWorkspace(spec: SpecKey, timeoutMs = 90_000): Promise<boolean> {
    const templates = await this.listTemplates();
    const left = async () =>
      matchByVariant(await this.listWorkspaces(), spec, templates);
    const workspaces = await left();
    for (const w of workspaces) await this.deleteWorkspace(w.name);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await left()).length === 0) return true;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return false;
  }
}
