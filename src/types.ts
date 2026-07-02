export const OMELINK_CHANNEL_ID = "omelink";
export const DEFAULT_OMELINK_BASE_URL = "http://127.0.0.1";
export const DEFAULT_OMELINK_WEBHOOK_PATH =
  "/api/external/omelink/channel/inbound";
export const DEFAULT_OMELINK_AGENTS_PATH =
  "/api/external/omelink/channel/agents";
export const OMELINK_CONFIG_PATH =
  "/api/external/omelink/channel/config";
export const OMELINK_HEARTBEAT_PATH =
  "/api/external/omelink/channel/heartbeat";
export const OMELINK_MESSAGES_PATH =
  "/api/external/openClaw/channel/messages";

export interface OmelinkConfig {
  baseUrl: string;
  apiKey?: string;
  webhookPath: string;
  agentsPath: string;
}

export interface OmelinkChannelConfig {
  baseUrl?: string;
  apiKey?: string;
}

export interface OmelinkOutboundMessage {
  externalConversationId: string;
  externalMessageId: string;
  text: string;
}

export interface OmelinkInboundWebhookPayload {
  omelink_conversation_id: string;
  omelink_message_id: string;
  text: string;
}

export interface OmelinkInboundMessage {
  externalConversationId: string;
  externalMessageId: string;
  text: string;
}

export interface OmelinkInboundDeliveryResult {
  visibleReplySent?: boolean;
}
