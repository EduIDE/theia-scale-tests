import path from "path";

/** Where global setup stores the logged-in browser sessions. */
export const AUTH_DIR = path.join(process.cwd(), ".auth");
export const SESSION_FILE = path.join(AUTH_DIR, "keycloak_user.json");
/** A second login, so the logout test ends a session nobody else uses. */
export const LOGOUT_SESSION_FILE = path.join(
  AUTH_DIR,
  "keycloak_logout_user.json",
);
export const ARTEMIS_SESSION_FILE = path.join(AUTH_DIR, "artemis_user.json");
