import type { IncomingMessage, ServerResponse } from "node:http";

import { OMELINK_CHANNEL_ID } from "./types.js";

function respondJson(
  res: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createOmelinkHeartbeatHandler(): (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void> {
  return async (req, res) => {
    if (req.method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }

    respondJson(res, 200, {
      ok: true,
      plugin: OMELINK_CHANNEL_ID
    });
  };
}
