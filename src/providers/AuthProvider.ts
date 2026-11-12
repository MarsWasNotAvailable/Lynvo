import * as vscode from "vscode";
import { t } from "../l10n";
import { GitLabAuthProvider, registerGitLabProvider } from "./GitLabAuthProvider";

/**
 * A third-party provider account (provider-agnostic).
 * Used to register remote domains; not an attribution shape.
 */
export interface ProviderAccount {
  /** Provider-unique account id (e.g. GitHub numeric id, GitLab numeric id). */
  id: string;
  /** Human-readable account label (e.g. GitHub/GitLab login name). */
  label: string;
}

interface ProviderUserOptions {
  createIfNone?: boolean;
}

/** Known remote provider identifiers. */
const REMOTE_PROVIDERS = new Set(["github", "gitlab"]);

/** Check whether an identity's `source` field refers to a remote provider. */
export function isRemoteSource(source: string | undefined): boolean {
  return source !== undefined && REMOTE_PROVIDERS.has(source.toLowerCase());
}

export class AuthProvider {
  /** The GitLab provider instance (set after registration). */
  private static _gitlabProvider: GitLabAuthProvider | undefined;

  /** Get the GitLab provider instance (for revocation calls). */
  public static get gitlabProvider(): GitLabAuthProvider | undefined {
    return AuthProvider._gitlabProvider;
  }

  /** Register the GitLab provider. Call once at extension activation. */
  public static registerGitLab(context: vscode.ExtensionContext): void {
    const { provider, disposable } = registerGitLabProvider(context);
    AuthProvider._gitlabProvider = provider;
    context.subscriptions.push(disposable);
  }

  // ─── GitHub ─────────────────────────────────────────────────────────────────

  public static async getGitHubUser(
    options: ProviderUserOptions = {},
  ): Promise<ProviderAccount | undefined> {
    const { createIfNone = false } = options;
    try {
      const session = await vscode.authentication.getSession(
        "github",
        ["read:user"],
        { createIfNone },
      );
      if (session) {
        return {
          id: session.account.id,
          label: session.account.label,
        };
      }
    } catch (error) {
      console.error("Lynvo: Error authenticating with GitHub", error);
      if (createIfNone) {
        vscode.window.showErrorMessage(
          t("Lynvo: You must sign in to {0} to continue.", "GitHub"),
        );
      }
    }
    return undefined;
  }

  // ─── GitLab ─────────────────────────────────────────────────────────────────

  public static async getGitLabUser(
    options: ProviderUserOptions = {},
  ): Promise<ProviderAccount | undefined> {
    const { createIfNone = false } = options;
    try {
      const session = await vscode.authentication.getSession(
        "lynvo-gitlab",
        ["read_user"],
        { createIfNone },
      );
      if (session) {
        return {
          id: session.account.id,
          label: session.account.label,
        };
      }
    } catch (error) {
      console.error("Lynvo: Error authenticating with GitLab", error);
      if (createIfNone) {
        vscode.window.showErrorMessage(
          t("Lynvo: You must sign in to {0} to continue.", "GitLab"),
        );
      }
    }
    return undefined;
  }

  // ─── Revocation ─────────────────────────────────────────────────────────────

  /**
   * Revoke the authentication session for a given provider.
   * - For "gitlab": calls the provider's `revokeAllSessions` (revokes at GitLab + deletes local).
   * - For "github": forwards the user to the VS Code's built-in mechanism for Signing Out.
   * Returns true if a revocation was attempted.
   */
  public static async revokeSession(provider: string): Promise<boolean> {
    const lowered = provider.toLowerCase();
    switch (lowered){
      case "gitlab": {
        if (AuthProvider._gitlabProvider) {
          await AuthProvider._gitlabProvider.revokeAllSessions();
          return true;
        }
        return false;
      }
      case "github": {
        // Attempt to sign out via VS Code's built-in GitHub provider command.
        // If the command is not available (e.g. GitHub extension not installed),
        // fall back to a guidance message.
        try {
          await vscode.commands.executeCommand("github.auth.signOut");
          return true;
        } catch {
          vscode.window.showInformationMessage(
            t("To fully revoke GitHub access, use 'GitHub: Sign Out' from the Command Palette."),
          );
          return false;
        }
      }
    }
    return false;
  }

  /**
   * Get the display name for a provider (for UI messages).
   */
  public static getProviderDisplayName(provider: string): string {
    switch (provider.toLowerCase()) {
      case "github": return "GitHub";
      case "gitlab": return "GitLab";
      default: return provider;
    }
  }
}
