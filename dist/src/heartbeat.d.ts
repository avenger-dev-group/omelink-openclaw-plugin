import type { IncomingMessage, ServerResponse } from "node:http";
export declare function createOmelinkHeartbeatHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
