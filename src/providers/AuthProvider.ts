import * as vscode from "vscode";
import { LynvoUser } from "../types";

interface GitHubUserOptions {
  createIfNone?: boolean;
}

export class AuthProvider {
  public static async getGitHubUser(
    options: GitHubUserOptions = {},
  ): Promise<LynvoUser | undefined> {
    const { createIfNone = false } = options;

    try {
      const session = await vscode.authentication.getSession(
        "github",
        ["read:user"],
        { createIfNone },
      );

      if (session) {
        return {
          githubId: session.account.id,
          username: session.account.label,
        };
      }
    } catch (error) {
      console.error("Lynvo: Error al autenticar con GitHub", error);
      if (createIfNone) {
        vscode.window.showErrorMessage(
          "Lynvo: Se requiere iniciar sesión con GitHub para identificar los cambios.",
        );
      }
    }

    return undefined;
  }
}
