import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import { resolveOmelinkConfig } from "./config.js";
export function listOmelinkAccountIds() {
    return [DEFAULT_ACCOUNT_ID];
}
export function resolveOmelinkAccount(cfg, accountId) {
    return {
        accountId: accountId?.trim() || DEFAULT_ACCOUNT_ID,
        enabled: true,
        ...resolveOmelinkConfig(cfg)
    };
}
