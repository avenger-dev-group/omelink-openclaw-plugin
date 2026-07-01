import { DEFAULT_OMELINK_AGENTS_PATH, DEFAULT_OMELINK_WEBHOOK_PATH, OMELINK_CHANNEL_ID } from "./types.js";
function readString(value) {
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}
function readChannelConfig(cfg) {
    const channels = cfg?.channels;
    const raw = channels?.[OMELINK_CHANNEL_ID];
    return raw && typeof raw === "object" ? raw : {};
}
export function resolveOmelinkConfig(cfg = {}) {
    const channelCfg = readChannelConfig(cfg);
    const baseUrl = readString(channelCfg.baseUrl);
    if (!baseUrl) {
        throw new Error("channels.omelink.baseUrl is required");
    }
    return {
        baseUrl,
        apiKey: readString(channelCfg.apiKey),
        webhookPath: DEFAULT_OMELINK_WEBHOOK_PATH,
        agentsPath: DEFAULT_OMELINK_AGENTS_PATH
    };
}
