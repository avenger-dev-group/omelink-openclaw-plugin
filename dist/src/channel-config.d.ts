import type { OmelinkConfig } from "./types.js";
export type ResolvedOmelinkAccount = OmelinkConfig & {
    accountId: string;
    enabled: boolean;
};
export declare function listOmelinkAccountIds(): string[];
export declare function resolveOmelinkAccount(cfg: unknown, accountId?: string | null): ResolvedOmelinkAccount;
