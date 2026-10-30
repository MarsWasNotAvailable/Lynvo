import * as vscode from "vscode";
import { t } from "../l10n";

/**
 * A third-party provider account (provider-agnostic).
 * Used to register remote domains; not an attribution shape.
 */
export interface ProviderAccount {
  /** Provider-unique account id (e.g. GitHub numeric id). */
  id: string;
  /** Human-readable account label (e.g. GitHub login name). */
  label: string;
}

interface GitHubUserOptions {
  createIfNone?: boolean;
}

export class AuthProvider {
  public static async getGitHubUser(
    options: GitHubUserOptions = {},
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
          t("Lynvo: You must sign in to GitHub to view the changes."),
        );
      }
    }

    return undefined;
  }
}
