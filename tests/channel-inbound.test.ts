import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeHandlers = new Map<
  string,
  {
    auth?: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
  }
>();

const dispatchInboundDirectDmWithRuntime = vi.hoisted(() =>
  vi.fn(async () => ({
    route: {
      agentId: "agent-default",
      sessionKey: "route-session"
    },
    storePath: "/tmp/openclaw-session",
    ctxPayload: { Body: "hello" }
  }))
);

vi.mock("openclaw/plugin-sdk/account-id", () => ({
  DEFAULT_ACCOUNT_ID: "default"
}));

vi.mock("openclaw/plugin-sdk/channel-core", () => ({
  buildChannelOutboundSessionRoute: vi.fn((params) => params),
  createChatChannelPlugin: vi.fn((params) => params)
}));

vi.mock("openclaw/plugin-sdk/channel-lifecycle", () => ({
  waitUntilAbort: vi.fn(async () => undefined)
}));

vi.mock("openclaw/plugin-sdk/channel-inbound", () => ({
  dispatchInboundDirectDmWithRuntime
}));

vi.mock("openclaw/plugin-sdk/directory-runtime", () => ({
  createEmptyChannelDirectoryAdapter: vi.fn(() => ({}))
}));

vi.mock("openclaw/plugin-sdk/reply-payload", () => ({
  normalizeOutboundReplyPayload: vi.fn((payload) => ({
    text: typeof payload.text === "string" ? payload.text : undefined
  }))
}));

vi.mock("openclaw/plugin-sdk/webhook-ingress", () => ({
  registerPluginHttpRoute: vi.fn((params) => {
    routeHandlers.set(params.path, {
      auth: params.auth,
      handler: params.handler
    });
    return vi.fn();
  })
}));

vi.mock("openclaw/plugin-sdk/runtime-store", () => {
  let runtime: unknown;
  return {
    createPluginRuntimeStore: vi.fn(() => ({
      setRuntime: (nextRuntime: unknown) => {
        runtime = nextRuntime;
      },
      getRuntime: () => runtime
    }))
  };
});

class MockRequest extends EventEmitter {
  method = "POST";
  headers: IncomingHttpHeaders;

  constructor(body: string, headers: IncomingHttpHeaders = {}) {
    super();
    this.headers = headers;

    queueMicrotask(() => {
      this.emit("data", Buffer.from(body));
      this.emit("end");
    });
  }
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  body = "";

  writeHead(statusCode: number) {
    this.statusCode = statusCode;
    return this;
  }

  end(chunk?: string) {
    if (chunk) {
      this.body += chunk;
    }
    this.emit("finish");
    return this;
  }
}

async function postWebhook(path: string, body: unknown) {
  const route = routeHandlers.get(path);
  if (!route) {
    throw new Error(`No handler registered for ${path}`);
  }

  const req = new MockRequest(JSON.stringify(body), {
    "content-type": "application/json"
  }) as unknown as IncomingMessage;
  const res = new MockResponse() as unknown as ServerResponse;

  await route.handler(req, res);

  return res as unknown as MockResponse;
}

