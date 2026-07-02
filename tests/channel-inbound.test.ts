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

  it("dispatches webhook messages through OpenClaw channel.inbound runtime", async () => {
    const { omelinkPlugin } = await import("../src/channel.js");
    const { setOmelinkRuntime } = await import("../src/runtime.js");
    const buildContext = vi.fn(() => ({ Body: "hello" }));
    const run = vi.fn(async (params) => {
      await params.adapter.resolveTurn({
        timestamp: Date.now(),
        rawText: "hello",
        textForAgent: "hello",
        textForCommands: "hello",
        raw: params.raw
      });
    });
    const resolveAgentRoute = vi.fn(() => ({
      agentId: "agent-default",
      sessionKey: "route-session"
    }));
    const resolveStorePath = vi.fn(() => "/tmp/openclaw-session");

    setOmelinkRuntime({
      channel: {
        routing: { resolveAgentRoute },
        inbound: { buildContext, run },
        session: { resolveStorePath, recordInboundSession: vi.fn() },
        reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() }
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

    expect(routeHandlers.has("/api/external/openClaw/channel/agents")).toBe(true);
    expect(routeHandlers.has("/api/external/openClaw/channel/config")).toBe(true);
    expect(routeHandlers.get("/api/external/openClaw/channel/inbound")?.auth).toBe("gateway");
    expect(routeHandlers.get("/api/external/openClaw/channel/agents")?.auth).toBe("gateway");
    expect(routeHandlers.get("/api/external/openClaw/channel/config")?.auth).toBe("gateway");

    const response = await postWebhook("/api/external/openClaw/channel/inbound", {
      omelink_conversation_id: "local-channel-xxx",
      omelink_message_id: "im-message-001",
      text: "hello"
    });

    expect(response.statusCode).toBe(202);
    expect(buildContext).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "omelink",
        accountId: "default",
        peer: { kind: "direct", id: "local-channel-xxx" }
      })
    );
  });

  it("posts OpenClaw replies directly to the OMELINK messages API", async () => {
    const { omelinkPlugin } = await import("../src/channel.js");
    const { setOmelinkRuntime } = await import("../src/runtime.js");
    const run = vi.fn(async (params) => {
      const turn = await params.adapter.resolveTurn({
        timestamp: Date.now(),
        rawText: "hello",
        textForAgent: "hello",
        textForCommands: "hello",
        raw: params.raw
      });

      if (turn.delivery.durable) {
        return;
      }

      await turn.delivery.deliver({ text: "OpenClaw reply" }, { kind: "final" });
    });

    setOmelinkRuntime({
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(() => ({
            agentId: "agent-default",
            sessionKey: "route-session"
          }))
        },
        inbound: {
          buildContext: vi.fn(() => ({ Body: "hello" })),
          run
        },
        session: {
          resolveStorePath: vi.fn(() => "/tmp/openclaw-session"),
          recordInboundSession: vi.fn()
        },
        reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() }
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

    const response = await postWebhook("/api/external/openClaw/channel/inbound", {
      omelink_conversation_id: "local-channel-xxx",
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
        body: expect.stringContaining('"omelink_conversation_id":"local-channel-xxx"')
      })
    );
  });
});
