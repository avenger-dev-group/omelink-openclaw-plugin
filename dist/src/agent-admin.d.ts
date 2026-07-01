import type { IncomingMessage, ServerResponse } from "node:http";
export type CreateOmelinkAgentParams = {
    configPath?: string;
    agentId: string;
    name?: string;
    externalConversationId?: string;
    model?: string;
    workspace?: string;
    agentDir?: string;
};
export type CreateOmelinkAgentResult = {
    ok: true;
    agentId: string;
    created: boolean;
    bound: boolean;
    dmScope: string;
    configPath: string;
    backupPath: string;
    workspace: string;
    agentDir: string;
};
export declare class OmelinkAgentAdminError extends Error {
    readonly statusCode: number;
    constructor(message: string, statusCode?: number);
}
export declare function createOrBindOmelinkAgent(params: CreateOmelinkAgentParams): Promise<CreateOmelinkAgentResult>;
export declare function createOmelinkAgentAdminHandler(params: {
    configPath?: string;
    log?: {
        info?: (message: string) => void;
        warn?: (message: string) => void;
        error?: (message: string) => void;
    };
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
