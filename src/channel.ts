import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import {
  buildChannelOutboundSessionRoute,
  createChatChannelPlugin
} from "openclaw/plugin-sdk/channel-core";
import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/channel-inbound";
import { waitUntilAbort } from "openclaw/plugin-sdk/channel-lifecycle";
import type { OutboundDeliveryResult } from "openclaw/plugin-sdk/channel-send-result";
import { createEmptyChannelDirectoryAdapter } from "openclaw/plugin-sdk/directory-runtime";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";

import { createOmelinkAgentAdminHandler } from "./agent-admin.js";
import { sendOmelinkTextMessage } from "./client.js";
import { createOmelinkConfigHandler } from "./config-endpoint.js";
import { createOmelinkHeartbeatHandler } from "./heartbeat.js";
import {
  listOmelinkAccountIds,
  resolveOmelinkAccount,
  type ResolvedOmelinkAccount
} from "./channel-config.js";
import { resolveOmelinkConfig } from "./config.js";
import { getOmelinkRuntime } from "./runtime.js";
import {
  OMELINK_CHANNEL_ID,
  OMELINK_CONFIG_PATH,
  OMELINK_HEARTBEAT_PATH,
  type OmelinkInboundMessage,
  type OmelinkConfig
} from "./types.js";
import { createOmelinkWebhookHandler } from "./webhook.js";

type GatewayLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

type GatewayContext = {
  cfg: unknown;
  accountId?: string | null;
  abortSignal: AbortSignal;
  log?: GatewayLog;
};

type SendTextContext = {
  cfg: unknown;
  to: string;
  text: string;
  accountId?: string | null;
};

type SendTextResult = Omit<OutboundDeliveryResult, "channel">;

function normalizeTarget(target: string): string | undefined {
  const trimmed = target.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^omelink(?:-im)?:/i, "").trim();
}

