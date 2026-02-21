// Standalone script: Load SVG → Run PCB milling pipeline → Save output file
import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';

const port = 8080;
const SVG_FILE = '/Users/elsatch/dev/mods-mcp-server/mods-mcp-v2/mods/board.svg';
const PROGRAM_PATH = 'programs/machines/Roland/SRM-20%20mill/mill%202D%20PCB';

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  page.on('console', msg => console.log(`  [browser] ${msg.text()}`));

  // Load the program
  console.log('1. Loading Roland SRM-20 PCB program...');
  await page.goto(`http://localhost:${port}/?program=${PROGRAM_PATH}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.mods_prog_load === 'function', { timeout: 10000 });
  await page.waitForFunction(() => {
    const m = document.getElementById('modules');
    return m && m.childNodes.length > 0;
  }, { timeout: 10000 });
  await page.waitForTimeout(2000);
  console.log('   Program loaded.');

  // Load SVG via setInputFiles
  console.log('2. Loading SVG file...');
  await page.evaluate(() => {
    const mc = document.getElementById('modules');
    for (let c = 0; c < mc.childNodes.length; c++) {
      if (mc.childNodes[c].dataset.name === 'read SVG') {
        const fi = mc.childNodes[c].querySelector('input[type="file"]');
        fi.setAttribute('data-testid', 'svg-file-input');
        return true;
      }
    }
    return false;
  });
  await page.locator('[data-testid="svg-file-input"]').setInputFiles(SVG_FILE);
  console.log('   SVG file set on input.');

  // Wait and check that the read SVG module processed the file
  console.log('3. Waiting for SVG processing...');
  await page.waitForTimeout(3000);
  const svgStatus = await page.evaluate(() => {
    const mc = document.getElementById('modules');
    for (let c = 0; c < mc.childNodes.length; c++) {
      if (mc.childNodes[c].dataset.name === 'read SVG') {
        const info = mc.childNodes[c].querySelectorAll('div');
        const texts = [];
        for (const d of info) {
          if (d.textContent && d.textContent.includes('width')) texts.push(d.textContent.trim());
        }
        return texts.join(' | ');
      }
    }
    return 'not found';
  });
  console.log(`   SVG module state: ${svgStatus}`);

  // Wait for convert SVG image to process
  console.log('4. Waiting for image conversion...');
  await page.waitForTimeout(5000);
  const convertStatus = await page.evaluate(() => {
    const mc = document.getElementById('modules');
    for (let c = 0; c < mc.childNodes.length; c++) {
      if (mc.childNodes[c].dataset.name === 'convert SVG image') {
        const texts = [];
        for (const child of mc.childNodes[c].querySelectorAll('*')) {
          if (child.textContent && child.textContent.includes('dpi')) texts.push(child.textContent.trim().substring(0, 100));
        }
        return texts.length > 0 ? texts[0] : 'no info';
      }
    }
    return 'not found';
  });
  console.log(`   Convert SVG state: ${convertStatus}`);

  // Set up download listener BEFORE triggering calculate
  console.log('5. Clicking "calculate" on mill raster 2D...');
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 }).catch(() => null);

  await page.evaluate(() => {
    const mc = document.getElementById('modules');
    for (let c = 0; c < mc.childNodes.length; c++) {
      if (mc.childNodes[c].dataset.name === 'mill raster 2D') {
        for (const btn of mc.childNodes[c].querySelectorAll('button')) {
          if (btn.textContent.trim() === 'calculate') {
            btn.click();
            return true;
          }
        }
      }
    }
    return false;
  });
  console.log('   Calculate clicked. Waiting for output (up to 2 min)...');

  const download = await downloadPromise;

  if (download) {
    const downloadPath = await download.path();
    const filename = download.suggestedFilename();
    const content = await readFile(downloadPath, 'utf-8');
    const outPath = `/Users/elsatch/dev/mods-mcp-server/mods-mcp-v2/${filename}`;
    await writeFile(outPath, content);
    console.log(`\n✓ Output saved to: ${outPath}`);
    console.log(`  File: ${filename}`);
    console.log(`  Size: ${content.length} bytes`);
    console.log(`  First 5 lines:\n${content.split('\n').slice(0, 5).join('\n')}`);
  } else {
    console.log('\n✗ No download captured within 2 minutes.');
    // Check save file module state for clues
    const saveState = await page.evaluate(() => {
      const mc = document.getElementById('modules');
      for (let c = 0; c < mc.childNodes.length; c++) {
        if (mc.childNodes[c].dataset.name === 'save file') {
          return mc.childNodes[c].textContent.substring(0, 200);
        }
      }
      return 'not found';
    });
    console.log(`  save file module state: ${saveState}`);
  }

  console.log('\nKeeping browser open for 20 seconds...');
  await page.waitForTimeout(20000);
  await browser.close();
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
