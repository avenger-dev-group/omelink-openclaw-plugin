import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import {
  buildChannelOutboundSessionRoute,
  createChatChannelPlugin
} from "openclaw/plugin-sdk/channel-core";
import { waitUntilAbort } from "openclaw/plugin-sdk/channel-lifecycle";
import type { OutboundDeliveryResult } from "openclaw/plugin-sdk/channel-send-result";
import { createEmptyChannelDirectoryAdapter } from "openclaw/plugin-sdk/directory-runtime";
import { normalizeOutboundReplyPayload } from "openclaw/plugin-sdk/reply-payload";
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
      inbound?: {
        run?: (params: unknown) => Promise<unknown>;
        buildContext?: (params: unknown) => unknown;
      };
      session?: {
        resolveStorePath?: (store: unknown, params: unknown) => string;
        recordInboundSession?: unknown;
      };
      reply?: {
        dispatchReplyWithBufferedBlockDispatcher?: unknown;
      };
    };
    config?: {
      current?: () => unknown;
    };
  };

  const currentCfg = rt.config?.current?.() ?? params.cfg;
  const route = rt.channel?.routing?.resolveAgentRoute?.({
    cfg: currentCfg,
    channel: OMELINK_CHANNEL_ID,
    accountId: params.accountId,
    peer: {
      kind: "direct",
      id: params.message.externalConversationId
    }
  });

  if (!route || !rt.channel?.inbound?.run || !rt.channel.inbound.buildContext) {
    throw new Error("OpenClaw channel runtime is missing inbound event support");
  }

  const routeSessionKey =
    route.sessionKey ??
    `${OMELINK_CHANNEL_ID}:${params.accountId}:${route.agentId}:${params.message.externalConversationId}`;
  return await rt.channel.inbound.run({
    channel: OMELINK_CHANNEL_ID,
    accountId: params.accountId,
    raw: params.message,
    adapter: {
      ingest: (message: OmelinkInboundMessage) => ({
        id: message.externalMessageId,
        timestamp: Date.now(),
        rawText: message.text,
        textForAgent: message.text,
        textForCommands: message.text,
        raw: message
      }),
      resolveTurn: () => ({
        cfg: currentCfg,
        channel: OMELINK_CHANNEL_ID,
        accountId: params.accountId,
        agentId: route.agentId,
        routeSessionKey,
        storePath: rt.channel?.session?.resolveStorePath?.(
          (currentCfg as { session?: { store?: unknown } })?.session?.store,
          { agentId: route.agentId }
        ),
        ctxPayload: rt.channel?.inbound?.buildContext?.({
          channel: OMELINK_CHANNEL_ID,
          accountId: params.accountId,
          timestamp: Date.now(),
          from: `${OMELINK_CHANNEL_ID}:${params.message.externalConversationId}`,
          sender: {
            id: params.message.externalConversationId,
            name: params.message.externalConversationId
          },
          conversation: {
            kind: "direct",
            id: params.message.externalConversationId,
            label: params.message.externalConversationId,
            routePeer: {
              kind: "direct",
              id: params.message.externalConversationId
            }
          },
          route: {
            agentId: route.agentId,
            accountId: params.accountId,
            routeSessionKey,
            dispatchSessionKey: routeSessionKey
          },
          reply: {
            to: `${OMELINK_CHANNEL_ID}:${params.message.externalConversationId}`,
            originatingTo: `${OMELINK_CHANNEL_ID}:${params.message.externalConversationId}`
          },
          message: {
            rawBody: params.message.text,
            commandBody: params.message.text,
            bodyForAgent: params.message.text,
            envelopeFrom: params.message.externalConversationId
          },
          extra: {
            ExternalMessageId: params.message.externalMessageId
          }
        }),
        recordInboundSession: rt.channel?.session?.recordInboundSession,
        dispatchReplyWithBufferedBlockDispatcher:
          rt.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher,
        delivery: {
          preparePayload: (payload: unknown) =>
            payload && typeof payload === "object"
              ? normalizeOutboundReplyPayload(payload as Record<string, unknown>)
              : {},
          deliver: async (payload: unknown) => {
            const normalized =
              payload && typeof payload === "object"
                ? normalizeOutboundReplyPayload(payload as Record<string, unknown>)
                : {};
            const text = normalized.text;
            if (!text?.trim()) {
              return { visibleReplySent: false };
            }

            const externalMessageId = buildOutboundMessageId();
            await sendOmelinkTextMessage({
              baseUrl: params.config.baseUrl,
              apiKey: params.config.apiKey,
              externalConversationId: params.message.externalConversationId,
              externalMessageId,
              text
            });
            return {
              messageIds: [externalMessageId],
              visibleReplySent: true
            };
          },
          onError: (error: unknown) => {
            throw error instanceof Error
              ? error
              : new Error(`OMELINK reply delivery failed: ${String(error)}`);
          }
        }
      })
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