function buildOutboundMessageId(): string {
  return `openclaw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function sendText(ctx: SendTextContext): Promise<SendTextResult> {
  const cfg = resolveOmelinkConfig(ctx.cfg);
  const externalConversationId = normalizeTarget(ctx.to);
  if (!externalConversationId) {
    throw new Error("OMELINK target is required");
  }

  const externalMessageId = buildOutboundMessageId();
  const result = await sendOmelinkTextMessage({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    externalConversationId,
    externalMessageId,
    text: ctx.text
  });

  return {
    messageId: result.messageId,
    conversationId: externalConversationId
  };
}

async function dispatchInboundToOpenClaw(params: {
  cfg: unknown;
  accountId: string;
  config: OmelinkConfig;
  message: OmelinkInboundMessage;
  log?: GatewayLog;
}): Promise<unknown> {
  const rt = getOmelinkRuntime() as {
    channel?: {
      routing?: {
        resolveAgentRoute?: (params: unknown) => {
          agentId: string;
          sessionKey?: string;
        };
      };
      session?: {
        resolveStorePath?: (store: unknown, params: unknown) => string;
        readSessionUpdatedAt?: (params: unknown) => number | undefined;
        recordInboundSession?: unknown;
      };
      reply?: {
        finalizeInboundContext?: (params: unknown) => unknown;
        formatAgentEnvelope?: (params: unknown) => string;
        resolveEnvelopeFormatOptions?: (cfg: unknown) => unknown;
        dispatchReplyWithBufferedBlockDispatcher?: unknown;
      };
    };
    config?: {
      current?: () => unknown;
    };
  };

  const currentCfg = rt.config?.current?.() ?? params.cfg;
  if (
    !rt.channel?.routing?.resolveAgentRoute ||
    !rt.channel.session?.resolveStorePath ||
    !rt.channel.session.readSessionUpdatedAt ||
    !rt.channel.session.recordInboundSession ||
    !rt.channel.reply?.finalizeInboundContext ||
    !rt.channel.reply.formatAgentEnvelope ||
    !rt.channel.reply.resolveEnvelopeFormatOptions ||
    !rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher
  ) {
    throw new Error("OpenClaw channel runtime is missing direct-DM inbound support");
  }

  return await dispatchInboundDirectDmWithRuntime({
    cfg: currentCfg,
    runtime: rt,
    channel: OMELINK_CHANNEL_ID,
    channelLabel: "OMELINK",
    accountId: params.accountId,
    peer: {
      kind: "direct",
      id: params.message.externalAgentId
    },
    senderId: params.message.externalAgentId,
    senderAddress: `${OMELINK_CHANNEL_ID}:${params.message.externalAgentId}`,
    recipientAddress: `${OMELINK_CHANNEL_ID}:${params.message.externalAgentId}`,
    conversationLabel: params.message.externalAgentId,
    rawBody: params.message.text,
    bodyForAgent: params.message.text,
    commandBody: params.message.text,
    messageId: params.message.externalMessageId,
    timestamp: Date.now(),
    provider: OMELINK_CHANNEL_ID,
    surface: OMELINK_CHANNEL_ID,
    originatingChannel: OMELINK_CHANNEL_ID,
    originatingTo: `${OMELINK_CHANNEL_ID}:${params.message.externalAgentId}`,
    extraContext: {
      ExternalMessageId: params.message.externalMessageId
    },
    deliver: async (payload) => {
      const text = typeof payload.text === "string" ? payload.text : undefined;
      if (!text?.trim()) {
        return;
      }

      const externalMessageId = buildOutboundMessageId();
      await sendOmelinkTextMessage({
        baseUrl: params.config.baseUrl,
        apiKey: params.config.apiKey,
        externalConversationId: params.message.externalAgentId,
        externalMessageId,
        text
      });
    },
    onRecordError: (err) => {
      params.log?.error?.(err instanceof Error ? err.message : String(err));
    },
    onDispatchError: (err, info) => {
      const message = err instanceof Error ? err.message : String(err);
      params.log?.error?.(`OMELINK inbound dispatch failed (${info.kind}): ${message}`);
    }
  });
}

function registerOmelinkWebhookRoute(params: {
  cfg: unknown;
  accountId: string;
  config: OmelinkConfig;
  log?: GatewayLog;
}): () => void {
  const handler = createOmelinkWebhookHandler({
    log: params.log,
    deliver: async (message) => {
      await dispatchInboundToOpenClaw({
        cfg: params.cfg,
        accountId: params.accountId,
        config: params.config,
        message,
        log: params.log
      });
    }
  });

  return registerPluginHttpRoute({
    path: params.config.webhookPath,
    auth: "gateway",
    pluginId: OMELINK_CHANNEL_ID,
    accountId: params.accountId,
    log: (message: string) => params.log?.info?.(message),
    handler
  });
}

function registerOmelinkAgentAdminRoute(params: {
  accountId: string;
  config: OmelinkConfig;
  log?: GatewayLog;
}): () => void {
  const handler = createOmelinkAgentAdminHandler({
    log: params.log
  });

  return registerPluginHttpRoute({
    path: params.config.agentsPath,
    auth: "gateway",
    pluginId: OMELINK_CHANNEL_ID,
    accountId: params.accountId,
    log: (message: string) => params.log?.info?.(message),
    handler
  });
}

function registerOmelinkConfigRoute(params: {
  accountId: string;
  log?: GatewayLog;
}): () => void {
  const handler = createOmelinkConfigHandler({
    log: params.log
  });

  return registerPluginHttpRoute({
    path: OMELINK_CONFIG_PATH,
    auth: "gateway",
    pluginId: OMELINK_CHANNEL_ID,
    accountId: params.accountId,
    log: (message: string) => params.log?.info?.(message),
    handler
  });
}

function registerOmelinkHeartbeatRoute(params: {
  accountId: string;
  log?: GatewayLog;
}): () => void {
  const handler = createOmelinkHeartbeatHandler();

  return registerPluginHttpRoute({
    path: OMELINK_HEARTBEAT_PATH,
    auth: "gateway",
    pluginId: OMELINK_CHANNEL_ID,
    accountId: params.accountId,
    log: (message: string) => params.log?.info?.(message),
    handler
  });
}

export const omelinkPlugin = createChatChannelPlugin({
  base: {
    id: OMELINK_CHANNEL_ID,
    meta: {
      id: OMELINK_CHANNEL_ID,
      label: "OMELINK",
      selectionLabel: "OMELINK",
      detailLabel: "OMELINK",
      docsPath: "/channels/omelink",
      blurb: "Connect OMELINK to OpenClaw",
      order: 120
    },
    capabilities: {
      chatTypes: ["direct"],
      media: false,
      threads: false,
      reactions: false,
      edit: false,
      unsend: false,
      reply: false,
      effects: false,
      blockStreaming: false
    },
    reload: {
      configPrefixes: [`channels.${OMELINK_CHANNEL_ID}`]
    },
    config: {
      listAccountIds: listOmelinkAccountIds,
      resolveAccount: resolveOmelinkAccount,
      defaultAccountId: () => DEFAULT_ACCOUNT_ID,
      isConfigured: (_account: ResolvedOmelinkAccount | undefined): boolean => true,
      isEnabled: (account: ResolvedOmelinkAccount | undefined): boolean =>
        account?.enabled !== false,
      describeAccount: (account: ResolvedOmelinkAccount | undefined) => ({
        accountId: account?.accountId ?? DEFAULT_ACCOUNT_ID,
        configured: true,
        enabled: account?.enabled !== false
      })
    },
    messaging: {
      targetPrefixes: ["omelink"],
      normalizeTarget,
      targetResolver: {
        looksLikeId: (id: string) => normalizeTarget(id) !== undefined,
        hint: ""
      },
      resolveOutboundSessionRoute: ({
        cfg,
        agentId,
        accountId,
        target
      }: {
        cfg: unknown;
        agentId: string;
        accountId?: string | null;
        target: string;
      }) =>
        buildChannelOutboundSessionRoute({
          cfg,
          agentId,
          channel: OMELINK_CHANNEL_ID,
          accountId: accountId ?? DEFAULT_ACCOUNT_ID,
          peer: {
            kind: "direct",
            id: normalizeTarget(target) ?? target
          },
          chatType: "direct",
          from: `${OMELINK_CHANNEL_ID}:${accountId ?? DEFAULT_ACCOUNT_ID}`,
          to: normalizeTarget(target) ?? target
        })
    },
    directory: createEmptyChannelDirectoryAdapter(),
    gateway: {
      startAccount: async (ctx: GatewayContext) => {
        const config = resolveOmelinkConfig(ctx.cfg);
        const accountId = ctx.accountId ?? DEFAULT_ACCOUNT_ID;
        ctx.log?.info?.(
          `Starting OMELINK channel (account: ${accountId}, path: ${config.webhookPath})`
        );
        const unregisterWebhook = registerOmelinkWebhookRoute({
          cfg: ctx.cfg,
          accountId,
          config,
          log: ctx.log
        });
        const unregisterAgentAdmin = registerOmelinkAgentAdminRoute({
          accountId,
          config,
          log: ctx.log
        });
        const unregisterConfig = registerOmelinkConfigRoute({
          accountId,
          log: ctx.log
        });
        const unregisterHeartbeat = registerOmelinkHeartbeatRoute({
          accountId,
          log: ctx.log
        });
        return waitUntilAbort(ctx.abortSignal, () => {
          ctx.log?.info?.(`Stopping OMELINK channel (account: ${accountId})`);
          unregisterWebhook();
          unregisterAgentAdmin();
          unregisterConfig();
          unregisterHeartbeat();
        });
      },
      stopAccount: async (ctx: GatewayContext) => {
        ctx.log?.info?.(`OMELINK account ${ctx.accountId ?? DEFAULT_ACCOUNT_ID} stopped`);
      }
    }
  },
  outbound: {
    base: {
      deliveryMode: "gateway",
      textChunkLimit: 4000
    },
    attachedResults: {
      channel: OMELINK_CHANNEL_ID,
      sendText
    }
  }
});
