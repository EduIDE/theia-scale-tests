import { Browser, BrowserContext } from "@playwright/test";
import { createHash, randomBytes } from "crypto";
import { TemplateSpec } from "./catalog";

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

/** /config.js assigns window.theiaCloudConfig, so it runs against a stand-in window. */
export function parseConfigJs(source: string): CloudConfig {
  const win: { theiaCloudConfig?: CloudConfig } = {};
  new Function("window", source)(win);
  if (!win.theiaCloudConfig)
    throw new Error("config.js has no theiaCloudConfig");
  return win.theiaCloudConfig;
}

export function decodeJwt(jwt: string): Record<string, string> {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Sessions of one app, narrowed by template when several are running. */
export function matchSessions(
  sessions: SessionSpec[],
  spec: Pick<TemplateSpec, "app" | "template">,
): SessionSpec[] {
  const ofApp = sessions.filter((s) => s.appDefinition === spec.app);
  const templated = ofApp.filter((s) => s.envVars?.TEMPLATE === spec.template);
  // Without a TEMPLATE variable on the session the app is the best we know.
  return templated.length > 0 || ofApp.every((s) => s.envVars?.TEMPLATE)
    ? templated
    : ofApp;
}

/**
 * Talks to the Theia Cloud service the way the landing page does, with the
 * ID token of the test user. The landing page keeps its token in memory, so a
 * fresh one is fetched with an authorization code flow that rides on the SSO
 * cookies of the stored login. That is the only way to end a session: logging
 * out of the landing page leaves it running and counting against the per-user
 * session limit.
 */
/** Gets an ID token with the SSO cookies of the stored login, see CloudService. */
async function fetchIdToken(
  context: BrowserContext,
  cfg: CloudConfig,
  landingUrl: string,
): Promise<string> {
  const { verifier, challenge } = pkcePair();
  const redirectUri = new URL("/", landingUrl).toString();
  const realm = `${cfg.keycloakAuthUrl.replace(/\/$/, "")}/realms/${cfg.keycloakRealm}/protocol/openid-connect`;
  const page = await context.newPage();
  let code: string | null;
  try {
    const callback = page.waitForRequest(
      (r) => r.url().startsWith(redirectUri) && r.url().includes("code="),
      { timeout: 30_000 },
    );
    await page.goto(
      `${realm}/auth?` +
        new URLSearchParams({
          client_id: cfg.keycloakClientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "openid",
          code_challenge: challenge,
          code_challenge_method: "S256",
        }),
      { waitUntil: "commit" },
    );
    code = new URL((await callback).url()).searchParams.get("code");
  } finally {
    await page.close();
  }
  const res = await context.request.post(`${realm}/token`, {
    form: {
      grant_type: "authorization_code",
      client_id: cfg.keycloakClientId,
      code: code ?? "",
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
  });
  if (!res.ok()) {
    throw new Error(`Token request failed: ${res.status()}`);
  }
  return (await res.json()).id_token as string;
}

/** True when the token has less than `marginS` seconds left. */
export function tokenExpiresSoon(jwt: string, marginS = 60, now = Date.now()) {
  return Number(decodeJwt(jwt).exp) * 1000 - now < marginS * 1000;
}

export class CloudService {
  private constructor(
    private context: BrowserContext,
    private cfg: CloudConfig,
    private landingUrl: string,
    private idToken: string,
    private user: string,
  ) {}

  static async connect(
    browser: Browser,
    cfg: CloudConfig,
    landingUrl: string,
  ): Promise<CloudService> {
    const context = await browser.newContext({
      storageState: ".auth/keycloak_user.json",
    });
    const idToken = await fetchIdToken(context, cfg, landingUrl);
    const claims = decodeJwt(idToken);
    return new CloudService(
      context,
      cfg,
      landingUrl,
      idToken,
      claims.email ?? claims.preferred_username,
    );
  }

  async dispose() {
    await this.context.close();
  }

  /** The token lives a few minutes, a serial spec outlasts it. */
  private async headers() {
    if (tokenExpiresSoon(this.idToken)) {
      this.idToken = await fetchIdToken(
        this.context,
        this.cfg,
        this.landingUrl,
      );
    }
    return { Authorization: `Bearer ${this.idToken}` };
  }

  async listSessions(): Promise<SessionSpec[]> {
    const res = await this.context.request.get(
      `${this.cfg.serviceUrl}/service/session/${this.cfg.serviceAuthToken}/${encodeURIComponent(this.user)}`,
      { headers: await this.headers() },
    );
    if (!res.ok()) throw new Error(`Listing sessions failed: ${res.status()}`);
    return res.json();
  }

  async stopSession(name: string): Promise<void> {
    const res = await this.context.request.delete(
      `${this.cfg.serviceUrl}/service/session`,
      {
        headers: await this.headers(),
        data: {
          kind: "sessionStopRequest",
          appId: this.cfg.serviceAuthToken,
          user: this.user,
          sessionName: name,
        },
      },
    );
    if (!res.ok()) throw new Error(`Stopping ${name} failed: ${res.status()}`);
  }

  /** Stops the sessions of a template and returns how many were running. */
  async stopTemplate(
    spec: Pick<TemplateSpec, "app" | "template">,
  ): Promise<number> {
    const sessions = matchSessions(await this.listSessions(), spec);
    for (const s of sessions) await this.stopSession(s.name!);
    return sessions.length;
  }
}
