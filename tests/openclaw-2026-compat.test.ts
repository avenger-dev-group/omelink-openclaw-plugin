import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const OPENCLAW_2026_5_6_PLUGIN_SDK_EXPORTS = new Set([
  "openclaw/plugin-sdk/account-id",
  "openclaw/plugin-sdk/channel-core",
  "openclaw/plugin-sdk/channel-lifecycle",
  "openclaw/plugin-sdk/channel-send-result",
  "openclaw/plugin-sdk/directory-runtime",
  "openclaw/plugin-sdk/reply-payload",
  "openclaw/plugin-sdk/webhook-ingress"
]);

function readOpenClawPluginSdkImports(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  return [...source.matchAll(/from\s+["'](openclaw\/plugin-sdk\/[^"']+)["']/g)].map(
    (match) => match[1]
  );
}

describe("OpenClaw 2026.5.6 compatibility", () => {
  it("uses only channel SDK subpaths exported by OpenClaw 2026.5.6", () => {
    const imports = readOpenClawPluginSdkImports(path.resolve("src/channel.ts"));
    const unsupportedImports = imports.filter(
      (specifier) => !OPENCLAW_2026_5_6_PLUGIN_SDK_EXPORTS.has(specifier)
    );

    expect(unsupportedImports).toEqual([]);
  });
});
