import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createOmelinkConfigHandler,
  setOmelinkConfig
} from "../src/config-endpoint.js";

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
  const dir = await mkdtemp(path.join(tmpdir(), "omelink-config-"));
  tempDirs.push(dir);
  const configPath = path.join(dir, "openclaw.json");
  await writeFile(configPath, source);
  return { configPath };
}

async function invokeHandler(params: {
  configPath: string;
  body: unknown;
}) {
  const handler = createOmelinkConfigHandler({
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

describe("setOmelinkConfig", () => {
  it("writes channels.omelink baseUrl and apiKey while removing deprecated path config", async () => {
    const { configPath } = await createConfigFile(JSON.stringify({
      channels: {
        omelink: {
          baseUrl: "https://api.omelink.test",
          webhookPath: "/custom/inbound",
          agentsPath: "/custom/agents"
        }
      }
    }));

    const result = await setOmelinkConfig({
      configPath,
      apiHost: "https://api.updated.omelink.test",
      apiKey: "configured-api-key"
    });
    const config = JSON.parse(await readFile(configPath, "utf8"));

    expect(result).toMatchObject({
      ok: true,
      updated: true,
      configPath
    });
    expect(result.backupPath).toContain("openclaw.json.bak.omelink-config-");
    expect(config.channels.omelink).toMatchObject({
      baseUrl: "https://api.updated.omelink.test",
      apiKey: "configured-api-key"
    });
    expect(config.channels.omelink.webhookPath).toBeUndefined();
    expect(config.channels.omelink.agentsPath).toBeUndefined();
  });
});

describe("createOmelinkConfigHandler", () => {
  it("updates the API host and API key over HTTP", async () => {
    const { configPath } = await createConfigFile("{}\n");

    const response = await invokeHandler({
      configPath,
      body: {
        apiHost: "https://api.updated.omelink.test",
        apiKey: "configured-api-key"
      }
    });
    const config = JSON.parse(await readFile(configPath, "utf8"));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      ok: true,
      updated: true,
      restart_required: true
    });
    expect(config.channels.omelink.baseUrl).toBe(
      "https://api.updated.omelink.test"
    );
    expect(config.channels.omelink.apiKey).toBe("configured-api-key");
  });

  it("updates only the API host when apiKey is omitted", async () => {
    const { configPath } = await createConfigFile(JSON.stringify({
      channels: {
        omelink: {
          baseUrl: "https://api.omelink.test",
          apiKey: "existing-key"
        }
      }
    }));

    const response = await invokeHandler({
      configPath,
      body: {
        apiHost: "https://api.updated.omelink.test"
      }
    });
    const config = JSON.parse(await readFile(configPath, "utf8"));

    expect(response.statusCode).toBe(200);
    expect(config.channels.omelink).toMatchObject({
      baseUrl: "https://api.updated.omelink.test",
      apiKey: "existing-key"
    });
  });

  it("returns 400 when no supported config field is provided", async () => {
    const { configPath } = await createConfigFile("{}\n");

    const response = await invokeHandler({
      configPath,
      body: {}
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: "Missing required field: apiHost or apiKey"
    });
  });
});
