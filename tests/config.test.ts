import { afterEach, describe, expect, it } from "vitest";

import { resolveOmelinkConfig } from "../src/config.js";

describe("resolveOmelinkConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reads Omelink settings from OpenClaw channel config", () => {
    const config = resolveOmelinkConfig({
      channels: {
        "omelink": {
          baseUrl: "http://im.example.test",
          apiKey: "config-api-key"
        }
      }
    });

    expect(config).toEqual({
      baseUrl: "http://im.example.test",
      apiKey: "config-api-key",
      webhookPath: "/api/external/openClaw/channel/inbound",
      agentsPath: "/api/external/openClaw/channel/agents"
    });
  });

  it("requires channels.omelink.baseUrl and ignores OMELINK environment variables", () => {
    process.env.OMELINK_BASE_URL = "http://env.example.test";
    process.env.OMELINK_WEBHOOK_PATH = "/env/inbound";

    expect(() =>
      resolveOmelinkConfig({
        channels: {
          "omelink": {}
        }
      })
    ).toThrow("channels.omelink.baseUrl is required");
  });

  it("requires channels.omelink.baseUrl when channels.omelink is not configured", () => {
    expect(() => resolveOmelinkConfig({})).toThrow(
      "channels.omelink.baseUrl is required"
    );
  });
});
