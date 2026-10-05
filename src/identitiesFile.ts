import type { LynvoDomain, LynvoIdentity } from "./types";

/**
 * On-disk shape of `.vscode/lynvo/identities.json`.
 * The identities registry AND the domains registry both live in this file.
 */
export interface IdentitiesFile {
  identities: Record<string, LynvoIdentity>;
  domains: Record<string, LynvoDomain>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parse an identities.json payload: the `{ identities, domains }` shape. */
export function parseIdentitiesFile(raw: unknown): IdentitiesFile {
  if (!isPlainObject(raw)) {
    return { identities: {}, domains: {} };
  }
  return {
    identities:
      (raw.identities as Record<string, LynvoIdentity> | undefined) || {},
    domains: (raw.domains as Record<string, LynvoDomain> | undefined) || {},
  };
}

/** Serialize the identities + domains registries for identities.json. */
export function serializeIdentitiesFile(board: {
  identities?: Record<string, LynvoIdentity>;
  domains?: Record<string, LynvoDomain>;
}): IdentitiesFile {
  return {
    identities: board.identities || {},
    domains: board.domains || {},
  };
}
