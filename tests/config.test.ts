import { afterEach, describe, expect, it } from "vitest";

import { resolveOmelinkConfig } from "../src/config.js";
import { DEFAULT_OMELINK_BASE_URL } from "../src/types.js";

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

  it("uses the default baseUrl and ignores OMELINK environment variables", () => {
    process.env.OMELINK_BASE_URL = "http://env.example.test";
    process.env.OMELINK_WEBHOOK_PATH = "/env/inbound";

    expect(
      resolveOmelinkConfig({
        channels: {
          "omelink": {}
        }
      })
    ).toMatchObject({
      baseUrl: DEFAULT_OMELINK_BASE_URL,
      apiKey: undefined
    });
  });

  it("uses the default baseUrl when channels.omelink is not configured", () => {
    expect(resolveOmelinkConfig({})).toMatchObject({
      baseUrl: DEFAULT_OMELINK_BASE_URL
    });
  });

  it("uses the default baseUrl when channels.omelink.baseUrl is blank", () => {
    expect(
      resolveOmelinkConfig({
        channels: {
          "omelink": {
            baseUrl: "   "
          }
        }
      })
    ).toMatchObject({
      baseUrl: DEFAULT_OMELINK_BASE_URL
    });
  });
});
