#!/usr/bin/env node
/**
 * appcrane-mcp — standalone MCP connector for AppCrane.
 *
 * AppCrane (https://glick.run/appcrane.html) is a self-hosted deployment
 * platform for AI-built apps. Its MCP server lives at `<instance>/api/mcp` and
 * requires an `X-API-Key`. Registries and sandboxes (e.g. Glama) need a
 * standalone MCP server that starts in a container and answers `tools/list`
 * introspection with NO configuration. This connector bridges the two:
 *
 *   - tools/list: if APPCRANE_URL + APPCRANE_KEY are set, it connects to the
 *     live instance and returns its real tool list. If NOT configured, it
 *     returns the bundled static catalog (catalog.json) so introspection works
 *     offline with zero env vars.
 *   - tools/call: requires APPCRANE_URL + APPCRANE_KEY and proxies the call to
 *     the backend `/api/mcp`. Returns a clear error if unconfigured.
 *
 * Transport to the MCP client is stdio, so it runs via `npx appcrane-mcp`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// package.json version, resolved at runtime (dist/ sits next to package.json).
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

interface Tool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

// The bundled offline catalog. Shipped in the package root, one level up from
// dist/. This is what makes zero-config introspection work.
function loadBundledCatalog(): Tool[] {
  const path = join(__dirname, '..', 'catalog.json');
  const raw = readFileSync(path, 'utf8');
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error('catalog.json is not an array');
  return arr as Tool[];
}

interface Config {
  url?: string;
  key?: string;
  githubToken?: string;
}

function readConfig(): Config {
  return {
    url: process.env.APPCRANE_URL?.trim() || undefined,
    key: process.env.APPCRANE_KEY?.trim() || undefined,
    githubToken: process.env.APPCRANE_GITHUB_TOKEN?.trim() || undefined,
  };
}

function isConfigured(cfg: Config): cfg is Config & { url: string; key: string } {
  return Boolean(cfg.url && cfg.key);
}

const NOT_CONFIGURED_MESSAGE =
  'AppCrane is not configured. Set APPCRANE_URL (e.g. https://crane.example.com) ' +
  'and APPCRANE_KEY (your X-API-Key) to call tools against your instance. ' +
  'Optionally set APPCRANE_GITHUB_TOKEN to enable github_* passthrough tools.';

// Lazily builds and connects a client to the backend AppCrane MCP endpoint.
// Reused across calls within a process; reconnects if the previous one closed.
async function connectBackend(cfg: Config & { url: string; key: string }): Promise<Client> {
  const base = cfg.url.replace(/\/+$/, '');
  const endpoint = new URL(`${base}/api/mcp`);

  const headers: Record<string, string> = { 'X-API-Key': cfg.key };
  if (cfg.githubToken) headers['X-Github-Token'] = cfg.githubToken;

  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers },
  });

  const client = new Client(
    { name: 'appcrane-mcp-connector', version: readVersion() },
    { capabilities: {} }
  );
  await client.connect(transport);
  return client;
}

async function main(): Promise<void> {
  const version = readVersion();
  const server = new Server(
    { name: 'appcrane-mcp', version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const cfg = readConfig();

    if (isConfigured(cfg)) {
      // Live path: fetch the real, auth-filtered tool list from the instance.
      try {
        const client = await connectBackend(cfg);
        try {
          const result = await client.listTools();
          return { tools: result.tools };
        } finally {
          await client.close().catch(() => {});
        }
      } catch (err) {
        // If the instance is unreachable, fall back to the bundled catalog so
        // the connection still advertises its surface rather than failing.
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[appcrane-mcp] live tools/list failed (${msg}); serving bundled catalog\n`
        );
        return { tools: loadBundledCatalog() };
      }
    }

    // Offline path (no config): serve the bundled static catalog. This is the
    // path a registry sandbox hits during introspection.
    return { tools: loadBundledCatalog() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const cfg = readConfig();
    if (!isConfigured(cfg)) {
      return {
        isError: true,
        content: [{ type: 'text', text: NOT_CONFIGURED_MESSAGE }],
      };
    }

    const client = await connectBackend(cfg);
    try {
      const result = await client.callTool({
        name: request.params.name,
        arguments: request.params.arguments ?? {},
      });
      return result as Awaited<ReturnType<typeof client.callTool>>;
    } finally {
      await client.close().catch(() => {});
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[appcrane-mcp] v${version} ready on stdio\n`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`[appcrane-mcp] fatal: ${msg}\n`);
  process.exit(1);
});
