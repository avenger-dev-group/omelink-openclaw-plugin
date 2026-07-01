import {
  DEFAULT_OMELINK_AGENTS_PATH,
  DEFAULT_OMELINK_WEBHOOK_PATH,
  OMELINK_CHANNEL_ID,
  type OmelinkChannelConfig,
  type OmelinkConfig
} from "./types.js";

type OpenClawLikeConfig = {
  channels?: Record<string, unknown>;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readChannelConfig(cfg: unknown): OmelinkChannelConfig {
  const channels = (cfg as OpenClawLikeConfig | undefined)?.channels;
  const raw = channels?.[OMELINK_CHANNEL_ID];
  return raw && typeof raw === "object" ? (raw as OmelinkChannelConfig) : {};
}

export function resolveOmelinkConfig(cfg: unknown = {}): OmelinkConfig {
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
