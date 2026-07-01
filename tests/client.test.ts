import { afterEach, describe, expect, it, vi } from "vitest";

import { sendOmelinkTextMessage } from "../src/client.js";

describe("sendOmelinkTextMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts OpenClaw text replies to the OMELINK messages endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendOmelinkTextMessage({
      baseUrl: "https://api.omelink.test",
      apiKey: "secret-key",
      externalConversationId: "local-channel-xxx",
      externalMessageId: "openclaw-message-xxx",
      text: "Hello, how can I help you?"
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.omelink.test/api/external/openClaw/channel/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "secret-key"
        },
        body: JSON.stringify({
          omelink_conversation_id: "local-channel-xxx",
          open_claw_message_id: "openclaw-message-xxx",
          text: "Hello, how can I help you?"
        })
      }
    );
  });

  it("throws a readable error when the OMELINK endpoint returns a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad request", { status: 400, statusText: "Bad Request" }))
    );

    await expect(
      sendOmelinkTextMessage({
        baseUrl: "https://api.omelink.test/",
        externalConversationId: "local-channel-xxx",
        externalMessageId: "openclaw-message-xxx",
        text: "Hello"
      })
    ).rejects.toThrow(
      "OMELINK message delivery failed with HTTP 400 Bad Request: bad request"
    );
  });
});
