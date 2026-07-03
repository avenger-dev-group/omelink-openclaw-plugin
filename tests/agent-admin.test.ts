import { EventEmitter } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOmelinkAgentAdminHandler,
  createOrBindOmelinkAgents
} from "../src/agent-admin.js";

const tempDirs: string[] = [];

class MockRequest extends EventEmitter {
  method = "POST";
  headers: IncomingHttpHeaders;

  constructor(body: string, headers: IncomingHttpHeaders = {}) {
    super();
    this.headers = headers;

    queueMicrotask(() => {
      this.emit("data", Buffer.from(body));
      this.emit("end");
    });
  }
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  body = "";

  writeHead(statusCode: number) {
    this.statusCode = statusCode;
    return this;
  }

  end(chunk?: string) {
    if (chunk) {
      this.body += chunk;
    }
    this.emit("finish");
    return this;
  }
}

async function createConfigFile(source = "{}\n") {
  const dir = await mkdtemp(path.join(tmpdir(), "omelink-agent-admin-"));
  tempDirs.push(dir);
  const configPath = path.join(dir, "openclaw.json");
  await writeFile(configPath, source);
  return { dir, configPath };
}

async function invokeHandler(params: {
  configPath: string;
  body: unknown;
}) {
  const handler = createOmelinkAgentAdminHandler({
    configPath: params.configPath
  });
  const req = new MockRequest(JSON.stringify(params.body), {
    "content-type": "application/json"
  }) as unknown as IncomingMessage;
  const res = new MockResponse() as unknown as ServerResponse;

  await handler(req, res);

  return res as unknown as MockResponse;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("createOrBindOmelinkAgents", () => {
  it("creates multiple agents, binds OMELINK agent IDs, and writes one config backup", async () => {
    const { dir, configPath } = await createConfigFile(`{
      "agents": { "defaults": { "model": "metis-coder/metis-coder" } },
      models: { "mode": "merge" }
    }\n`);

    const result = await createOrBindOmelinkAgents({
      configPath,
      agents: [
        {
          agentId: "support",
          name: "Support Agent",
          externalAgentId: "local-agent-support",
          model: "metis-coder/metis-coder",
          workspace: path.join(dir, "support-workspace"),
          agentDir: path.join(dir, "support-agent")
        },
        {
          agentId: "sales",
          name: "Sales Agent",
          externalAgentId: "local-agent-sales",
          workspace: path.join(dir, "sales-workspace"),
          agentDir: path.join(dir, "sales-agent")
        }
      ]
    });

    const config = JSON.parse(await readFile(configPath, "utf8"));
    const backups = (await readdir(dir)).filter((entry) =>
      entry.startsWith("openclaw.json.bak.omelink-agent-")
    );

    expect(result).toMatchObject({
      ok: true,
      dmScope: "per-channel-peer",
      agents: [
        {
          agentId: "support",
          created: true,
          bound: true,
          workspace: path.join(dir, "support-workspace"),
          agentDir: path.join(dir, "support-agent")
        },
        {
          agentId: "sales",
          created: true,
          bound: true,
          workspace: path.join(dir, "sales-workspace"),
          agentDir: path.join(dir, "sales-agent")
        }
      ]
    });
    expect(backups).toHaveLength(1);
    expect(config.session.dmScope).toBe("per-channel-peer");
    expect(config.agents.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "support",
          name: "Support Agent",
          model: "metis-coder/metis-coder"
        }),
        expect.objectContaining({
          id: "sales",
          name: "Sales Agent"
        })
      ])
    );
    expect(config.bindings).toEqual([
      {
        type: "route",
        agentId: "support",
        match: {
          channel: "omelink",
          accountId: "default",
          peer: {
            kind: "direct",
            id: "local-agent-support"
          }
        },
        session: {
          dmScope: "per-channel-peer"
        }
      },
      {
        type: "route",
        agentId: "sales",
        match: {
          channel: "omelink",
          accountId: "default",
          peer: {
            kind: "direct",
            id: "local-agent-sales"
          }
        },
        session: {
          dmScope: "per-channel-peer"
        }
      }
    ]);
  });

  it("rejects binding conflicts with an existing agent", async () => {
    const { configPath } = await createConfigFile(JSON.stringify({
      bindings: [
        {
          type: "route",
          agentId: "sales",
          match: {
            channel: "omelink",
            accountId: "default",
            peer: { kind: "direct", id: "local-agent-support" }
          }
        }
      ]
    }));

    await expect(
      createOrBindOmelinkAgents({
        configPath,
        agents: [
          {
            agentId: "support",
            externalAgentId: "local-agent-support"
          }
        ]
      })
    ).rejects.toThrow(
      'omelink_agent_id "local-agent-support" is already bound to agent "sales"'
    );
  });
});

describe("createOmelinkAgentAdminHandler", () => {
  it("creates multiple agents over HTTP", async () => {
    const { dir, configPath } = await createConfigFile("{}\n");

    const response = await invokeHandler({
      configPath,
      body: {
        agents: [
          {
            agent_id: "support",
            name: "Support Agent",
            omelink_agent_id: "local-agent-support",
            workspace: path.join(dir, "support-workspace"),
            agent_dir: path.join(dir, "support-agent")
          },
          {
            agent_id: "sales",
            name: "Sales Agent",
            omelink_agent_id: "local-agent-sales",
            workspace: path.join(dir, "sales-workspace"),
            agent_dir: path.join(dir, "sales-agent")
          }
        ]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({
      ok: true,
      agents: [
        {
          agent_id: "support",
          created: true,
          bound: true,
          workspace: path.join(dir, "support-workspace"),
          agent_dir: path.join(dir, "support-agent")
        },
        {
          agent_id: "sales",
          created: true,
          bound: true,
          workspace: path.join(dir, "sales-workspace"),
          agent_dir: path.join(dir, "sales-agent")
        }
      ],
      restart_required: true
    });
  });

  it("returns 400 for invalid agent IDs", async () => {
    const { configPath } = await createConfigFile("{}\n");

    const response = await invokeHandler({
      configPath,
      body: {
        agents: [
          {
            agent_id: "Support Agent"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: "agent_id must match ^[a-z][a-z0-9_-]{0,63}$"
    });
  });
});
