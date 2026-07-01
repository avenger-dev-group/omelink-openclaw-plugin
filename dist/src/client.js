import { OMELINK_MESSAGES_PATH } from "./types.js";
function buildMessagesUrl(baseUrl) {
    return new URL(OMELINK_MESSAGES_PATH, ensureTrailingSlash(baseUrl)).toString();
}
function ensureTrailingSlash(value) {
    return value.endsWith("/") ? value : `${value}/`;
}
async function readErrorBody(response) {
    const body = await response.text().catch(() => "");
    return body.trim();
}
export async function sendOmelinkTextMessage(params) {
    const response = await fetch(buildMessagesUrl(params.baseUrl), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(params.apiKey ? { "x-api-key": params.apiKey } : {})
        },
        body: JSON.stringify({
            omelink_conversation_id: params.externalConversationId,
            open_claw_message_id: params.externalMessageId,
            text: params.text
        })
    });
    if (!response.ok) {
        const statusText = response.statusText ? ` ${response.statusText}` : "";
        const body = await readErrorBody(response);
        const bodyText = body ? `: ${body}` : "";
        throw new Error(`OMELINK message delivery failed with HTTP ${response.status}${statusText}${bodyText}`);
    }
    return { messageId: params.externalMessageId };
}
