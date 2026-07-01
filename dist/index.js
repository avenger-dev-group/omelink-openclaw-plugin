import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";
export default defineBundledChannelEntry({
    id: "omelink",
    name: "OMELINK",
    description: "OMELINK OpenClaw plugin with a text-only channel integration",
    importMetaUrl: import.meta.url,
    plugin: {
        specifier: "./channel-plugin-api.js",
        exportName: "omelinkPlugin"
    },
    runtime: {
        specifier: "./channel-plugin-api.js",
        exportName: "setOmelinkRuntime"
    }
});
