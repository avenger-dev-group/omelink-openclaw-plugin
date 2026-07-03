import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { OMELINK_CHANNEL_ID } from "./types.js";
const MAX_BODY_BYTES = 64 * 1024;
const SAFE_AGENT_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const DM_SCOPE = "per-channel-peer";
const DEFAULT_ACCOUNT_ID = "default";
export class OmelinkAgentAdminError extends Error {
    statusCode;
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
        this.name = "OmelinkAgentAdminError";
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
                reject(new OmelinkAgentAdminError("Request body too large", 413));
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
        throw new OmelinkAgentAdminError("Invalid JSON body", 400);
    }
}
function readString(record, key) {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}
function normalizeAgentId(value) {
    const agentId = value.trim();
    if (!SAFE_AGENT_ID_RE.test(agentId)) {
        throw new OmelinkAgentAdminError("agent_id must match ^[a-z][a-z0-9_-]{0,63}$", 400);
    }
    if (agentId === "main") {
        throw new OmelinkAgentAdminError('agent_id "main" is reserved', 400);
    }
    return agentId;
}
function resolveConfigPath(configPath) {
    return configPath?.trim() || path.join(homedir(), ".openclaw", "openclaw.json");
}
function defaultAgentWorkspace(agentId) {
    return path.join(homedir(), ".openclaw", "agents", agentId, "workspace");
}
function defaultAgentDir(agentId) {
    return path.join(homedir(), ".openclaw", "agents", agentId, "agent");
}
function parseOpenClawConfig(source) {
    try {
        return JSON.parse(source);
    }
    catch {
        const parsed = Function(`"use strict"; return (${source});`)();
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
            throw new OmelinkAgentAdminError("OpenClaw config must be an object", 500);
        }
        return parsed;
    }
}
async function writeConfigWithBackup(configPath, config) {
    const backupPath = `${configPath}.bak.omelink-agent-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}`;
    await copyFile(configPath, backupPath);
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return backupPath;
}
function isRouteBinding(value) {
    return (Boolean(value) &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        value.type === "route");
}
function findAgent(agents, agentId) {
    return agents.find((entry) => entry.id === agentId);
}
function buildBinding(params) {
    return {
        type: "route",
        agentId: params.agentId,
        match: {
            channel: OMELINK_CHANNEL_ID,
            accountId: DEFAULT_ACCOUNT_ID,
            peer: {
                kind: "direct",
                id: params.externalAgentId
            }
        },
        session: {
            dmScope: DM_SCOPE
        }
    };
}
function sameOmelinkPeerBinding(binding, externalAgentId) {
    return (binding.match.channel === OMELINK_CHANNEL_ID &&
        (binding.match.accountId ?? DEFAULT_ACCOUNT_ID) === DEFAULT_ACCOUNT_ID &&
        binding.match.peer?.kind === "direct" &&
        binding.match.peer.id === externalAgentId);
}
function applyAgentToConfig(params) {
    const agentId = normalizeAgentId(params.input.agentId);
    const workspace = params.input.workspace?.trim() || defaultAgentWorkspace(agentId);
    const agentDir = params.input.agentDir?.trim() || defaultAgentDir(agentId);
    const existing = findAgent(params.agents, agentId);
    const created = !existing;
    const nextAgent = {
        ...(existing ?? { id: agentId }),
        ...(params.input.name?.trim() ? { name: params.input.name.trim() } : {}),
        workspace,
        agentDir,
        ...(params.input.model?.trim() ? { model: params.input.model.trim() } : {})
    };
    if (existing) {
        params.agents[params.agents.indexOf(existing)] = nextAgent;
    }
    else {
        params.agents.push(nextAgent);
    }
    let bound = false;
    const externalAgentId = params.input.externalAgentId?.trim();
    if (externalAgentId) {
        const existingBinding = params.bindings.find((binding) => isRouteBinding(binding) && sameOmelinkPeerBinding(binding, externalAgentId));
        if (existingBinding && existingBinding.agentId !== agentId) {
            throw new OmelinkAgentAdminError(`omelink_agent_id "${externalAgentId}" is already bound to agent "${existingBinding.agentId}"`, 409);
        }
        if (!existingBinding) {
            params.bindings.push(buildBinding({ agentId, externalAgentId }));
            bound = true;
        }
    }
    return {
        agentId,
        created,
        bound,
        workspace,
        agentDir
    };
}
function assertNoDuplicateAgentIds(agents) {
    const seen = new Set();
    for (const agent of agents) {
        const agentId = normalizeAgentId(agent.agentId);
        if (seen.has(agentId)) {
            throw new OmelinkAgentAdminError(`Duplicate agent_id: ${agentId}`, 400);
        }
        seen.add(agentId);
    }
}
export async function createOrBindOmelinkAgents(params) {
    if (params.agents.length === 0) {
        throw new OmelinkAgentAdminError("agents must be a non-empty array", 400);
    }
    assertNoDuplicateAgentIds(params.agents);
    const configPath = resolveConfigPath(params.configPath);
    const source = await readFile(configPath, "utf8");
    const config = parseOpenClawConfig(source);
    const agents = Array.isArray(config.agents?.list) ? [...config.agents.list] : [];
    const bindings = Array.isArray(config.bindings) ? [...config.bindings] : [];
    const results = params.agents.map((input) => applyAgentToConfig({
        agents,
        bindings,
        input
    }));
    const nextConfig = {
        ...config,
        agents: {
            ...config.agents,
            list: agents
        },
        session: {
            ...config.session,
            dmScope: !config.session?.dmScope || config.session.dmScope === "main"
                ? DM_SCOPE
                : config.session.dmScope
        },
        ...(bindings.length > 0 ? { bindings } : {})
    };
    await Promise.all(results.flatMap((result) => [
        mkdir(result.workspace, { recursive: true }),
        mkdir(result.agentDir, { recursive: true })
    ]));
    const backupPath = await writeConfigWithBackup(configPath, nextConfig);
    return {
        ok: true,
        agents: results,
        dmScope: String(nextConfig.session?.dmScope ?? DM_SCOPE),
        configPath,
        backupPath
    };
}
export async function createOrBindOmelinkAgent(params) {
    const result = await createOrBindOmelinkAgents({
        configPath: params.configPath,
        agents: [params]
    });
    const agent = result.agents[0];
    if (!agent) {
        throw new OmelinkAgentAdminError("agents must be a non-empty array", 400);
    }
    return {
        ok: true,
        agentId: agent.agentId,
        created: agent.created,
        bound: agent.bound,
        dmScope: result.dmScope,
        configPath: result.configPath,
        backupPath: result.backupPath,
        workspace: agent.workspace,
        agentDir: agent.agentDir
    };
}
function normalizeRequestAgent(record) {
    const agentId = readString(record, "agent_id");
    if (!agentId) {
        throw new OmelinkAgentAdminError("Missing required field: agent_id", 400);
    }
    return {
        agentId,
        name: readString(record, "name"),
        externalAgentId: readString(record, "omelink_agent_id"),
        model: readString(record, "model"),
        workspace: readString(record, "workspace"),
        agentDir: readString(record, "agent_dir")
    };
}
function normalizeRequestPayload(payload) {
    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
        throw new OmelinkAgentAdminError("Invalid JSON body", 400);
    }
    const record = payload;
    if (!("agents" in record)) {
        throw new OmelinkAgentAdminError("Missing required field: agents", 400);
    }
    if (!Array.isArray(record.agents) || record.agents.length === 0) {
        throw new OmelinkAgentAdminError("agents must be a non-empty array", 400);
    }
    return record.agents.map((agent) => {
        if (!agent || Array.isArray(agent) || typeof agent !== "object") {
            throw new OmelinkAgentAdminError("agents[] entries must be objects", 400);
        }
        return normalizeRequestAgent(agent);
    });
}
function serializeAgentResult(result) {
    return {
        agent_id: result.agentId,
        created: result.created,
        bound: result.bound,
        workspace: result.workspace,
        agent_dir: result.agentDir
    };
}
export function createOmelinkAgentAdminHandler(params) {
    return async (req, res) => {
        if (req.method !== "POST") {
            respondJson(res, 405, { error: "Method not allowed" });
            return;
        }
        try {
            const input = normalizeRequestPayload(parseJsonBody(await readRequestBody(req)));
            const result = await createOrBindOmelinkAgents({
                agents: input,
                configPath: params.configPath
            });
            params.log?.info?.(`Created or updated OMELINK agents ${result.agents
                .map((agent) => agent.agentId)
                .join(", ")}`);
            respondJson(res, result.agents.some((agent) => agent.created) ? 201 : 200, {
                ok: true,
                agents: result.agents.map(serializeAgentResult),
                dm_scope: result.dmScope,
                restart_required: true
            });
        }
        catch (err) {
            const statusCode = err instanceof OmelinkAgentAdminError ? err.statusCode : 500;
            const message = err instanceof Error ? err.message : String(err);
            params.log?.error?.(message);
            respondJson(res, statusCode, { error: message });
        }
    };
}
