/**
 * Fixture portal "auth". Demo-only credentials shown on the login page; synthetic data only.
 * The cookie value is a fixed token: this gate exists so the agent/recorder exercise a real
 * login step, not to protect anything.
 */
export const PORTAL_COOKIE = "portal_session";
export const PORTAL_SESSION_VALUE = "fixture-ap.reviewer";
export const DEMO_USERNAME = "ap.reviewer";
export const DEMO_PASSWORD = "demo-only";

export function checkCredentials(username: unknown, password: unknown): boolean {
  return typeof username === "string" && typeof password === "string" &&
    username.trim() === DEMO_USERNAME && password === DEMO_PASSWORD;
}

export function isValidSession(value: string | undefined | null): boolean {
  return value === PORTAL_SESSION_VALUE;
}
