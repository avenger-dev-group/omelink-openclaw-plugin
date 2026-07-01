import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";

import { OMELINK_CHANNEL_ID } from "./types.js";

const MAX_BODY_BYTES = 64 * 1024;
const SAFE_AGENT_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const DM_SCOPE = "per-channel-peer";
const DEFAULT_ACCOUNT_ID = "default";

type RouteBinding = {
  type: "route";
  agentId: string;
  match: {
    channel: string;
    accountId?: string;
    peer?: {
      kind: "direct";
      id: string;
    };
  };
  session?: {
    dmScope?: string;
  };
};

type AgentEntry = {
  id: string;
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: string;
};

type OpenClawConfigFile = {
  agents?: {
    defaults?: Record<string, unknown>;
    list?: AgentEntry[];
  };
  bindings?: Array<RouteBinding | Record<string, unknown>>;
  session?: Record<string, unknown> & {
    dmScope?: string;
  };
  [key: string]: unknown;
};

export type CreateOmelinkAgentParams = {
  configPath?: string;
  agentId: string;
  name?: string;
  externalConversationId?: string;
  model?: string;
  workspace?: string;
  agentDir?: string;
};

export type CreateOmelinkAgentResult = {
  ok: true;
  agentId: string;
  created: boolean;
  bound: boolean;
  dmScope: string;
  configPath: string;
  backupPath: string;
  workspace: string;
  agentDir: string;
};

export class OmelinkAgentAdminError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = "OmelinkAgentAdminError";
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

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new OmelinkAgentAdminError("Invalid JSON body", 400);
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeAgentId(value: string): string {
  const agentId = value.trim();
  if (!SAFE_AGENT_ID_RE.test(agentId)) {
    throw new OmelinkAgentAdminError(
      "agent_id must match ^[a-z][a-z0-9_-]{0,63}$",
      400
    );
  }

  if (agentId === "main") {
    throw new OmelinkAgentAdminError('agent_id "main" is reserved', 400);
  }

  return agentId;
}

function resolveConfigPath(configPath?: string): string {
  return configPath?.trim() || path.join(homedir(), ".openclaw", "openclaw.json");
}

function defaultAgentWorkspace(agentId: string): string {
  return path.join(homedir(), ".openclaw", "agents", agentId, "workspace");
}

function defaultAgentDir(agentId: string): string {
  return path.join(homedir(), ".openclaw", "agents", agentId, "agent");
}

function parseOpenClawConfig(source: string): OpenClawConfigFile {
  try {
    return JSON.parse(source) as OpenClawConfigFile;
  } catch {
    const parsed = Function(`"use strict"; return (${source});`)() as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new OmelinkAgentAdminError("OpenClaw config must be an object", 500);
    }
    return parsed as OpenClawConfigFile;
  }
}

