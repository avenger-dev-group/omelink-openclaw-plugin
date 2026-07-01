import { copyFile, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";

import { OMELINK_CHANNEL_ID } from "./types.js";

const MAX_BODY_BYTES = 64 * 1024;

type OpenClawConfigFile = {
  channels?: Record<string, unknown>;
  [key: string]: unknown;
};

export type SetOmelinkConfigParams = {
  configPath?: string;
  apiHost?: string;
  apiKey?: string;
};

export type SetOmelinkConfigResult = {
  ok: true;
  updated: true;
  configPath: string;
  backupPath: string;
};

export class OmelinkConfigError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = "OmelinkConfigError";
  }
}

function respondJson(
  res: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;

    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new OmelinkConfigError("Request body too large", 413));
        req.destroy();
        return;
      }

      body += chunk.toString("utf8");
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new OmelinkConfigError("Invalid JSON body", 400);
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function resolveConfigPath(configPath?: string): string {
  return configPath?.trim() || path.join(homedir(), ".openclaw", "openclaw.json");
}

function parseOpenClawConfig(source: string): OpenClawConfigFile {
  try {
    return JSON.parse(source) as OpenClawConfigFile;
  } catch {
    const parsed = Function(`"use strict"; return (${source});`)() as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new OmelinkConfigError("OpenClaw config must be an object", 500);
    }
    return parsed as OpenClawConfigFile;
  }
}

async function writeConfigWithBackup(
  configPath: string,
  config: OpenClawConfigFile
): Promise<string> {
  const backupPath = `${configPath}.bak.omelink-config-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  await copyFile(configPath, backupPath);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return backupPath;
}

function normalizeRequestPayload(payload: unknown): SetOmelinkConfigParams {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new OmelinkConfigError("Invalid JSON body", 400);
  }

  const record = payload as Record<string, unknown>;
  const apiHost = readString(record, "apiHost");
  const apiKey = readString(record, "apiKey");
  if (!apiHost && !apiKey) {
    throw new OmelinkConfigError("Missing required field: apiHost or apiKey", 400);
  }

  return { apiHost, apiKey };
}

export async function setOmelinkConfig(
  params: SetOmelinkConfigParams
): Promise<SetOmelinkConfigResult> {
  const configPath = resolveConfigPath(params.configPath);
  const source = await readFile(configPath, "utf8");
  const config = parseOpenClawConfig(source);
  const channels =
    config.channels && typeof config.channels === "object" && !Array.isArray(config.channels)
      ? { ...config.channels }
      : {};
  const rawOmelink = channels[OMELINK_CHANNEL_ID];
  const omelink =
    rawOmelink && typeof rawOmelink === "object" && !Array.isArray(rawOmelink)
      ? { ...(rawOmelink as Record<string, unknown>) }
      : {};

  if (params.apiHost) {
    omelink.baseUrl = params.apiHost.trim();
  }
  if (params.apiKey) {
    omelink.apiKey = params.apiKey.trim();
  }
  delete omelink.webhookPath;
  delete omelink.agentsPath;
  channels[OMELINK_CHANNEL_ID] = omelink;

  const nextConfig: OpenClawConfigFile = {
    ...config,
    channels
  };
  const backupPath = await writeConfigWithBackup(configPath, nextConfig);

  return {
    ok: true,
    updated: true,
    configPath,
    backupPath
  };
}

export function createOmelinkConfigHandler(params: {
  configPath?: string;
  log?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const input = normalizeRequestPayload(parseJsonBody(await readRequestBody(req)));
      const result = await setOmelinkConfig({
        ...input,
        configPath: params.configPath
      });
      params.log?.info?.("Updated OMELINK channel config");
      respondJson(res, 200, {
        ok: true,
        updated: result.updated,
        restart_required: true
      });
    } catch (err) {
      const statusCode =
        err instanceof OmelinkConfigError ? err.statusCode : 500;
      const message = err instanceof Error ? err.message : String(err);
      params.log?.error?.(message);
      respondJson(res, statusCode, { error: message });
    }
  };
}
