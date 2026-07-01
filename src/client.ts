import {
  OMELINK_MESSAGES_PATH,
  type OmelinkOutboundMessage
} from "./types.js";

export interface SendOmelinkTextMessageParams extends OmelinkOutboundMessage {
  baseUrl: string;
  apiKey?: string;
}

function buildMessagesUrl(baseUrl: string): string {
  return new URL(OMELINK_MESSAGES_PATH, ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function readErrorBody(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return body.trim();
}

export async function sendOmelinkTextMessage(
  params: SendOmelinkTextMessageParams
): Promise<{ messageId: string }> {
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
    throw new Error(
      `OMELINK message delivery failed with HTTP ${response.status}${statusText}${bodyText}`
    );
  }

  return { messageId: params.externalMessageId };
}
