import * as vscode from "vscode";
import * as http from "http";
import * as crypto from "crypto";
import { LynvoLog } from "../logging";

/**
 * GitLab OAuth2 PKCE Authentication Provider.
 *
 * Implements the VS Code `AuthenticationProvider` interface so that
 * `vscode.authentication.getSession("lynvo-gitlab", ...)` works transparently.
 *
 * Flow (Authorization Code + PKCE, RFC 7636):
 *  1. Generate a random `code_verifier`.
 *  2. Derive `code_challenge = BASE64URL(SHA256(code_verifier))`.
 *  3. Start a local HTTP server on 127.0.0.1:<random port>.
 *  4. Open the system browser to GitLab's `/oauth/authorize` with the challenge.
 *  5. GitLab redirects back to the local server with `?code=...`.
 *  6. Exchange the code + `code_verifier` for an access token.
 *  7. Fetch the user profile from `/api/v4/user`.
 *  8. Store the session in VS Code's SecretStorage and fire the change event.
 *
 * Reusable pattern: to add another provider (e.g. Gitea, Bitbucket),
 * duplicate this file, change the endpoints and scopes, and register
 * a new provider id via `registerAuthenticationProvider`.
 */

// ─── Configuration ────────────────────────────────────────────────────────────
// Register an OAuth Application ( https://gitlab.com/-/profile/applications ) :
//  - Application name : Lynvo
//  - Redirect URI     : http://127.0.0.1/callback  (loopback; the port is
//    dynamically assigned and GitLab accepts any port for loopback redirects)
//  - Uncheck          : Confidential (not needed and will cause issue)
//  - Scopes           : read_user
// Then set the issued Application ID below (or expose it as an extension setting).
//
// GITLAB NOTE:
// The `Clients` counter is probably not a real-time counter, so do not expect
// the value update in real time when revoking a token.
// Secondly, it seems to be a "how much time it was used" counter, and not
// a "how much are are active now" counter.
// 
// SECURITY NOTE: The `client_id` is a PUBLIC identifier (like an app's username),
// NOT a secret. It is safe to commit to source control. The actual security
// comes from: (1) PKCE (prevents code interception), (2) the user's explicit
// "Authorize" click on GitLab's page, (3) the localhost redirect (prevents
// token theft). No `client_secret` is needed because we use PKCE (public client).
// One `client_id` serves ALL users of the extension — each user gets their own
// scoped token for their own GitLab account (same pattern as "Sign in with
// GitLab" buttons on the web). VS Code has no built-in GitLab provider
// (only `github` and `microsoft`), so this is the standard approach.
// If the token exchange fails with an "invalid_client" / "unauthorized_client"
// error, check that the "Confidential" option is NOT enabled in the GitLab
// application settings (confidential apps expect a client_secret).
const GITLAB_CLIENT_ID = "YOUR_GITLAB_OAUTH_APP_ID";
const GITLAB_BASE_URL = "https://gitlab.com";
const GITLAB_AUTHORIZE_URL = `${GITLAB_BASE_URL}/oauth/authorize`;
const GITLAB_TOKEN_URL = `${GITLAB_BASE_URL}/oauth/token`;
const GITLAB_USER_URL = `${GITLAB_BASE_URL}/api/v4/user`;
const GITLAB_REVOKE_URL = `${GITLAB_BASE_URL}/oauth/revoke`;

const PROVIDER_ID = "lynvo-gitlab";
const PROVIDER_LABEL = "GitLab";
const SIGN_IN_TIMEOUT_MS = 120_000; // 2 minutes for the user to complete sign-in
const HTTPS_TIMEOUT_MS = 30_000; // outbound API calls must not hang the sign-in flow

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

/** Generate a cryptographically random `code_verifier` (43–128 chars, unreserved). */
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Derive the S256 `code_challenge` from a `code_verifier`. */
function deriveCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ─── Local callback server ────────────────────────────────────────────────────

