import { OMELINK_CHANNEL_ID } from "./types.js";
function respondJson(res, statusCode, body) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}
export function createOmelinkHeartbeatHandler() {
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
