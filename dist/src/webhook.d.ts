import type { IncomingMessage, ServerResponse } from "node:http";
import type { OmelinkInboundMessage } from "./types.js";
export interface CreateOmelinkWebhookHandlerParams {
    dedupeTtlMs?: number;
    deliver: (message: OmelinkInboundMessage) => Promise<unknown>;
    log?: {
        info?: (message: string) => void;
        warn?: (message: string) => void;
        error?: (message: string) => void;
    };
}
export declare function createOmelinkWebhookHandler(params: CreateOmelinkWebhookHandlerParams): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
