// server.js — MCP server setup, HTTP server, and tool routing

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as browser from './browser.js';
import * as programs from './programs.js';
import * as modules from './modules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODS_DIR = join(__dirname, '..', 'mods');

// Parse CLI arguments
const args = process.argv.slice(2);
let port = 8080;
let headless = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  }
  if (args[i] === '--headless') headless = true;
}

// MIME types for static file serving
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// --- HTTP Static File Server ---
const httpServer = createServer(async (req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = join(MODS_DIR, urlPath);

  try {
    // Prevent directory traversal
    if (!filePath.startsWith(MODS_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      // Try index.html in directory
      const indexPath = join(filePath, 'index.html');
      const content = await readFile(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
      return;
    }
    const content = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

// --- State ---
let loadedProgram = null;

// --- MCP Server ---
const mcpServer = new McpServer({
  name: 'mods-mcp-v2',
  version: '0.1.0'
});

// Helper to find module by name or ID in current program state
async function findModule(moduleName, moduleId) {
  const state = await browser.getProgramState();
  // If ID is provided, use exact match
  if (moduleId) {
    const mod = state.find(m => m.id === moduleId);
    if (!mod) {
      return { error: `Module with ID "${moduleId}" not found.` };
    }
    return { module: mod };
  }
  const mod = state.find(m => m.name.toLowerCase().includes(moduleName.toLowerCase()));
  if (!mod) {
    const available = state.map(m => m.name).filter(Boolean);
    return { error: `Module "${moduleName}" not found. Available: ${available.join(', ')}` };
  }
  return { module: mod };
}

// --- Tool: get_server_status ---
mcpServer.tool(
  'get_server_status',
  'Get server health, browser state, HTTP URL, and loaded program',
  {},
  async () => {
    const status = {
      server: 'running',
      httpUrl: `http://localhost:${port}/`,
      browser: browser.isLaunched() ? 'connected' : 'not launched',
      loadedProgram: loadedProgram || 'none'
    };
    if (browser.isLaunched() && loadedProgram) {
      try {
        const state = await browser.getProgramState();
        status.moduleCount = state.length;
        status.moduleNames = state.map(m => m.name).filter(Boolean);
      } catch { /* ignore */ }
    }
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }
);

// --- Tool: list_programs ---
mcpServer.tool(
  'list_programs',
  'List available Mods programs organized by category',
  { category: z.string().optional().describe('Filter by category (e.g., "machines", "processes", "image")') },
  async ({ category }) => {
    const result = await programs.listPrograms(category);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Tool: list_modules ---
mcpServer.tool(
  'list_modules',
  'List available Mods modules organized by category',
  { category: z.string().optional().describe('Filter by category (e.g., "path/formats", "image", "mesh")') },
  async ({ category }) => {
    const result = await modules.listModules(category);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Tool: get_module_info ---
mcpServer.tool(
  'get_module_info',
  'Parse a module file and return its name, inputs, outputs with types',
  {
    path: z.string().describe('Module path (e.g., "modules/read/stl.js")'),
    include_source: z.boolean().optional().describe('Include full IIFE source in response')
  },
  async ({ path, include_source }) => {
    const result = await modules.getModuleInfo(path, include_source);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Tool: load_program ---
mcpServer.tool(
  'load_program',
  'Load a preset program in the browser by path',
  { path: z.string().describe('Program path (e.g., "programs/machines/Roland/SRM-20 mill/mill 2D PCB")') },
  async ({ path }) => {
    if (!browser.isLaunched()) {
      return { content: [{ type: 'text', text: 'Error: Browser not launched yet. Server is still starting.' }], isError: true };
    }
    await browser.loadProgram(port, path);
    loadedProgram = path;
    const state = await browser.getProgramState();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          loaded: path,
          modules: state.map(m => ({ id: m.id, name: m.name, paramCount: m.params.length, buttons: m.buttons }))
        }, null, 2)
      }]
    };
  }
);

// --- Tool: get_program_state ---
mcpServer.tool(
  'get_program_state',
  'Get current state of all modules in the loaded program',
  {},
  async () => {
    if (!browser.isLaunched()) {
      return { content: [{ type: 'text', text: 'Error: Browser not launched.' }], isError: true };
    }
    if (!loadedProgram) {
      return { content: [{ type: 'text', text: 'Error: No program loaded. Use load_program first.' }], isError: true };
    }
    const state = await browser.getProgramState();
    return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
  }
);

// --- Tool: set_parameter ---
mcpServer.tool(
  'set_parameter',
  'Set a parameter value in a specific module',
  {
    module_name: z.string().describe('Module name (or partial match)'),
    parameter: z.string().describe('Parameter label (or partial match)'),
    value: z.string().describe('New value to set')
  },
  async ({ module_name, parameter, value }) => {
    if (!browser.isLaunched()) {
      return { content: [{ type: 'text', text: 'Error: Browser not launched.' }], isError: true };
    }
    // Support "module_name:module_id" syntax for disambiguation
    let name = module_name;
    let id = undefined;
    if (module_name.includes(':0.')) {
      const parts = module_name.split(':');
      name = parts[0];
      id = parts.slice(1).join(':');
    }
    const found = await findModule(name, id);
    if (found.error) {
      return { content: [{ type: 'text', text: found.error }], isError: true };
    }
    const result = await browser.setModuleInput(found.module.id, parameter, value);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Tool: trigger_action ---
mcpServer.tool(
  'trigger_action',
  'Click a button in a module (calculate, view, export, etc.)',
  {
    module_name: z.string().describe('Module name (or partial match)'),
    action: z.string().describe('Button text to click (or partial match)')
  },
  async ({ module_name, action }) => {
    if (!browser.isLaunched()) {
      return { content: [{ type: 'text', text: 'Error: Browser not launched.' }], isError: true };
    }
    browser.clearDownloads();
    // Support "module_name:module_id" syntax for disambiguation
    let name = module_name;
    let id = undefined;
    if (module_name.includes(':0.')) {
      const parts = module_name.split(':');
      name = parts[0];
      id = parts.slice(1).join(':');
    }
    const found = await findModule(name, id);
    if (found.error) {
      return { content: [{ type: 'text', text: found.error }], isError: true };
    }
    const result = await browser.clickModuleButton(found.module.id, action);
    // Wait a bit for any downloads to be triggered
    await new Promise(r => setTimeout(r, 2000));
    const download = browser.getLatestDownload();
    if (download) {
      result.download = {
        filename: download.suggestedFilename,
        size: download.content ? download.content.length : 0
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Tool: load_file ---
mcpServer.tool(
  'load_file',
  'Load a file into a module\'s file input (for read SVG, read png, etc.)',
  {
    module_name: z.string().describe('Module name (or partial match, or name:id for disambiguation)'),
    file_path: z.string().describe('Absolute path to the file to load')
  },
  async ({ module_name, file_path }) => {
    if (!browser.isLaunched()) {
      return { content: [{ type: 'text', text: 'Error: Browser not launched.' }], isError: true };
    }
    let name = module_name;
    let id = undefined;
    if (module_name.includes(':0.')) {
      const parts = module_name.split(':');
      name = parts[0];
      id = parts.slice(1).join(':');
    }
    const found = await findModule(name, id);
    if (found.error) {
      return { content: [{ type: 'text', text: found.error }], isError: true };
    }
    // Verify the file exists
    try {
      await stat(file_path);
    } catch {
      return { content: [{ type: 'text', text: `Error: File not found: ${file_path}` }], isError: true };
    }
    const result = await browser.setModuleFile(found.module.id, file_path);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Tool: export_file ---
mcpServer.tool(
  'export_file',
  'Get the most recently downloaded/exported file from Mods',
  {},
  async () => {
    const download = browser.getLatestDownload();
    if (!download) {
      return { content: [{ type: 'text', text: 'No file has been exported yet. Use trigger_action to trigger an export.' }], isError: true };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          filename: download.suggestedFilename,
          size: download.content ? download.content.length : 0,
          content: download.content ? download.content.toString('utf-8').slice(0, 10000) : null
        }, null, 2)
      }]
    };
  }
);

// --- Tool: create_program ---
mcpServer.tool(
  'create_program',
  'Build a new program from modules and connections, load in browser',
  {
    modules: z.array(z.string()).describe('Module paths (e.g., ["modules/read/stl.js", "modules/mesh/rotate.js"])'),
    links: z.array(z.object({
      from: z.string().describe('Source: "moduleName.outputPort"'),
      to: z.string().describe('Destination: "moduleName.inputPort"')
    })).describe('Connections between modules')
  },
  async ({ modules: modulePaths, links }) => {
    if (!browser.isLaunched()) {
      return { content: [{ type: 'text', text: 'Error: Browser not launched.' }], isError: true };
    }
    try {
      const programJson = await programs.createProgram(modulePaths, links);
      await browser.injectProgram(programJson);
      loadedProgram = 'custom (created)';
      const state = await browser.getProgramState();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            created: true,
            moduleCount: Object.keys(programJson.modules).length,
            linkCount: programJson.links.length,
            modules: state.map(m => ({ id: m.id, name: m.name }))
          }, null, 2)
        }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error creating program: ${err.message}` }], isError: true };
    }
  }
);

// --- Tool: save_program ---
mcpServer.tool(
  'save_program',
  'Save the current program state to a file',
  { name: z.string().describe('File name for the saved program (no extension)') },
  async ({ name }) => {
    if (!browser.isLaunched()) {
      return { content: [{ type: 'text', text: 'Error: Browser not launched.' }], isError: true };
    }
    const programState = await browser.extractProgramState();
    if (!programState) {
      return { content: [{ type: 'text', text: 'Error: Could not extract program state. Is prog_save() available?' }], isError: true };
    }
    const outPath = await programs.saveProgram(programState, name);
    return { content: [{ type: 'text', text: JSON.stringify({ saved: true, path: outPath }, null, 2) }] };
  }
);

// --- Startup ---
async function start() {
  // Start HTTP server
  httpServer.listen(port, () => {
    console.error(`[mods-mcp-v2] HTTP server serving Mods CE at http://localhost:${port}/`);
  });

  // Launch browser
  try {
    await browser.launch(port, headless);
    console.error(`[mods-mcp-v2] Browser launched (${headless ? 'headless' : 'headed'})`);
  } catch (err) {
    console.error(`[mods-mcp-v2] Browser launch failed: ${err.message}`);
    console.error('[mods-mcp-v2] Run "npx playwright install chromium" to install browsers');
  }

  // Start MCP server on stdio
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[mods-mcp-v2] MCP server running on stdio');
}

// --- Cleanup ---
async function cleanup() {
  console.error('[mods-mcp-v2] Shutting down...');
  await browser.close();
  httpServer.close();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

start().catch(err => {
  console.error(`[mods-mcp-v2] Fatal error: ${err.message}`);
  process.exit(1);
});
