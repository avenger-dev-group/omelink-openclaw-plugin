export declare const OMELINK_CHANNEL_ID = "omelink";
export declare const DEFAULT_OMELINK_BASE_URL = "http://127.0.0.1";
export declare const DEFAULT_OMELINK_WEBHOOK_PATH = "/api/external/openClaw/channel/inbound";
export declare const DEFAULT_OMELINK_AGENTS_PATH = "/api/external/openClaw/channel/agents";
export declare const OMELINK_CONFIG_PATH = "/api/external/openClaw/channel/config";
export declare const OMELINK_MESSAGES_PATH = "/api/external/openClaw/channel/messages";
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
