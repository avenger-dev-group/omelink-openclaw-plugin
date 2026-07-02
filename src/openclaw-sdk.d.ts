declare module "openclaw/plugin-sdk/account-id" {
  export const DEFAULT_ACCOUNT_ID: string;
}

declare module "openclaw/plugin-sdk/channel-core" {
  export function buildChannelOutboundSessionRoute(params: unknown): unknown;
  export function createChatChannelPlugin(params: unknown): unknown;
}

declare module "openclaw/plugin-sdk/channel-entry-contract" {
  export function defineBundledChannelEntry(params: unknown): unknown;
}

declare module "openclaw/plugin-sdk/channel-lifecycle" {
  export function waitUntilAbort(
    signal: AbortSignal,
    cleanup?: () => void
  ): Promise<void>;
}

declare module "openclaw/plugin-sdk/channel-send-result" {
  export type OutboundDeliveryResult = {
    channel: string;
    messageId: string;
    chatId?: string;
    channelId?: string;
    roomId?: string;
    conversationId?: string;
    timestamp?: number;
    toJid?: string;
    pollId?: string;
    meta?: Record<string, unknown>;
  };
}

declare module "openclaw/plugin-sdk/directory-runtime" {
  export function createEmptyChannelDirectoryAdapter(): unknown;
}

declare module "openclaw/plugin-sdk/runtime-store" {
  export type PluginRuntime = unknown;
  export function createPluginRuntimeStore(params: {
    pluginId: string;
    errorMessage: string;
  }): {
    setRuntime: (runtime: PluginRuntime) => void;
    getRuntime: () => PluginRuntime;
  };
}

declare module "openclaw/plugin-sdk/reply-payload" {
  export type OutboundReplyPayload = {
    text?: string;
    mediaUrls?: string[];
    mediaUrl?: string;
    presentation?: unknown;
    interactive?: unknown;
    channelData?: Record<string, unknown>;
    sensitiveMedia?: boolean;
    replyToId?: string;
  };

  export function normalizeOutboundReplyPayload(
    payload: Record<string, unknown>
  ): OutboundReplyPayload;
}

declare module "openclaw/plugin-sdk/webhook-ingress" {
  import type { IncomingMessage, ServerResponse } from "node:http";

  export function registerPluginHttpRoute(params: {
    path: string;
    auth?: string;
    pluginId?: string;
    accountId?: string;
    log?: (message: string) => void;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
  }): () => void;
}
