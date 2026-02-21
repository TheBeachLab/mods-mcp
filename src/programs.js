// programs.js — Program discovery, loading, and JSON creation

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODS_DIR = join(__dirname, '..', 'mods');
const PROGRAMS_DIR = join(MODS_DIR, 'programs');

async function scanDir(dir, base) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const children = await scanDir(fullPath, base);
      results.push({
        name: entry.name,
        type: 'category',
        children
      });
    } else if (entry.name !== 'index.js' && !entry.name.startsWith('.')) {
      const stats = await stat(fullPath);
      const relPath = relative(base, fullPath);
      results.push({
        name: entry.name,
        type: 'program',
        path: relPath,
        size: stats.size
      });
    }
  }
  return results;
}

export async function listPrograms(category) {
  let scanRoot = PROGRAMS_DIR;
  if (category) {
    scanRoot = join(PROGRAMS_DIR, category);
  }
  return scanDir(scanRoot, MODS_DIR);
}

export async function createProgram(modulePaths, links) {
  const modules = {};
  const nameToId = {};

  for (const modPath of modulePaths) {
    const fullPath = join(MODS_DIR, modPath);
    const source = await readFile(fullPath, 'utf-8');
    const id = Math.random().toString();
    modules[id] = {
      definition: source,
      top: '100',
      left: '100',
      filename: modPath,
      inputs: {},
      outputs: {}
    };
    // Extract module name from source for link resolution
    const nameMatch = source.match(/var\s+name\s*=\s*['"]([^'"]+)['"]/);
    if (nameMatch) {
      nameToId[nameMatch[1]] = id;
    }
  }

  // Build double-stringified links
  const programLinks = [];
  for (const link of links) {
    const [fromModule, fromPort] = link.from.split('.');
    const [toModule, toPort] = link.to.split('.');

    const sourceId = nameToId[fromModule];
    const destId = nameToId[toModule];
    if (!sourceId || !destId) {
      throw new Error(`Module not found in link: ${!sourceId ? fromModule : toModule}`);
    }

    const linkObj = {
      source: JSON.stringify({ id: sourceId, type: 'outputs', name: fromPort }),
      dest: JSON.stringify({ id: destId, type: 'inputs', name: toPort })
    };
    programLinks.push(JSON.stringify(linkObj));
  }

  return { modules, links: programLinks };
}

export async function saveProgram(programJson, name) {
  const outPath = join(PROGRAMS_DIR, 'custom', name);
  const dir = dirname(outPath);
  await readdir(dir).catch(() => {
    import('node:fs').then(fs => fs.mkdirSync(dir, { recursive: true }));
  });
  await writeFile(outPath, JSON.stringify(programJson, null, 2));
  return outPath;
}
