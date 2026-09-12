#!/usr/bin/env node
// Smoke test: spawn the built server over stdio with NO env vars, run the MCP
// initialize + tools/list handshake, and assert the bundled catalog comes back.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'dist', 'index.js');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: {}, // deliberately empty — no APPCRANE_URL / APPCRANE_KEY
  stderr: 'inherit',
});

const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('tool count:', tools.length);
console.log('sample names:', tools.slice(0, 6).map((t) => t.name).join(', '));
const deploy = tools.find((t) => t.name === 'appcrane_deploy');
console.log('appcrane_deploy props:', Object.keys(deploy?.inputSchema?.properties ?? {}).join(', '));

await client.close();

// Assert the server serves exactly what catalog.json holds — i.e. the offline
// path is not truncating or dropping tools. This deliberately does NOT prove
// catalog.json matches the platform: both sides read the same file, so drift
// against deployhub is invisible here. `npm run check:catalog` is that guard.
const bundled = JSON.parse(
  readFileSync(join(__dirname, '..', 'catalog.json'), 'utf8')
);
if (tools.length !== bundled.length) {
  console.error(
    `FAIL: served ${tools.length} tools but catalog.json holds ${bundled.length}`
  );
  process.exit(1);
}
console.log('OK');