/** Styled, self-contained success page shown in the browser after sign-in. */
function successPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>GitLab sign-in successful</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #f6f8fa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08);
          padding: 40px 48px; text-align: center; max-width: 420px; }
  .icon { width: 56px; height: 56px; margin: 0 auto 16px; }
  h1 { font-size: 18px; margin: 0 0 8px; color: #1f2328; }
  p { font-size: 14px; margin: 0; color: #656d76; }
</style>
</head>
<body>
  <div class="card">
    <svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="#2da44e"/>
      <path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <h1>GitLab sign-in successful</h1>
    <p>You may close this tab and return to VS Code.</p>
  </div>
</body>
</html>`;
}

/** Styled, self-contained error page shown in the browser when sign-in fails. */
function errorPageHtml(error: string | null): string {
  const message = (error || "unknown error").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>GitLab sign-in failed</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #f6f8fa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08);
          padding: 40px 48px; text-align: center; max-width: 420px; }
  .icon { width: 56px; height: 56px; margin: 0 auto 16px; }
  h1 { font-size: 18px; margin: 0 0 8px; color: #1f2328; }
  p { font-size: 14px; margin: 0; color: #656d76; }
  code { font-size: 13px; color: #cf222e; }
</style>
</head>
<body>
  <div class="card">
    <svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="#cf222e"/>
      <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <h1>GitLab sign-in failed</h1>
    <p><code>${message}</code></p>
  </div>
</body>
</html>`;
}

/**
 * Start a one-shot HTTP server on 127.0.0.1 that captures the OAuth redirect.
 * The server listens immediately (non-blocking); the returned promise resolves
 * when the browser redirects back with `?code=...` (or rejects on timeout/error).
 */
function startCallbackServer(timeoutMs: number): {
  port: Promise<number>;
  result: Promise<{ code?: string; error?: string }>;
} {
  let resolvePort!: (port: number) => void;
  let resolveResult!: (result: { code?: string; error?: string }) => void;
  let rejectResult!: (error: Error) => void;
  let settled = false;

  const portPromise = new Promise<number>((resolve) => {resolvePort = resolve;});
  const resultPromise = new Promise<{ code?: string; error?: string }>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const server = http.createServer((req, res) => {
    if (settled) {return;}
    settled = true;
    clearTimeout(timer);
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    LynvoLog.info(`[GitLab] Callback received: ${code ? "authorization code" : `error: ${error || "unknown"}`}`);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(code ? successPageHtml() : errorPageHtml(error));
    server.close();
    if (error) {
      rejectResult(new Error(`GitLab sign-in failed: ${error}`));
    } else {
      resolveResult({ code: code || undefined });
    }
  });

  const timer = setTimeout(() => {
    if (settled) {return;}
    settled = true;
    server.close();
    LynvoLog.error("[GitLab] Sign-in timed out: no redirect received from the browser.");
    rejectResult(new Error("GitLab sign-in timed out (no redirect received)."));
  }, timeoutMs);

  server.listen(0, "127.0.0.1", () => {
    resolvePort((server.address() as any).port);
  });

  return { port: portPromise, result: resultPromise };
}

// ─── Token exchange & user fetch ──────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
}

async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: GITLAB_CLIENT_ID,
    code_verifier: codeVerifier,
  });
  const response = await fetch(GITLAB_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(HTTPS_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GitLab token exchange failed (${response.status}): ${text}`);
  }
  return (await response.json()) as TokenResponse;
}

interface GitLabUser {
  id: number;
  username: string;
  name: string;
}

async function fetchGitLabUser(accessToken: string): Promise<GitLabUser> {
  const response = await fetch(GITLAB_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(HTTPS_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch GitLab user (${response.status}).`);
  }
  return (await response.json()) as GitLabUser;
}

/** Revoke a GitLab access token via the OAuth2 revocation endpoint (RFC 7009). */
async function revokeGitLabToken(accessToken: string): Promise<void> {
  try {
    await fetch(GITLAB_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: accessToken,
        client_id: GITLAB_CLIENT_ID,
      }).toString(),
      signal: AbortSignal.timeout(HTTPS_TIMEOUT_MS),
    });
    LynvoLog.info("[GitLab] Access token revoked at the provider.");
  } catch (error) {
    // Best-effort: network failures or already-revoked tokens are non-fatal.
    LynvoLog.error(`[GitLab] Token revocation failed (non-fatal): ${error}`);
  }
}

// ─── Provider implementation ──────────────────────────────────────────────────

interface StoredSession {
  id: string;
  accessToken: string;
  accountId: string;
  accountLabel: string;
  scopes: string[];
}

function toVsCodeSession(s: StoredSession): vscode.AuthenticationSession {
  return {
    id: s.id,
    accessToken: s.accessToken,
    account: { id: s.accountId, label: s.accountLabel },
    scopes: s.scopes,
  };
}

/**
 * A VS Code `AuthenticationProvider` for GitLab using OAuth2 + PKCE.
 * Sessions are persisted in the extension's `SecretStorage` (encrypted by VS Code).
 */
export class GitLabAuthProvider implements vscode.AuthenticationProvider {
  private readonly _onDidChangeSessions = new vscode.EventEmitter<
    vscode.AuthenticationProviderAuthenticationSessionsChangeEvent
  >();

  readonly onDidChangeSessions = this._onDidChangeSessions.event;

  private readonly secretStorage: vscode.SecretStorage;
  private readonly sessions = new Map<string, StoredSession>();

  constructor(context: vscode.ExtensionContext) {
    this.secretStorage = context.secrets;
    // Restore persisted sessions on activation.
    void this.loadSessions();
  }

