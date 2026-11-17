import { createHash, randomBytes } from "crypto";
import fs from "fs";
import { TemplateSpec } from "./catalog";
import { SESSION_FILE } from "./auth-files";

/** The subset of window.theiaCloudConfig (served as /config.js) used here. */
export interface CloudConfig {
  serviceUrl: string;
  serviceAuthToken: string;
  keycloakAuthUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
  useEphemeralStorage: boolean;
  additionalApps: {
    serviceAuthToken: string;
    appName: string;
    visible?: boolean;
    ephemeral?: boolean;
    buildSystems?: { id: string; label: string }[];
  }[];
}

export interface SessionSpec {
  name?: string;
  appDefinition?: string;
  workspace?: string;
  envVars?: Record<string, string>;
}

export interface WorkspaceInfo {
  name?: string;
  appDefinition?: string;
}

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

/**
 * The name the landing page gives the workspace of an app and template, a port
 * of createWorkspaceName in EduIDE-Landing-Page (src/launch.ts). It identifies
 * the session and the workspace of one template exactly.
 */
export function workspaceName(
  app: string,
  template: string,
  username: string,
): string {
  const segment = (value: string, fallback: string) => {
    const clean = value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "");
    return (clean.length > 0 ? clean : fallback).substring(0, 12);
  };
  const appKey = `${app}-${template}`;
  let hash = 0;
  for (const ch of `${username}-${appKey}-playground`) {
    hash = (hash << 5) - hash + ch.charCodeAt(0);
    hash |= 0;
  }
  const id = Math.abs(hash).toString(16).padStart(8, "0");
  return `ws-${segment(appKey, "app")}-playground-${segment(username, "user")}-${id}`;
}

/** Sessions of exactly this app and template, never of a sibling template. */
export function matchSessions(
  sessions: SessionSpec[],
  spec: Pick<TemplateSpec, "app" | "template">,
  username: string,
): SessionSpec[] {
  const wanted = workspaceName(spec.app, spec.template, username);
  return sessions.filter(
    (s) =>
      s.appDefinition === spec.app &&
      (s.workspace === wanted || s.envVars?.TEMPLATE === spec.template),
  );
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
 * Gets an ID token with the SSO cookies of a stored login: an authorization
 * code flow with PKCE, the way the landing page logs in. Plain fetch, not a
 * browser context, so that no Playwright trace can ever hold the cookies, the
 * code or the tokens.
 */
async function fetchIdToken(
  cookies: Cookie[],
  cfg: CloudConfig,
  landingUrl: string,
): Promise<string> {
  const { verifier, challenge } = pkcePair();
  const redirectUri = new URL("/", landingUrl).toString();
  const realm = `${cfg.keycloakAuthUrl.replace(/\/$/, "")}/realms/${cfg.keycloakRealm}/protocol/openid-connect`;
  const authUrl = new URL(`${realm}/auth`);
  authUrl.search = new URLSearchParams({
    client_id: cfg.keycloakClientId,
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
      client_id: cfg.keycloakClientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status}`);
  }
  return ((await res.json()) as { id_token: string }).id_token;
}

/** True when the token has less than `marginS` seconds left. */
export function tokenExpiresSoon(jwt: string, marginS = 60, now = Date.now()) {
  return Number(decodeJwt(jwt).exp) * 1000 - now < marginS * 1000;
}

/**
 * Talks to the Theia Cloud service the way the landing page does, with the
 * ID token of the test user. The landing page keeps its token in memory, so a
 * fresh one is fetched from the SSO cookies of the stored login. This is the
 * only way to end a session: logging out of the landing page leaves it running
 * and counting against the per-user session limit.
 */
export class CloudService {
  /** Name the landing page uses for the user in workspace names. */
  readonly username: string;
  /** User of service requests, the e-mail as in the landing page. */
  private readonly user: string;

  private constructor(
    private cookies: Cookie[],
    private cfg: CloudConfig,
    private landingUrl: string,
    private idToken: string,
  ) {
    const claims = decodeJwt(idToken);
    this.user = claims.email ?? claims.preferred_username;
    this.username = claims.preferred_username ?? claims.email;
  }

  static async fromCookies(
    cookies: Cookie[],
    cfg: CloudConfig,
    landingUrl: string,
  ) {
    const token = await fetchIdToken(cookies, cfg, landingUrl);
    return new CloudService(cookies, cfg, landingUrl, token);
  }

  static async fromStorage(
    cfg: CloudConfig,
    landingUrl: string,
    file = SESSION_FILE,
  ) {
    const state = JSON.parse(fs.readFileSync(file, "utf8")) as {
      cookies: Cookie[];
    };
    return CloudService.fromCookies(state.cookies, cfg, landingUrl);
  }

  /** The token lives a few minutes, a spec can outlast it. */
  private async headers() {
    if (tokenExpiresSoon(this.idToken)) {
      this.idToken = await fetchIdToken(
        this.cookies,
        this.cfg,
        this.landingUrl,
      );
    }
    return {
      Authorization: `Bearer ${this.idToken}`,
      "Content-Type": "application/json",
    };
  }

  private async call<T>(method: string, path: string, body?: unknown) {
    const res = await fetch(`${this.cfg.serviceUrl}/service/${path}`, {
      method,
      headers: await this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  private userPath(kind: "session" | "workspace") {
    return `${kind}/${this.cfg.serviceAuthToken}/${encodeURIComponent(this.user)}`;
  }

  listSessions(): Promise<SessionSpec[]> {
    return this.call("GET", this.userPath("session"));
  }

  listWorkspaces(): Promise<WorkspaceInfo[]> {
    return this.call("GET", this.userPath("workspace"));
  }

  async stopSession(name: string): Promise<void> {
    await this.call("DELETE", "session", {
      kind: "sessionStopRequest",
      appId: this.cfg.serviceAuthToken,
      user: this.user,
      sessionName: name,
    });
  }

  async deleteWorkspace(name: string): Promise<void> {
    await this.call("DELETE", "workspace", {
      kind: "workspaceDeletionRequest",
      appId: this.cfg.serviceAuthToken,
      user: this.user,
      workspaceName: name,
    });
  }

  /** The running sessions of exactly this template. */
  async sessionsOf(
    spec: Pick<TemplateSpec, "app" | "template">,
  ): Promise<SessionSpec[]> {
    return matchSessions(await this.listSessions(), spec, this.username);
  }

  /** Stops the sessions of a template and returns how many were running. */
  async stopTemplate(
    spec: Pick<TemplateSpec, "app" | "template">,
  ): Promise<number> {
    const sessions = await this.sessionsOf(spec);
    for (const s of sessions) await this.stopSession(s.name!);
    return sessions.length;
  }

  /**
   * Removes the workspace of a template, so the next launch copies the
   * template into an empty one. Only call without a running session.
   * Returns false when the workspace could not be removed in time.
   */
  async resetWorkspace(
    spec: Pick<TemplateSpec, "app" | "template">,
    timeoutMs = 90_000,
  ): Promise<boolean> {
    const name = workspaceName(spec.app, spec.template, this.username);
    const exists = async () =>
      (await this.listWorkspaces()).some((w) => w.name === name);
    if (!(await exists())) return true;
    await this.deleteWorkspace(name);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await exists())) return true;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return false;
  }
}
