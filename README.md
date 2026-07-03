# appcrane-mcp

The standalone MCP connector for **[AppCrane](https://glick.run/appcrane.html)** — the self-hosted deployment platform for AI-built, agent-deployed apps.

AppCrane exposes an MCP server at `<instance>/api/mcp` that requires an `X-API-Key`. This package is a thin **stdio** MCP server that:

1. Serves the full `appcrane_*` tool catalog for **`tools/list` introspection with zero configuration** — it ships a bundled `catalog.json`, so registries and sandboxes (e.g. Glama) can start it in a container and introspect it offline.
2. **Proxies real `tools/call`** to your own AppCrane instance once `APPCRANE_URL` and `APPCRANE_KEY` are set.

It runs anywhere Node 20+ is available, via `npx appcrane-mcp`.

## Install / run

```bash
npx appcrane-mcp
```

With no environment variables it still starts and answers `tools/list` from the bundled catalog (~35 tools). To actually invoke tools against your instance, set:

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
node scripts/test-list.mjs   # smoke test: spawn over stdio, assert tools/list
```

The bundled `catalog.json` is generated from the real tool definitions in the AppCrane platform (`deployhub/server/services/mcpTools.js`) and reflects the AWS-aligned tool vocabulary (`appcrane_set_secret`, `appcrane_get_secret`, `appcrane_cp`, and the `stage` parameter). It is committed so the package ships self-contained.

## About AppCrane

AppCrane is a self-hosted home for AI-built and AI-deployed apps. This connector is MIT-licensed to maximize adoption; the platform itself is AGPL.

- Platform: https://github.com/gitayg/appCrane
- Product page: https://glick.run/appcrane.html
