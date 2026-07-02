import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("openclaw.plugin.json", () => {
  it("declares OMELINK channel config metadata for cold OpenClaw discovery", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve("openclaw.plugin.json"), "utf8")
    ) as {
      activation?: { onStartup?: boolean };
      channelConfigs?: Record<string, { schema?: unknown; label?: string }>;
    };

    expect(manifest.activation?.onStartup).toBe(true);

    const channelConfig = manifest.channelConfigs?.["omelink"] as {
      schema?: {
        properties?: Record<string, unknown>;
      };
    } | undefined;

    expect(channelConfig).toMatchObject({
      label: "OMELINK",
      description: "Text-only OMELINK channel integration.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          baseUrl: {
            type: "string",
            default: ""
          },
          apiKey: {
            type: "string"
          }
        }
      }
    });
    expect(channelConfig?.schema?.properties).not.toHaveProperty("webhookPath");
    expect(channelConfig?.schema?.properties).not.toHaveProperty("agentsPath");
  });
});
