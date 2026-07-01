import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setOmelinkRuntime, getRuntime: getOmelinkRuntime } = createPluginRuntimeStore({
    pluginId: "omelink",
    errorMessage: "OMELINK runtime not initialized - plugin not registered"
});
export { getOmelinkRuntime, setOmelinkRuntime };
