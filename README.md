# appcrane-mcp

The standalone MCP connector for **[AppCrane](https://glick.run/appcrane.html)** — the self-hosted deployment platform for AI-built, agent-deployed apps.

AppCrane exposes an MCP server at `<instance>/api/mcp` that requires an `X-API-Key`. This package is a thin **stdio** MCP server that:

1. Serves the full `appcrane_*` tool catalog for **`tools/list` introspection with zero configuration** — it ships a bundled `catalog.json`, so registries and sandboxes (e.g. Glama) can start it in a container and introspect it offline.
2. **Proxies real `tools/call`** to your own AppCrane instance once `APPCRANE_URL` and `APPCRANE_KEY` are set.

It runs anywhere Node 20+ is available, via `npx appcrane-mcp`.

> **Licensing:** this connector is **MIT**. The AppCrane platform it talks to is a separate
> project and is **AGPL-3.0**. Installing this package does not pull the platform in — the
> connector is a client that talks to an AppCrane instance you host yourself.

## How you connect

There is no hosted service and no AppCrane account. The flow is entirely your own:

1. You self-host AppCrane (AGPL) somewhere you control.
2. You issue an API key from that instance.
3. Your agent runs this connector locally over **stdio** (`npx -y appcrane-mcp`).
4. The connector forwards each `tools/call` to `${APPCRANE_URL}/api/mcp` with your
   `X-API-Key`. Your key stays in your own MCP client config; it is never sent anywhere
   except the instance URL you set.

## Install / run

```bash
npx appcrane-mcp
```

With no environment variables it still starts and answers `tools/list` from the bundled catalog (57 tools). To actually invoke tools against your instance, set:

| Env var | Required | Description |
| --- | --- | --- |
| `APPCRANE_URL` | for calls | Your instance base URL, e.g. `https://crane.example.com` |
| `APPCRANE_KEY` | for calls | Your AppCrane API key (sent as `X-API-Key`) |
| `APPCRANE_GITHUB_TOKEN` | optional | A GitHub PAT (sent as `X-Github-Token`) to unlock the `github_*` passthrough tools |

## MCP client configuration

This is a **stdio** command server (not an HTTP endpoint). Add it to your MCP client config like this:

```json
{
  "mcpServers": {
    "appcrane": {
      "command": "npx",
      "args": ["-y", "appcrane-mcp"],
      "env": {
        "APPCRANE_URL": "https://crane.example.com",
        "APPCRANE_KEY": "your_api_key",
        "APPCRANE_GITHUB_TOKEN": "ghp_optional_for_github_passthrough"
      }
    }
  }
}
```

Claude Code CLI:

```bash
claude mcp add appcrane \
  --env APPCRANE_URL=https://crane.example.com \
  --env APPCRANE_KEY=your_api_key \
  -- npx -y appcrane-mcp
```

## How it works

- **`tools/list`**
  - If `APPCRANE_URL` + `APPCRANE_KEY` are set → connects to `${APPCRANE_URL}/api/mcp` (StreamableHTTP, header `X-API-Key`, plus `X-Github-Token` when the GitHub token is set), fetches the **live, auth-filtered** tool list, and returns it. If the instance is unreachable it falls back to the bundled catalog.
  - If not configured → returns the **bundled static catalog** (`catalog.json`). This path needs no env vars, which is what a registry's introspection sandbox hits.
- **`tools/call`** → requires `APPCRANE_URL` + `APPCRANE_KEY`; forwards the call to the backend and returns its result. Without configuration it returns a clear "not configured" error.

## Docker

```bash
docker build -t appcrane-mcp .

# Introspection only (no config) — starts and serves tools/list:
docker run -i --rm appcrane-mcp

# Full use:
docker run -i --rm \
  -e APPCRANE_URL=https://crane.example.com \
  -e APPCRANE_KEY=your_api_key \
  appcrane-mcp
```

## Development

```bash
npm install
npm run build          # tsc -> dist/
npm run gen:catalog    # regenerate catalog.json from the AppCrane platform source
npm run check:catalog  # fail if catalog.json has drifted from that source
node scripts/test-list.mjs   # smoke test: spawn over stdio, assert tools/list
```

Both catalog scripts import the platform's own `getToolCatalog()` from a sibling
`deployhub` checkout; set `APPCRANE_SRC` to point at its `server/services/mcpTools.js`
if yours lives elsewhere.

**Run `npm run check:catalog` before every release.** Nothing regenerates the catalog
automatically and the two repos share no CI, so it rots silently — it has already been
caught 22 tools behind the platform (35 advertised against 57 real).

The bundled `catalog.json` is generated from the real tool definitions in the AppCrane platform (`deployhub/server/services/mcpTools.js`) and reflects the AWS-aligned tool vocabulary (`appcrane_set_secret`, `appcrane_get_secret`, `appcrane_cp`, and the `stage` parameter). It is committed so the package ships self-contained.

## About AppCrane

AppCrane is a self-hosted home for AI-built and AI-deployed apps. This connector is MIT-licensed to maximize adoption; the platform itself is AGPL.

- This connector (MIT): https://github.com/gitayg/appcrane-mcp
- Platform (AGPL-3.0): https://github.com/gitayg/appCrane
- Product page: https://glick.run/appcrane.html
