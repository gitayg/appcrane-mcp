#!/usr/bin/env node
// Generates catalog.json — the bundled, offline tool catalog shipped with
// appcrane-mcp so `tools/list` introspection works with zero configuration
// (e.g. inside a registry's sandbox).
//
// Source of truth: the real MCP tool definitions in the AppCrane platform:
//   deployhub/server/services/mcpTools.js
//
// That module can't be imported directly here — its top-level imports pull in
// the database, encryption, permissions, etc. So we extract just the two pieces
// we need — the `TOOLS = [...]` array literal and the `stageifySchema` helper —
// and evaluate them inside a vm sandbox with a forgiving global. The handler
// functions in TOOLS are never called (we only read name/description/schema),
// so their free references to db/getDb/etc. never resolve, which is fine.
//
// We reproduce exactly what getToolCatalog() advertises: each tool's
// { name, description, inputSchema } after applying stageifySchema
// (the AWS-aligned env -> stage rename). The set_secret/get_secret/cp names are
// already baked into the TOOLS array literal, so no name transform is needed.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Location of the AppCrane platform source. Override with APPCRANE_SRC if the
// deployhub checkout lives elsewhere.
const SRC =
  process.env.APPCRANE_SRC ||
  resolve(__dirname, '../../deployhub/server/services/mcpTools.js');

const source = readFileSync(SRC, 'utf8');

// --- Extract the `const TOOLS = [ ... ];` array literal -------------------
const toolsStart = source.indexOf('const TOOLS = [');
if (toolsStart === -1) throw new Error('Could not find `const TOOLS = [` in ' + SRC);
// Walk brackets from the opening `[` to find the matching close.
const openBracket = source.indexOf('[', toolsStart);
let depth = 0;
let i = openBracket;
for (; i < source.length; i++) {
  const c = source[i];
  if (c === '[') depth++;
  else if (c === ']') {
    depth--;
    if (depth === 0) break;
  }
}
if (depth !== 0) throw new Error('Unbalanced brackets while extracting TOOLS array');
const toolsLiteral = source.slice(openBracket, i + 1);

// --- Extract the `function stageifySchema(schema) { ... }` helper ---------
const stageStart = source.indexOf('function stageifySchema');
if (stageStart === -1) throw new Error('Could not find stageifySchema in ' + SRC);
// Find the body braces.
const stageBraceOpen = source.indexOf('{', stageStart);
depth = 0;
let j = stageBraceOpen;
for (; j < source.length; j++) {
  const c = source[j];
  if (c === '{') depth++;
  else if (c === '}') {
    depth--;
    if (depth === 0) break;
  }
}
const stageifySrc = source.slice(stageStart, j + 1);

// --- Evaluate in a vm sandbox --------------------------------------------
// The forgiving global returns undefined for any free identifier referenced at
// evaluation time. Handler bodies are not executed, so their references are
// never touched; only the object literals (name/description/inputSchema) are
// built, and those are plain data.
// Wrap a plain backing object in a proxy that claims every identifier is in
// scope (returning undefined for unknown ones) so free references inside
// handler bodies never throw ReferenceError at eval time. `vm.createContext`
// installs the standard globals (Object, Array, JSON, Promise, ...) on the
// backing object, so real built-ins still resolve normally.
// Seed the backing object with the host's standard built-ins so evaluated code
// can use Object/Array/JSON/Promise/etc., then wrap it in a proxy that claims
// every *other* identifier is in scope (returning undefined) so free references
// inside handler bodies never throw ReferenceError at eval time.
const backing = {
  Object, Array, JSON, Promise, String, Number, Boolean, Math, Date,
  RegExp, Map, Set, Error, Symbol, console, globalThis: undefined,
};
const proxy = new Proxy(backing, {
  has: () => true, // claim every name is in scope → no ReferenceError
  get: (t, k) => (k in t ? Reflect.get(t, k) : undefined),
  set: (t, k, v) => Reflect.set(t, k, v),
});
backing.globalThis = proxy;
const context = vm.createContext(proxy);

// Handler bodies are never executed here, but they must still *parse* as
// classic (non-module) script for vm.Script. Neutralize module-only syntax that
// only appears inside handlers: `import.meta` and dynamic `import(...)`.
const neutralize = (s) =>
  s
    .replace(/import\.meta/g, '({})')
    .replace(/\bawait\s+import\s*\(/g, 'Promise.resolve(')
    .replace(/\bimport\s*\(/g, 'Promise.resolve(');

const script = `
${neutralize(stageifySrc)}
const TOOLS = ${neutralize(toolsLiteral)};
globalThis.__catalog = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: stageifySchema(t.inputSchema),
}));
`;

vm.runInContext(script, context, { filename: 'mcpTools-extract.js' });
const catalog = backing.__catalog;

if (!Array.isArray(catalog) || catalog.length === 0) {
  throw new Error('Extraction produced an empty catalog');
}

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

const out = join(__dirname, '..', 'catalog.json');
writeFileSync(out, JSON.stringify(catalog, null, 2) + '\n');

console.log(`Wrote ${catalog.length} tools to ${out}`);
console.log('Sample:', names.slice(0, 8).join(', '));
