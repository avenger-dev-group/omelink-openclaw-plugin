import { copyFile, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { OMELINK_CHANNEL_ID } from "./types.js";
const MAX_BODY_BYTES = 64 * 1024;
export class OmelinkConfigError extends Error {
    statusCode;
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
        this.name = "OmelinkConfigError";
    }
}
function respondJson(res, statusCode, body) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        let bytes = 0;
        req.on("data", (chunk) => {
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
function parseJsonBody(body) {
    try {
        return JSON.parse(body);
    }
    catch {
        throw new OmelinkConfigError("Invalid JSON body", 400);
    }
}
function readString(record, key) {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}
function resolveConfigPath(configPath) {
    return configPath?.trim() || path.join(homedir(), ".openclaw", "openclaw.json");
}
function parseOpenClawConfig(source) {
    try {
        return JSON.parse(source);
    }
    catch {
        const parsed = Function(`"use strict"; return (${source});`)();
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
            throw new OmelinkConfigError("OpenClaw config must be an object", 500);
        }
        return parsed;
    }
}
async function writeConfigWithBackup(configPath, config) {
    const backupPath = `${configPath}.bak.omelink-config-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}`;
    await copyFile(configPath, backupPath);
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return backupPath;
}
function normalizeRequestPayload(payload) {
    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
        throw new OmelinkConfigError("Invalid JSON body", 400);
    }
    const record = payload;
    const apiHost = readString(record, "apiHost");
    const apiKey = readString(record, "apiKey");
    if (!apiHost && !apiKey) {
        throw new OmelinkConfigError("Missing required field: apiHost or apiKey", 400);
    }
    return { apiHost, apiKey };
}
export async function setOmelinkConfig(params) {
    const configPath = resolveConfigPath(params.configPath);
    const source = await readFile(configPath, "utf8");
    const config = parseOpenClawConfig(source);
    const channels = config.channels && typeof config.channels === "object" && !Array.isArray(config.channels)
        ? { ...config.channels }
        : {};
    const rawOmelink = channels[OMELINK_CHANNEL_ID];
    const omelink = rawOmelink && typeof rawOmelink === "object" && !Array.isArray(rawOmelink)
        ? { ...rawOmelink }
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
    const nextConfig = {
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
export function createOmelinkConfigHandler(params) {
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
        }
        catch (err) {
            const statusCode = err instanceof OmelinkConfigError ? err.statusCode : 500;
            const message = err instanceof Error ? err.message : String(err);
            params.log?.error?.(message);
            respondJson(res, statusCode, { error: message });
        }
    };
}
