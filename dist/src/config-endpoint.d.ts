import type { IncomingMessage, ServerResponse } from "node:http";
export type SetOmelinkConfigParams = {
    configPath?: string;
    apiHost?: string;
    apiKey?: string;
};
export type SetOmelinkConfigResult = {
    ok: true;
    updated: true;
    configPath: string;
    backupPath: string;
};
export declare class OmelinkConfigError extends Error {
    readonly statusCode: number;
    constructor(message: string, statusCode?: number);
}
export declare function setOmelinkConfig(params: SetOmelinkConfigParams): Promise<SetOmelinkConfigResult>;
export declare function createOmelinkConfigHandler(params: {
    configPath?: string;
    log?: {
        info?: (message: string) => void;
        warn?: (message: string) => void;
        error?: (message: string) => void;
    };
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