  /** Load sessions from SecretStorage into the in-memory map. */
  private async loadSessions(): Promise<void> {
    const raw = await this.secretStorage.get(this.secretKey);
    if (!raw) {return;}
    try {
      const parsed: StoredSession[] = JSON.parse(raw);
      this.sessions.clear();
      for (const session of parsed) {
        this.sessions.set(session.id, session);
      }
    } catch {
      this.sessions.clear();
    }
  }

  /** Persist current sessions to SecretStorage. */
  private async saveSessions(): Promise<void> {
    await this.secretStorage.store(
      this.secretKey,
      JSON.stringify(Array.from(this.sessions.values())),
    );
  }

  private get secretKey(): string {
    return `${PROVIDER_ID}.sessions`;
  }

  // ── AuthenticationProvider interface ──

  async getSessions(
    _scopes: readonly string[] | undefined,
    _options: vscode.AuthenticationProviderSessionOptions,
  ): Promise<vscode.AuthenticationSession[]> {
    return Array.from(this.sessions.values()).map(toVsCodeSession);
  }

  async createSession(
    scopes: readonly string[],
    _options: vscode.AuthenticationProviderSessionOptions,
  ): Promise<vscode.AuthenticationSession> {
    LynvoLog.info(`[GitLab] Starting sign-in (scopes: ${scopes.join(", ") || "none"}).`);

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);

    // 1. Start the local callback server (non-blocking; resolves port immediately).
    const { port: portPromise, result: resultPromise } = startCallbackServer(SIGN_IN_TIMEOUT_MS);
    const port = await portPromise;
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    LynvoLog.info(`[GitLab] Callback server listening on ${redirectUri}.`);

    // 2. Open the browser to GitLab's authorize page.
    const authorizeUrl = new URL(GITLAB_AUTHORIZE_URL);
    authorizeUrl.searchParams.set("client_id", GITLAB_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", scopes.join(" "));
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", crypto.randomBytes(16).toString("hex"));

    LynvoLog.info("[GitLab] Opening the browser to the GitLab authorization page.");
    await vscode.env.openExternal(vscode.Uri.parse(authorizeUrl.toString()));

    // 3. Wait for the redirect (blocks until the user completes sign-in or timeout).
    const { code, error } = await resultPromise;
    if (error) {
      throw new Error(error);
    }
    if (!code) {
      throw new Error("GitLab sign-in failed: no authorization code received.");
    }
    LynvoLog.info("[GitLab] Authorization code received; exchanging for an access token.");

    // 4. Exchange the code for a token.
    const tokenResponse = await exchangeCodeForToken(code, codeVerifier, redirectUri);
    LynvoLog.info(`[GitLab] Access token obtained (type: ${tokenResponse.token_type}).`);

    // 5. Fetch the user profile.
    const user = await fetchGitLabUser(tokenResponse.access_token);
    LynvoLog.info(`[GitLab] Fetched GitLab user: ${user.username} (id: ${user.id}).`);

    // 6. Store the session.
    const sessionId = `gitlab-${user.id}-${Date.now().toString(36)}`;
    const session: StoredSession = {
      id: sessionId,
      accessToken: tokenResponse.access_token,
      accountId: String(user.id),
      accountLabel: user.username,
      scopes: [...scopes],
    };
    this.sessions.set(sessionId, session);
    await this.saveSessions();
    this._onDidChangeSessions.fire({
      added: [toVsCodeSession(session)],
      removed: undefined,
      changed: undefined,
    });
    LynvoLog.info(`[GitLab] Sign-in complete; session ${sessionId} stored.`);

    return toVsCodeSession(session);
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {return;}
    // Best-effort revocation at the provider.
    await revokeGitLabToken(session.accessToken);
    this.sessions.delete(sessionId);
    await this.saveSessions();
    this._onDidChangeSessions.fire({
      added: undefined,
      removed: [toVsCodeSession(session)],
      changed: undefined,
    });
  }

  /** Revoke ALL stored GitLab sessions (used when deleting a remote domain). */
  async revokeAllSessions(): Promise<void> {
    const all = Array.from(this.sessions.values());
    for (const session of all) {
      await revokeGitLabToken(session.accessToken);
    }
    this.sessions.clear();
    await this.saveSessions();
    this._onDidChangeSessions.fire({
      added: undefined,
      removed: all.map(toVsCodeSession),
      changed: undefined,
    });
  }
}

/**
 * Register the GitLab authentication provider.
 * Call once at extension activation.
 * Returns the provider instance (for direct `revokeAllSessions` calls)
 * and the VS Code `Disposable` (for cleanup).
 */
export function registerGitLabProvider(
  context: vscode.ExtensionContext,
): { provider: GitLabAuthProvider; disposable: vscode.Disposable } {
  const provider = new GitLabAuthProvider(context);
  const disposable = vscode.authentication.registerAuthenticationProvider(
    PROVIDER_ID,
    PROVIDER_LABEL,
    provider,
    { supportsMultipleAccounts: false },
  );
  return { provider, disposable };
}
