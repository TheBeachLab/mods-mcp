// Test program creation: create a 2-module program and load in Mods UI
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';
import { createProgram } from './src/programs.js';

const MODS_DIR = './mods';
const port = 8082;

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = join(MODS_DIR, urlPath);
  try {
    const content = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(port, async () => {
  console.log(`Server started on port ${port}`);
  let browser;
  try {
    // Create a simple 2-module program: generate event -> label
    console.log('\n## Creating program from modules');
    const programJson = await createProgram(
      ['modules/event/generate.js', 'modules/ui/label.js'],
      [{ from: 'generate event.output', to: 'label.text' }]
    );

    const moduleCount = Object.keys(programJson.modules).length;
    const linkCount = programJson.links.length;
    console.log(`✓ Program created: ${moduleCount} modules, ${linkCount} links`);

    // Verify the JSON structure
    for (const [id, mod] of Object.entries(programJson.modules)) {
      if (!id.startsWith('0.')) {
        console.log(`✗ Module ID doesn't look like a random float: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (!mod.definition || mod.definition.length < 100) {
        console.log(`✗ Module definition too short for ${id}`);
        process.exitCode = 1;
        return;
      }
    }
    console.log('✓ Module IDs are random floats');
    console.log('✓ Module definitions contain inlined IIFE source');

    // Verify link format (double-stringified)
    const linkStr = programJson.links[0];
    const linkObj = JSON.parse(linkStr);
    const source = JSON.parse(linkObj.source);
    const dest = JSON.parse(linkObj.dest);
    console.log(`✓ Link format verified: ${source.name} (${source.type}) -> ${dest.name} (${dest.type})`);

    // Load in browser
    console.log('\n## Loading in browser');
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.mods_prog_load === 'function', { timeout: 10000 });

    // Inject the program
    await page.evaluate((json) => {
      window.mods_prog_load(JSON.parse(json));
    }, JSON.stringify(programJson));
    await page.waitForTimeout(1000);

    // Verify modules appear in DOM
    const state = await page.evaluate(() => {
      const modulesContainer = document.getElementById('modules');
      if (!modulesContainer) return [];
      const result = [];
      for (let c = 0; c < modulesContainer.childNodes.length; c++) {
        const mod = modulesContainer.childNodes[c];
        if (!mod.id) continue;
        result.push(mod.dataset.name || '(unnamed)');
      }
      return result;
    });

    console.log(`✓ ${state.length} modules displayed in Mods UI: ${state.join(', ')}`);

    if (state.length === 2) {
      console.log('\n## Results: All tests passed');
    } else {
      console.log('\n## Results: Module count mismatch');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Test failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
