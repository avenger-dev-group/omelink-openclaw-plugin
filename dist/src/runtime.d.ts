import { type PluginRuntime } from "openclaw/plugin-sdk/runtime-store";
declare const setOmelinkRuntime: (runtime: PluginRuntime) => void, getOmelinkRuntime: () => PluginRuntime;
export { getOmelinkRuntime, setOmelinkRuntime };
export type { PluginRuntime };
