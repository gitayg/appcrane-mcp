#!/usr/bin/env node
// Generates catalog.json — the bundled, offline tool catalog shipped with
// appcrane-mcp so `tools/list` introspection works with zero configuration
// (e.g. inside a registry's sandbox).
//
// Source of truth: the real MCP tool definitions in the AppCrane platform:
//   deployhub/server/services/mcpTools.js
//
// We import that module and call its own getToolCatalog(), so the bundled
// catalog is byte-for-byte what the live server advertises. Importing is safe:
// db.js only assigns its singleton inside initDb(), and getDb() throws until
// then, so nothing here opens a database, runs a migration, or touches DATA_DIR.
//
// This used to extract the `TOOLS = [...]` array literal by bracket-walking the
// source text and evaluating it in a vm sandbox whose global returned undefined
// for every free identifier. That broke the moment a tool description
// interpolated an imported constant at literal-evaluation time —
// `${RESERVED_KEYS.join(', ')}` in appcrane_create_app_role crashed the
// generator with "Cannot read properties of undefined (reading 'join')" — and
// it silently reimplemented getToolCatalog()'s field mapping, so the two could
// drift. Neither failure mode exists once the module is simply imported.
//
// Only { name, description, inputSchema } is written out: getToolCatalog() also
// returns requiredRole/readOnly for the admin /mcp page, which are not part of
// an MCP tools/list entry.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Location of the AppCrane platform source. Override with APPCRANE_SRC if the
// deployhub checkout lives elsewhere.
const SRC =
  process.env.APPCRANE_SRC ||
  resolve(__dirname, '../../deployhub/server/services/mcpTools.js');

let mcpTools;
try {
  mcpTools = await import(pathToFileURL(SRC).href);
} catch (err) {
  // Almost always a missing checkout or an uninstalled deployhub node_modules —
  // say so, rather than leaving the maintainer with a bare MODULE_NOT_FOUND.
  throw new Error(
    `Could not import ${SRC}: ${err.message}\n` +
      'Set APPCRANE_SRC to the mcpTools.js of your deployhub checkout, and make ' +
      'sure `npm install` has been run there.'
  );
}

if (typeof mcpTools.getToolCatalog !== 'function') {
  throw new Error(`${SRC} does not export getToolCatalog()`);
}

const catalog = mcpTools.getToolCatalog().map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
}));

if (catalog.length === 0) throw new Error('getToolCatalog() returned an empty catalog');

// Sanity checks: AWS-aligned vocabulary must be present.
const names = catalog.map((t) => t.name);
const mustHave = ['appcrane_set_secret', 'appcrane_get_secret', 'appcrane_cp'];
for (const n of mustHave) {
  if (!names.includes(n)) throw new Error(`Expected AWS-aligned tool "${n}" missing from catalog`);
}
// The legacy names must NOT be advertised.
for (const legacy of ['appcrane_set_env', 'appcrane_get_env', 'appcrane_upload']) {
  if (names.includes(legacy)) throw new Error(`Legacy tool name "${legacy}" leaked into catalog`);
}
// At least one tool should carry a `stage` param (env -> stage rename applied).
const hasStage = catalog.some(
  (t) => t.inputSchema && t.inputSchema.properties && t.inputSchema.properties.stage
);
if (!hasStage) throw new Error('No tool advertises a `stage` param — stageifySchema did not apply');

// A duplicate name would make one of the two tools unreachable through the
// bundled catalog, and the platform would still start — so catch it here.
const dupes = names.filter((n, idx) => names.indexOf(n) !== idx);
if (dupes.length) throw new Error(`Duplicate tool name(s) in catalog: ${[...new Set(dupes)].join(', ')}`);

const out = join(__dirname, '..', 'catalog.json');
const rendered = JSON.stringify(catalog, null, 2) + '\n';

// --check compares instead of writing, so CI (or a pre-release step) can fail on
// drift. Nothing ever triggered a regeneration, and the committed catalog
// silently fell 22 tools behind the platform (35 advertised against 57 real).
// A guard that reads catalog.json and compares it to *itself* cannot see that;
// the comparison has to be against the platform's own getToolCatalog().
if (process.argv.includes('--check')) {
  const current = readFileSync(out, 'utf8');
  if (current === rendered) {
    console.log(`catalog.json is up to date (${catalog.length} tools).`);
    process.exit(0);
  }
  const have = JSON.parse(current).map((t) => t.name);
  const missing = names.filter((n) => !have.includes(n));
  const stale = have.filter((n) => !names.includes(n));
  console.error(
    `catalog.json is STALE: it has ${have.length} tools, the platform defines ${catalog.length}.`
  );
  if (missing.length) console.error(`  missing (${missing.length}): ${missing.join(', ')}`);
  if (stale.length) console.error(`  no longer real (${stale.length}): ${stale.join(', ')}`);
  if (!missing.length && !stale.length) {
    console.error('  same tool names, but a description or inputSchema changed.');
  }
  console.error('Run `npm run gen:catalog` and commit the result.');
  process.exit(1);
}

writeFileSync(out, rendered);

console.log(`Wrote ${catalog.length} tools to ${out}`);
console.log('Sample:', names.slice(0, 8).join(', '));
