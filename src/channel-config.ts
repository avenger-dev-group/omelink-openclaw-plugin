import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";

import { resolveOmelinkConfig } from "./config.js";
import type { OmelinkConfig } from "./types.js";

export type ResolvedOmelinkAccount = OmelinkConfig & {
  accountId: string;
  enabled: boolean;
};

export function listOmelinkAccountIds(): string[] {
  return [DEFAULT_ACCOUNT_ID];
}

export function resolveOmelinkAccount(
  cfg: unknown,
  accountId?: string | null
): ResolvedOmelinkAccount {
  return {
    accountId: accountId?.trim() || DEFAULT_ACCOUNT_ID,
    enabled: true,
    ...resolveOmelinkConfig(cfg)
  };
}
