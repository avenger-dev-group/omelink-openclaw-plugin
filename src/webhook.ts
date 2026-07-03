import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  OmelinkInboundMessage,
  OmelinkInboundWebhookPayload
} from "./types.js";

export interface CreateOmelinkWebhookHandlerParams {
  dedupeTtlMs?: number;
  deliver: (message: OmelinkInboundMessage) => Promise<unknown>;
  log?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}

const DEFAULT_DEDUPE_TTL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

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
        reject(new Error("Request body too large"));
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
    throw new Error("Invalid JSON body");
  }
}

function requiredString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizePayload(payload: unknown): {
  ok: true;
  message: OmelinkInboundMessage;
} | {
  ok: false;
  error: string;
} {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return { ok: false, error: "Invalid JSON body" };
  }

  const record = payload as Partial<OmelinkInboundWebhookPayload> &
    Record<string, unknown>;
  const missing: string[] = [];
  const externalAgentId = requiredString(record, "omelink_agent_id");
  const externalMessageId = requiredString(record, "omelink_message_id");
  const text = requiredString(record, "text");

  if (!externalAgentId) {
    missing.push("omelink_agent_id");
  }
  if (!externalMessageId) {
    missing.push("omelink_message_id");
  }
  if (!text) {
    missing.push("text");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required fields: ${missing.join(", ")}`
    };
  }

  if (!externalAgentId || !externalMessageId || !text) {
    return { ok: false, error: "Missing required fields" };
  }

  return {
    ok: true,
    message: {
      externalAgentId,
      externalMessageId,
      text
    }
  };
}

class MessageDedupeStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  hasSeen(messageId: string, now = Date.now()): boolean {
    this.prune(now);
    const expiresAt = this.seen.get(messageId);
    if (!expiresAt) {
      return false;
    }

    return expiresAt > now;
  }

  markSeen(messageId: string, now = Date.now()): void {
    this.prune(now);
    this.seen.set(messageId, now + this.ttlMs);
  }

  private prune(now: number): void {
    for (const [messageId, expiresAt] of this.seen) {
      if (expiresAt <= now) {
        this.seen.delete(messageId);
      }
    }
  }
}

export function createOmelinkWebhookHandler(
  params: CreateOmelinkWebhookHandlerParams
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const dedupe = new MessageDedupeStore(
    params.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS
  );

  return async (req, res) => {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }

    let payload: unknown;
    try {
      payload = parseJsonBody(await readRequestBody(req));
    } catch (err) {
      params.log?.warn?.(err instanceof Error ? err.message : String(err));
      respondJson(res, 400, {
        error: err instanceof Error ? err.message : "Invalid request body"
      });
      return;
    }

    const normalized = normalizePayload(payload);
    if (!normalized.ok) {
      respondJson(res, 400, { error: normalized.error });
      return;
    }

    if (dedupe.hasSeen(normalized.message.externalMessageId)) {
      respondJson(res, 200, { ok: true, duplicate: true });
      return;
    }

    dedupe.markSeen(normalized.message.externalMessageId);

    params.deliver(normalized.message).catch((err: unknown) => {
      params.log?.error?.(err instanceof Error ? err.message : String(err));
    });
    respondJson(res, 202, { ok: true });
  };
}
