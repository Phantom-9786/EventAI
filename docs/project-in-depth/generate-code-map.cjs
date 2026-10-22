// Documentation-only: parse imports with the project's installed TypeScript.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const sourceRoot = path.join(root, 'apps/api/src');
const entry = path.join(sourceRoot, 'main.ts');
const configFile = ts.readConfigFile(path.join(root, 'apps/api/tsconfig.json'), ts.sys.readFile);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.join(root, 'apps/api'));
const visited = new Set();
const edges = new Map();
function group(file) {
  const relative = path.relative(sourceRoot, file).replaceAll('\\', '/');
  if (relative === 'main.ts') return 'API entry';
  if (relative === 'express/app.ts') return 'Express composition';
  const feature = relative.match(/^(?:express\/)?modules\/([^/]+)/);
  if (feature) return feature[1] + ' module';
  if (relative.startsWith('common/cache/')) return 'Redis cache';
  if (relative.startsWith('common/scheduler/')) return 'Scheduler';
  if (relative.startsWith('express/services/moderation')) return 'Moderation workflow';
  if (relative.startsWith('express/middleware/')) return 'HTTP middleware';
  return 'Shared runtime helpers';
}
function visit(file) {
  if (visited.has(file)) return;
  visited.add(file);
  const input = fs.readFileSync(file, 'utf8');
  const imports = ts.preProcessFile(input, true, true).importedFiles;
  for (const reference of imports) {
    const resolvedName = ts.resolveModuleName(reference.fileName, file, config.options, ts.sys).resolvedModule?.resolvedFileName;
    const resolved = resolvedName ? path.resolve(resolvedName) : null;
    if (!resolved || !resolved.startsWith(sourceRoot + path.sep) || resolved.endsWith('.d.ts')) continue;
    const from = group(file), to = group(resolved);
    if (from !== to && from !== 'Shared runtime helpers' && to !== 'Shared runtime helpers') {
      const key = from + '\0' + to;
      const old = edges.get(key);
      if (old) old.count++;
      else edges.set(key, { from, to, count: 1 });
    }
    visit(resolved);
  }
}
visit(entry);
const rows = [...edges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
function diagram(selected) {
  const names = [...new Set(selected.flatMap(edge => [edge.from, edge.to]))];
  const ids = new Map(names.map((name, index) => [name, 'N' + index]));
  return ['```mermaid', 'flowchart LR', ...names.map(name => `    ${ids.get(name)}["${name}"]`),
    ...selected.map(edge => `    ${ids.get(edge.from)} --> ${ids.get(edge.to)}`), '```'].join('\n');
}
const wiring = rows.filter(edge => ['API entry', 'Express composition'].includes(edge.from));
const domain = rows.filter(edge => !['API entry', 'Express composition', 'HTTP middleware'].includes(edge.from)
  && !['HTTP middleware', 'Redis cache', 'Scheduler'].includes(edge.to));
const output = `# Generated API import map\n\nGenerated from the reachable imports of apps/api/src/main.ts.\n\n` +
  `${visited.size} API source files were read. Arrows mean grouped source imports, including type imports; they are not runtime calls, HTTP requests or database relationships. External packages and generic runtime helpers are omitted for readability.\n\n` +
  `## Entry-point composition\n\n${diagram(wiring)}\n\n## Cross-module dependencies\n\n${diagram(domain)}\n\n` +
  `## Extracted relationships\n\n| From | Imports | Import statements |\n|---|---|---:|\n` +
  rows.map(edge => `| ${edge.from} | ${edge.to} | ${edge.count} |`).join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, 'generated-api-map.md'), output);
console.log(`Created API study map from ${visited.size} reachable source files and ${rows.length} grouped relationships.`);