async function writeConfigWithBackup(configPath: string, config: OpenClawConfigFile): Promise<string> {
  const backupPath = `${configPath}.bak.omelink-agent-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  await copyFile(configPath, backupPath);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return backupPath;
}

function isRouteBinding(value: unknown): value is RouteBinding {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "route"
  );
}

function findAgent(agents: AgentEntry[], agentId: string): AgentEntry | undefined {
  return agents.find((entry) => entry.id === agentId);
}

function buildBinding(params: {
  agentId: string;
  externalConversationId: string;
}): RouteBinding {
  return {
    type: "route",
    agentId: params.agentId,
    match: {
      channel: OMELINK_CHANNEL_ID,
      accountId: DEFAULT_ACCOUNT_ID,
      peer: {
        kind: "direct",
        id: params.externalConversationId
      }
    },
    session: {
      dmScope: DM_SCOPE
    }
  };
}

function sameOmelinkPeerBinding(binding: RouteBinding, externalConversationId: string): boolean {
  return (
    binding.match.channel === OMELINK_CHANNEL_ID &&
    (binding.match.accountId ?? DEFAULT_ACCOUNT_ID) === DEFAULT_ACCOUNT_ID &&
    binding.match.peer?.kind === "direct" &&
    binding.match.peer.id === externalConversationId
  );
}

export async function createOrBindOmelinkAgent(
  params: CreateOmelinkAgentParams
): Promise<CreateOmelinkAgentResult> {
  const configPath = resolveConfigPath(params.configPath);
  const agentId = normalizeAgentId(params.agentId);
  const workspace = params.workspace?.trim() || defaultAgentWorkspace(agentId);
  const agentDir = params.agentDir?.trim() || defaultAgentDir(agentId);
  const source = await readFile(configPath, "utf8");
  const config = parseOpenClawConfig(source);

  const agents = Array.isArray(config.agents?.list) ? [...config.agents.list] : [];
  const existing = findAgent(agents, agentId);
  const created = !existing;
  const nextAgent: AgentEntry = {
    ...(existing ?? { id: agentId }),
    ...(params.name?.trim() ? { name: params.name.trim() } : {}),
    workspace,
    agentDir,
    ...(params.model?.trim() ? { model: params.model.trim() } : {})
  };

  if (existing) {
    agents[agents.indexOf(existing)] = nextAgent;
  } else {
    agents.push(nextAgent);
  }

  let bound = false;
  const bindings = Array.isArray(config.bindings) ? [...config.bindings] : [];
  const externalConversationId = params.externalConversationId?.trim();
  if (externalConversationId) {
    const existingBinding = bindings.find(
      (binding): binding is RouteBinding =>
        isRouteBinding(binding) && sameOmelinkPeerBinding(binding, externalConversationId)
    );
    if (existingBinding && existingBinding.agentId !== agentId) {
      throw new OmelinkAgentAdminError(
        `omelink_conversation_id "${externalConversationId}" is already bound to agent "${existingBinding.agentId}"`,
        409
      );
    }
    if (!existingBinding) {
      bindings.push(buildBinding({ agentId, externalConversationId }));
      bound = true;
    }
  }

  const nextConfig: OpenClawConfigFile = {
    ...config,
    agents: {
      ...config.agents,
      list: agents
    },
    session: {
      ...config.session,
      dmScope:
        !config.session?.dmScope || config.session.dmScope === "main"
          ? DM_SCOPE
          : config.session.dmScope
    },
    ...(bindings.length > 0 ? { bindings } : {})
  };

  await mkdir(workspace, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const backupPath = await writeConfigWithBackup(configPath, nextConfig);

  return {
    ok: true,
    agentId,
    created,
    bound,
    dmScope: String(nextConfig.session?.dmScope ?? DM_SCOPE),
    configPath,
    backupPath,
    workspace,
    agentDir
  };
}

function normalizeRequestPayload(payload: unknown): CreateOmelinkAgentParams {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new OmelinkAgentAdminError("Invalid JSON body", 400);
  }

  const record = payload as Record<string, unknown>;
  const agentId = readString(record, "agent_id");
  if (!agentId) {
    throw new OmelinkAgentAdminError("Missing required field: agent_id", 400);
  }

  return {
    agentId,
    name: readString(record, "name"),
    externalConversationId: readString(record, "omelink_conversation_id"),
    model: readString(record, "model"),
    workspace: readString(record, "workspace"),
    agentDir: readString(record, "agent_dir")
  };
}

export function createOmelinkAgentAdminHandler(params: {
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
      const result = await createOrBindOmelinkAgent({
        ...input,
        configPath: params.configPath
      });
      params.log?.info?.(`Created or updated OMELINK agent ${result.agentId}`);
      respondJson(res, result.created ? 201 : 200, {
        ok: true,
        agent_id: result.agentId,
        created: result.created,
        bound: result.bound,
        dm_scope: result.dmScope,
        workspace: result.workspace,
        agent_dir: result.agentDir,
        restart_required: true
      });
    } catch (err) {
      const statusCode =
        err instanceof OmelinkAgentAdminError ? err.statusCode : 500;
      const message = err instanceof Error ? err.message : String(err);
      params.log?.error?.(message);
      respondJson(res, statusCode, { error: message });
    }
  };
}
