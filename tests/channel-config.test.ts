import { describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/account-id", () => ({
  DEFAULT_ACCOUNT_ID: "default"
}));

const { listOmelinkAccountIds, resolveOmelinkAccount } = await import(
  "../src/channel-config.js"
);

describe("OMELINK channel config adapter", () => {
  it("exposes one default account for OpenClaw channel registration", () => {
    expect(listOmelinkAccountIds()).toEqual(["default"]);
  });

  it("resolves the default account from channels.omelink config", () => {
    expect(
      resolveOmelinkAccount({
        channels: {
          "omelink": {
            baseUrl: "https://api.omelink.test",
            apiKey: "config-api-key"
          }
        }
      })
    ).toEqual({
      accountId: "default",
      enabled: true,
      baseUrl: "https://api.omelink.test",
      apiKey: "config-api-key",
      webhookPath: "/api/external/openClaw/channel/inbound",
      agentsPath: "/api/external/openClaw/channel/agents"
    });
  });
});
