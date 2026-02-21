// Quick script to capture the download from the already-loaded Mods program
// Connects to the same localhost:8080 and re-triggers calculate
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const port = 8080;
const PROGRAM_PATH = 'programs/machines/Roland/SRM-20%20mill/mill%202D%20PCB';
const SVG_FILE = '/Users/elsatch/dev/mods-mcp-server/mods-mcp-v2/mods/board.svg';
const OUTPUT_FILE = '/Users/elsatch/dev/mods-mcp-server/mods-mcp-v2/output/board-traces.rml';

async function run() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  // Load the program
  await page.goto(`http://localhost:${port}/?program=${PROGRAM_PATH}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.mods_prog_load === 'function', { timeout: 10000 });
  await page.waitForFunction(() => {
    const m = document.getElementById('modules');
    return m && m.childNodes.length > 0;
  }, { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Toggle save file on/off switch ON (id: 0.44105604671305754)
  await page.evaluate(() => {
    const mod = document.getElementById('0.44105604671305754');
    if (mod) {
      const cb = mod.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = true;
    }
  });

  // Apply preset
  await page.evaluate(() => {
    const mc = document.getElementById('modules');
    for (let c = 0; c < mc.childNodes.length; c++) {
      if (mc.childNodes[c].dataset.name === 'set PCB defaults') {
        for (const btn of mc.childNodes[c].querySelectorAll('button')) {
          if (btn.textContent.includes('mill traces (1/64)')) { btn.click(); break; }
        }
        break;
      }
    }
  });
  await page.waitForTimeout(500);

  // Load SVG
  await page.evaluate(() => {
    const mc = document.getElementById('modules');
    for (let c = 0; c < mc.childNodes.length; c++) {
      if (mc.childNodes[c].dataset.name === 'read SVG') {
        mc.childNodes[c].querySelector('input[type="file"]').setAttribute('data-testid', 'svg-input');
        break;
      }
    }
  });
  await page.locator('[data-testid="svg-input"]').setInputFiles(SVG_FILE);
  await page.waitForTimeout(2000);

  // Set up download listener and trigger calculate
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });

  await page.evaluate(() => {
    const mc = document.getElementById('modules');
    for (let c = 0; c < mc.childNodes.length; c++) {
      if (mc.childNodes[c].dataset.name === 'mill raster 2D') {
        for (const btn of mc.childNodes[c].querySelectorAll('button')) {
          if (btn.textContent.includes('calcul')) { btn.click(); break; }
        }
        break;
      }
    }
  });

  const download = await downloadPromise;
  const downloadPath = await download.path();
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(downloadPath);

  // Ensure output dir exists
  const { mkdir } = await import('node:fs/promises');
  await mkdir('/Users/elsatch/dev/mods-mcp-server/mods-mcp-v2/output', { recursive: true });

  await writeFile(OUTPUT_FILE, content);
  console.log(`Saved: ${OUTPUT_FILE} (${content.length} bytes)`);

  await browser.close();
}

run().catch(err => { console.error(err.message); process.exit(1); });