describe("omelink channel inbound gateway", () => {
  beforeEach(() => {
    routeHandlers.clear();
    dispatchInboundDirectDmWithRuntime.mockClear();
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => ""
      }))
    );
  });

  it("dispatches webhook messages through OpenClaw direct-DM runtime", async () => {
    const { omelinkPlugin } = await import("../src/channel.js");
    const { setOmelinkRuntime } = await import("../src/runtime.js");
    const resolveAgentRoute = vi.fn(() => ({
      agentId: "agent-default",
      sessionKey: "route-session"
    }));
    const resolveStorePath = vi.fn(() => "/tmp/openclaw-session");

    setOmelinkRuntime({
      channel: {
        routing: { resolveAgentRoute },
        session: {
          resolveStorePath,
          readSessionUpdatedAt: vi.fn(() => undefined),
          recordInboundSession: vi.fn()
        },
        reply: {
          finalizeInboundContext: vi.fn((ctx) => ctx),
          formatAgentEnvelope: vi.fn((params) => params.body),
          resolveEnvelopeFormatOptions: vi.fn(() => ({})),
          dispatchReplyWithBufferedBlockDispatcher: vi.fn()
        }
      },
      config: {
        current: () => ({
          channels: {
            "omelink": {
              baseUrl: "https://api.omelink.test",
              apiKey: "secret-key"
            }
          }
        })
      }
    });

    await omelinkPlugin.base.gateway.startAccount({
      cfg: {
        channels: {
          "omelink": {
            baseUrl: "https://api.omelink.test",
            apiKey: "secret-key"
          }
        }
      },
      accountId: "default",
      abortSignal: new AbortController().signal
    });

    expect(routeHandlers.has("/api/external/omelink/channel/agents")).toBe(true);
    expect(routeHandlers.has("/api/external/omelink/channel/config")).toBe(true);
    expect(routeHandlers.has("/api/external/omelink/channel/heartbeat")).toBe(true);
    expect(routeHandlers.get("/api/external/omelink/channel/inbound")?.auth).toBe("gateway");
    expect(routeHandlers.get("/api/external/omelink/channel/agents")?.auth).toBe("gateway");
    expect(routeHandlers.get("/api/external/omelink/channel/config")?.auth).toBe("gateway");
    expect(routeHandlers.get("/api/external/omelink/channel/heartbeat")?.auth).toBe("gateway");

    const response = await postWebhook("/api/external/omelink/channel/inbound", {
      omelink_agent_id: "local-agent-xxx",
      omelink_message_id: "im-message-001",
      text: "hello"
    });

    expect(response.statusCode).toBe(202);
    await new Promise((resolve) => setImmediate(resolve));
    expect(dispatchInboundDirectDmWithRuntime).toHaveBeenCalledOnce();
    expect(dispatchInboundDirectDmWithRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "omelink",
        channelLabel: "OMELINK",
        accountId: "default",
        peer: { kind: "direct", id: "local-agent-xxx" },
        senderId: "local-agent-xxx",
        senderAddress: "omelink:local-agent-xxx",
        recipientAddress: "omelink:local-agent-xxx",
        conversationLabel: "local-agent-xxx",
        rawBody: "hello",
        messageId: "im-message-001"
      })
    );
    expect(
      dispatchInboundDirectDmWithRuntime.mock.calls[0]?.[0].runtime.channel.routing
        .resolveAgentRoute
    ).toBe(resolveAgentRoute);
  });

  it("registers gateway routes when the OMELINK channel config is absent", async () => {
    const { omelinkPlugin } = await import("../src/channel.js");

    await omelinkPlugin.base.gateway.startAccount({
      cfg: {},
      accountId: "default",
      abortSignal: new AbortController().signal
    });

    expect(routeHandlers.get("/api/external/omelink/channel/inbound")?.auth).toBe(
      "gateway"
    );
    expect(routeHandlers.get("/api/external/omelink/channel/agents")?.auth).toBe(
      "gateway"
    );
    expect(routeHandlers.get("/api/external/omelink/channel/config")?.auth).toBe(
      "gateway"
    );
    expect(routeHandlers.get("/api/external/omelink/channel/heartbeat")?.auth).toBe(
      "gateway"
    );
  });

  it("posts OpenClaw replies directly to the OMELINK messages API", async () => {
    const { omelinkPlugin } = await import("../src/channel.js");
    const { setOmelinkRuntime } = await import("../src/runtime.js");
    dispatchInboundDirectDmWithRuntime.mockImplementationOnce(async (params) => {
      await params.deliver({ text: "OpenClaw reply" });
      return {
        route: {
          agentId: "agent-default",
          sessionKey: "route-session"
        },
        storePath: "/tmp/openclaw-session",
        ctxPayload: { Body: "hello" }
      };
    });

    setOmelinkRuntime({
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(() => ({
            agentId: "agent-default",
            sessionKey: "route-session"
          }))
        },
        session: {
          resolveStorePath: vi.fn(() => "/tmp/openclaw-session"),
          readSessionUpdatedAt: vi.fn(() => undefined),
          recordInboundSession: vi.fn()
        },
        reply: {
          finalizeInboundContext: vi.fn((ctx) => ctx),
          formatAgentEnvelope: vi.fn((params) => params.body),
          resolveEnvelopeFormatOptions: vi.fn(() => ({})),
          dispatchReplyWithBufferedBlockDispatcher: vi.fn()
        }
      }
    });

    await omelinkPlugin.base.gateway.startAccount({
      cfg: {
        channels: {
          "omelink": {
            baseUrl: "https://api.omelink.test",
            apiKey: "secret-key"
          }
        }
      },
      accountId: "default",
      abortSignal: new AbortController().signal
    });

    const response = await postWebhook("/api/external/omelink/channel/inbound", {
      omelink_agent_id: "local-agent-xxx",
      omelink_message_id: "im-message-002",
      text: "hello"
    });

    expect(response.statusCode).toBe(202);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.omelink.test/api/external/openClaw/channel/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "secret-key"
        },
        body: expect.stringContaining('"omelink_conversation_id":"local-agent-xxx"')
      })
    );
  });
});
