// End-to-end integration test
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';
import { listPrograms } from './src/programs.js';
import { listModules, getModuleInfo } from './src/modules.js';

const MODS_DIR = './mods';
const port = 8081;
let passed = 0;
let failed = 0;

function ok(msg) { passed++; console.log(`✓ ${msg}`); }
function fail(msg, err) { failed++; console.log(`✗ ${msg}: ${err}`); }

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
  console.log(`Server started on port ${port}\n`);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();

    // --- Test: Program Discovery ---
    console.log('## Program Discovery');
    const progs = await listPrograms();
    const machineProgs = await listPrograms('machines');
    ok(`listPrograms() returned ${progs.length} top-level categories`);
    ok(`listPrograms('machines') returned ${machineProgs.length} machines`);

    // --- Test: Module Discovery ---
    console.log('\n## Module Discovery');
    const mods = await listModules();
    ok(`listModules() returned ${mods.length} top-level categories`);

    const sliderInfo = await getModuleInfo('modules/ui/slider.js');
    if (sliderInfo.name === 'slider' && sliderInfo.outputs.value) {
      ok(`getModuleInfo('modules/ui/slider.js') parsed correctly: name=${sliderInfo.name}, outputs=[value]`);
    } else {
      fail('getModuleInfo slider', JSON.stringify(sliderInfo));
    }

    // --- Test: Load Mods CE ---
    console.log('\n## Browser & Page Load');
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.mods_prog_load === 'function', { timeout: 10000 });
    ok('Mods CE loaded in browser');

    // --- Test: Load Roland SRM-20 PCB Program ---
    console.log('\n## Load Program');
    const progPath = 'programs/machines/Roland/SRM-20%20mill/mill%202D%20PCB';
    await page.goto(`http://localhost:${port}/?program=${progPath}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.mods_prog_load === 'function', { timeout: 10000 });
    await page.waitForFunction(() => {
      const modules = document.getElementById('modules');
      return modules && modules.childNodes.length > 0;
    }, { timeout: 10000 });
    await page.waitForTimeout(1000);

    const state = await page.evaluate(() => {
      const modulesContainer = document.getElementById('modules');
      if (!modulesContainer) return [];
      const result = [];
      for (let c = 0; c < modulesContainer.childNodes.length; c++) {
        const mod = modulesContainer.childNodes[c];
        if (!mod.id) continue;
        const name = mod.dataset.name || '';
        const params = [];
        for (const input of mod.querySelectorAll('input')) {
          const prev = input.previousSibling;
          const label = prev ? prev.textContent.trim() : '';
          params.push({ label, value: input.value, type: input.type });
        }
        const buttons = [];
        for (const btn of mod.querySelectorAll('button')) {
          buttons.push(btn.textContent.trim());
        }
        result.push({ id: mod.id, name, params, buttons });
      }
      return result;
    });

    ok(`Loaded program with ${state.length} modules`);
    const moduleNames = state.map(m => m.name).filter(Boolean);
    ok(`Module names: ${moduleNames.join(', ')}`);

    // --- Test: Read State (threshold) ---
    console.log('\n## Read/Set Parameters');
    const thresholdMod = state.find(m => m.name === 'image threshold');
    if (thresholdMod) {
      const thresholdParam = thresholdMod.params.find(p => p.label.includes('threshold'));
      if (thresholdParam) {
        ok(`Read threshold param: "${thresholdParam.label}" = ${thresholdParam.value}`);
      } else {
        fail('Read threshold param', 'no threshold param found');
      }

      // --- Test: Set Parameter ---
      const setResult = await page.evaluate(({ moduleId, value }) => {
        const mod = document.getElementById(moduleId);
        if (!mod) return { error: 'not found' };
        const inputs = mod.querySelectorAll('input');
        for (const input of inputs) {
          const prev = input.previousSibling;
          const label = prev ? prev.textContent.trim() : '';
          if (label.includes('threshold')) {
            input.value = value;
            input.dispatchEvent(new Event('change'));
            return { success: true, newValue: input.value };
          }
        }
        return { error: 'param not found' };
      }, { moduleId: thresholdMod.id, value: '0.42' });

      if (setResult.success) {
        ok(`Set threshold to 0.42, verified: ${setResult.newValue}`);
      } else {
        fail('Set threshold', JSON.stringify(setResult));
      }

      // --- Test: Verify Change ---
      const verifyResult = await page.evaluate(({ moduleId }) => {
        const mod = document.getElementById(moduleId);
        const inputs = mod.querySelectorAll('input');
        for (const input of inputs) {
          const prev = input.previousSibling;
          const label = prev ? prev.textContent.trim() : '';
          if (label.includes('threshold')) return input.value;
        }
        return null;
      }, { moduleId: thresholdMod.id });

      if (verifyResult === '0.42') {
        ok(`Parameter change verified: threshold = ${verifyResult}`);
      } else {
        fail('Verify change', `expected 0.42, got ${verifyResult}`);
      }
    } else {
      fail('Find threshold module', 'not found');
    }

    // --- Summary ---
    console.log(`\n## Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } catch (err) {
    console.error('Test failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
