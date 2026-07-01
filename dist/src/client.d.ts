import { type OmelinkOutboundMessage } from "./types.js";
export interface SendOmelinkTextMessageParams extends OmelinkOutboundMessage {
    baseUrl: string;
    apiKey?: string;
}
export declare function sendOmelinkTextMessage(params: SendOmelinkTextMessageParams): Promise<{
    messageId: string;
}>;
