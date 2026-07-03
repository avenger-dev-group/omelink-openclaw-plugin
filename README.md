# OMELINK OpenClaw Plugin

OpenClaw plugin for connecting OMELINK to OpenClaw as a text-only channel.

## Message Flow

- OMELINK to OpenClaw: OMELINK calls this plugin's inbound webhook.
- OpenClaw to OMELINK: this plugin calls OMELINK's `/api/external/openClaw/channel/messages` endpoint.

The first version supports single-user direct conversations only. It does not use `sender_id` and does not support group chat, media, reactions, message edits, or rich cards.

## Install / Enable

Install from GitHub:

```bash
openclaw plugins install git:avenger-dev-group/omelink-openclaw-plugin
```

The `git:` prefix is required by OpenClaw's plugin installer. Bare
`https://github.com/...` URLs are rejected as unsupported npm specs.

Or install from a local checkout:

Build the plugin:

```bash
npm install
npm run build
```

Register this plugin directory in OpenClaw, then restart the gateway:

```bash
openclaw plugins install /path/to/omelink-openclaw-plugin --link
```

Restart the gateway:

```bash
openclaw gateway restart
```

Confirm OpenClaw can load the plugin:

```bash
openclaw plugins inspect omelink --runtime --json
```

The plugin should report `status: "loaded"`.

The plugin loads on OpenClaw gateway startup. It does not require
`channels.omelink.baseUrl` to be present before the inbound, agent, and config
routes are registered.

## Configuration

URL placeholders used below:

- `<OPENCLAW_GATEWAY_URL>`: OpenClaw Gateway base URL, for example `https://openclaw.example.com`.
- `<OMELINK_API_URL>`: OMELINK API base URL, for example `https://api.omelink.example.com`.

Optionally configure the channel in OpenClaw config. The plugin reads only
`channels.omelink`; it does not read `OMELINK_*` environment variables.
OpenClaw may start the plugin with no `channels.omelink` entry at all; when
`channels.omelink.baseUrl` is omitted or blank, the plugin still starts and
uses `http://127.0.0.1` at runtime.

```json
{
  "channels": {
    "omelink": {
      "baseUrl": "<OMELINK_API_URL>",
      "apiKey": "<OMELINK_API_KEY>"
    }
  }
}
```

`channels.omelink.baseUrl` is the OMELINK API base URL, for example
`https://api.omelink.example.com`. Leave it blank to use the runtime fallback
`http://127.0.0.1`. Do not include
`/api/external/openClaw/channel/messages`; the plugin appends that path.

`channels.omelink.apiKey` is optional. When set, OpenClaw sends it to OMELINK
as `x-api-key` on outbound `/messages` requests.

`channels.omelink.baseUrl` is optional. If it is omitted or blank, the plugin
falls back to `http://127.0.0.1`.

Inbound plugin routes use OpenClaw Gateway authentication. Send the Gateway
token as `Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>`.

## Check Plugin Installation

OMELINK can verify that the plugin is installed and its gateway routes are
available by calling the heartbeat endpoint:

```bash
curl --location --request GET '<OPENCLAW_GATEWAY_URL>/api/external/omelink/channel/heartbeat' \
  --header 'Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>'
```

Success response:

```json
{
  "ok": true,
  "plugin": "omelink"
}
```

## Set OMELINK API Config

Update `channels.omelink.baseUrl` and `channels.omelink.apiKey` through the
plugin config endpoint. The request field `apiHost` is written to
`channels.omelink.baseUrl`.

```bash
curl --location --request POST '<OPENCLAW_GATEWAY_URL>/api/external/omelink/channel/config' \
  --header 'Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "apiHost": "<OMELINK_API_URL>",
    "apiKey": "<OMELINK_API_KEY>"
  }'
```

You can send either `apiHost`, `apiKey`, or both. Fields omitted from the
request keep their current configured value.

The response includes `restart_required: true`. Restart the OpenClaw gateway so
the new outbound API config is loaded.

## OMELINK to OpenClaw

Send a user message to the plugin webhook:

