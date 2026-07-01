const DEFAULT_DEDUPE_TTL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
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
function parseJsonBody(body) {
    try {
        return JSON.parse(body);
    }
    catch {
        throw new Error("Invalid JSON body");
    }
}
function requiredString(record, key) {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}
function normalizePayload(payload) {
    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
        return { ok: false, error: "Invalid JSON body" };
    }
    const record = payload;
    const missing = [];
    const externalConversationId = requiredString(record, "omelink_conversation_id");
    const externalMessageId = requiredString(record, "omelink_message_id");
    const text = requiredString(record, "text");
    if (!externalConversationId) {
        missing.push("omelink_conversation_id");
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
    if (!externalConversationId || !externalMessageId || !text) {
        return { ok: false, error: "Missing required fields" };
    }
    return {
        ok: true,
        message: {
            externalConversationId,
            externalMessageId,
            text
        }
    };
}
class MessageDedupeStore {
    ttlMs;
    seen = new Map();
    constructor(ttlMs) {
        this.ttlMs = ttlMs;
    }
    hasSeen(messageId, now = Date.now()) {
        this.prune(now);
        const expiresAt = this.seen.get(messageId);
        if (!expiresAt) {
            return false;
        }
        return expiresAt > now;
    }
    markSeen(messageId, now = Date.now()) {
        this.prune(now);
        this.seen.set(messageId, now + this.ttlMs);
    }
    prune(now) {
        for (const [messageId, expiresAt] of this.seen) {
            if (expiresAt <= now) {
                this.seen.delete(messageId);
            }
        }
    }
}
export function createOmelinkWebhookHandler(params) {
    const dedupe = new MessageDedupeStore(params.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS);
    return async (req, res) => {
        if (req.method !== "POST") {
            respondJson(res, 405, { error: "Method not allowed" });
            return;
        }
        let payload;
        try {
            payload = parseJsonBody(await readRequestBody(req));
        }
        catch (err) {
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
        params.deliver(normalized.message).catch((err) => {
            params.log?.error?.(err instanceof Error ? err.message : String(err));
        });
        respondJson(res, 202, { ok: true });
    };
}
