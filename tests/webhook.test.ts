import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { createOmelinkWebhookHandler } from "../src/webhook.js";

class MockRequest extends EventEmitter {
  method = "POST";
  url = "/api/external/openClaw/channel/inbound";
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
  headers: Record<string, string> = {};
  body = "";

  writeHead(statusCode: number, headers: Record<string, string> = {}) {
    this.statusCode = statusCode;
    this.headers = headers;
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

async function invokeHandler(params: {
  body: unknown;
  deliver?: ReturnType<typeof vi.fn>;
  log?: Parameters<typeof createOmelinkWebhookHandler>[0]["log"];
}) {
  const deliver = params.deliver ?? vi.fn(async () => undefined);
  const handler = createOmelinkWebhookHandler({
    deliver,
    log: params.log
  });
  const req = new MockRequest(JSON.stringify(params.body), {
    "content-type": "application/json"
  }) as unknown as IncomingMessage;
  const res = new MockResponse() as unknown as ServerResponse;

  await handler(req, res);

  return {
    deliver,
    response: res as unknown as MockResponse
  };
}

describe("createOmelinkWebhookHandler", () => {
  it("accepts valid webhook payloads and delivers normalized inbound messages", async () => {
    const { deliver, response } = await invokeHandler({
      body: {
        omelink_conversation_id: "local-channel-xxx",
        omelink_message_id: "im-message-xxx",
        text: "hello"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith({
      externalConversationId: "local-channel-xxx",
      externalMessageId: "im-message-xxx",
      text: "hello"
    });
  });

  it("rejects payloads missing required fields with 400", async () => {
    const { deliver, response } = await invokeHandler({
      body: {
        omelink_conversation_id: "local-channel-xxx",
        text: "hello"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: "Missing required fields: omelink_message_id"
    });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("does not deliver duplicate external message IDs within the dedupe window", async () => {
    const deliver = vi.fn(async () => undefined);
    const handler = createOmelinkWebhookHandler({
      dedupeTtlMs: 60_000,
      deliver
    });
    const body = {
      omelink_conversation_id: "local-channel-xxx",
      omelink_message_id: "im-message-xxx",
      text: "hello"
    };

    for (let i = 0; i < 2; i += 1) {
      const req = new MockRequest(JSON.stringify(body), {
        "content-type": "application/json"
      }) as unknown as IncomingMessage;
      const res = new MockResponse() as unknown as ServerResponse;

      await handler(req, res);

      const response = res as unknown as MockResponse;
      expect(response.statusCode).toBe(i === 0 ? 202 : 200);
      expect(JSON.parse(response.body)).toEqual(
        i === 0 ? { ok: true } : { ok: true, duplicate: true }
      );
    }

    expect(deliver).toHaveBeenCalledOnce();
  });

  it("acknowledges accepted webhook messages even when background delivery fails", async () => {
    const error = new Error("reply delivery failed");
    const deliver = vi.fn(async () => {
      throw error;
    });
    const log = {
      error: vi.fn()
    };

    const { response } = await invokeHandler({
      deliver,
      log,
      body: {
        omelink_conversation_id: "local-channel-xxx",
        omelink_message_id: "im-message-async-fail",
        text: "hello"
      }
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(deliver).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledWith("reply delivery failed");
  });
});