```bash
curl --location --request POST '<OPENCLAW_GATEWAY_URL>/api/external/omelink/channel/inbound' \
  --header 'Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "omelink_conversation_id": "omelink-conversation-xxx",
    "omelink_message_id": "omelink-message-xxx",
    "text": "你好"
  }'
```

Fields:

- `omelink_conversation_id`: OMELINK single-user conversation ID. This is also used as the OpenClaw direct conversation identity.
- `omelink_message_id`: unique OMELINK message ID. The plugin uses it for short-term duplicate protection.
- `text`: plain text message body.

## Create or Bind Agents

Create OpenClaw agents and optionally bind OMELINK conversations to them:

```bash
curl --location --request POST '<OPENCLAW_GATEWAY_URL>/api/external/omelink/channel/agents' \
  --header 'Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "agents": [
      {
        "agent_id": "support",
        "name": "Support Agent",
        "omelink_conversation_id": "omelink-conversation-support",
        "model": "metis-coder/metis-coder"
      },
      {
        "agent_id": "sales",
        "name": "Sales Agent",
        "omelink_conversation_id": "omelink-conversation-sales",
        "model": "metis-coder/metis-coder"
      }
    ]
  }'
```

Fields:

- `agents`: required non-empty array of agent definitions.
- `agents[].agent_id`: required. Lowercase safe ID matching `^[a-z][a-z0-9_-]{0,63}$`; `main` is reserved.
- `agents[].name`: optional display name.
- `agents[].omelink_conversation_id`: optional OMELINK single-user conversation ID to route to this agent.
- `agents[].model`: optional OpenClaw model ID for this agent.
- `agents[].workspace`: optional absolute workspace path. Defaults to `~/.openclaw/agents/<agent_id>/workspace`.
- `agents[].agent_dir`: optional absolute agent state path. Defaults to `~/.openclaw/agents/<agent_id>/agent`.

The endpoint updates OpenClaw config in one batch by adding:

- `agents.list[]` entries for the agents.
- `bindings[]` routes for `omelink` + `omelink_conversation_id`, when provided.
- `session.dmScope: "per-channel-peer"` when unset or set to `"main"`, so different `omelink_conversation_id` values keep separate context.

The response includes `restart_required: true`. Restart the OpenClaw gateway after creating or changing agents so the new routing config is loaded.

Success response:

```json
{
  "ok": true,
  "agents": [
    {
      "agent_id": "support",
      "created": true,
      "bound": true,
      "workspace": "/Users/you/.openclaw/agents/support/workspace",
      "agent_dir": "/Users/you/.openclaw/agents/support/agent"
    },
    {
      "agent_id": "sales",
      "created": true,
      "bound": true,
      "workspace": "/Users/you/.openclaw/agents/sales/workspace",
      "agent_dir": "/Users/you/.openclaw/agents/sales/agent"
    }
  ],
  "dm_scope": "per-channel-peer",
  "restart_required": true
}
```

## OpenClaw to OMELINK

The plugin sends OpenClaw replies to:

```text
POST ${channels.omelink.baseUrl}/api/external/openClaw/channel/messages
```

with:

```json
{
  "omelink_conversation_id": "omelink-conversation-xxx",
  "open_claw_message_id": "openclaw-message-xxx",
  "text": "Hello, how can I help you?"
}
```

When `channels.omelink.apiKey` is configured, the request includes:

```text
x-api-key: <channels.omelink.apiKey>
```

If `channels.omelink.apiKey` is omitted, no plugin-specific API key header is
sent.

For example, if `channels.omelink.baseUrl` is `<OMELINK_API_URL>`, the full
URL is:

```text
POST <OMELINK_API_URL>/api/external/openClaw/channel/messages
```

## Compatibility / Upgrade Notes

The current plugin and channel id is `omelink`. If an older local OpenClaw config
still uses the previous id, update it manually:

- `channels.omelink-im` -> `channels.omelink`
- binding `match.channel: "omelink-im"` -> `match.channel: "omelink"`

## Development

```bash
npm install
npm test
npm run build
```
