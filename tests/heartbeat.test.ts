import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { createOmelinkHeartbeatHandler } from "../src/heartbeat.js";

class MockRequest extends EventEmitter {
  headers: IncomingHttpHeaders = {};

  constructor(readonly method = "GET") {
    super();

    queueMicrotask(() => {
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

async function invokeHandler(method = "GET") {
  const handler = createOmelinkHeartbeatHandler();
  const req = new MockRequest(method) as unknown as IncomingMessage;
  const res = new MockResponse() as unknown as ServerResponse;

  await handler(req, res);

  return res as unknown as MockResponse;
}

describe("createOmelinkHeartbeatHandler", () => {
  it("responds to GET requests with plugin health details", async () => {
    const response = await invokeHandler();

    expect(response.statusCode).toBe(200);
    expect(response.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      plugin: "omelink"
    });
  });

  it("rejects non-GET requests with 405", async () => {
    const response = await invokeHandler("POST");

    expect(response.statusCode).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: "Method not allowed"
    });
  });
});
