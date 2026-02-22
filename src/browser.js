// browser.js — Playwright browser lifecycle and page interaction

import { chromium } from 'playwright';

let browser = null;
let page = null;
let downloads = []; // captured download files

export async function launch(port, headless = false) {
  browser = await chromium.launch({ headless, channel: 'chrome' });
  const context = await browser.newContext({ acceptDownloads: true });
  page = await context.newPage();

  // Intercept downloads
  page.on('download', async (download) => {
    const path = await download.path();
    const { readFile } = await import('node:fs/promises');
    const content = path ? await readFile(path) : null;
    downloads.push({
      suggestedFilename: download.suggestedFilename(),
      content,
      timestamp: Date.now()
    });
  });

  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  // Wait for mods.js to initialize (prog_load is set on window)
  await page.waitForFunction(() => typeof window.prog_load === 'function', { timeout: 10000 });

  return page;
}

export async function loadProgram(port, programPath) {
  if (!page) throw new Error('Browser not launched');
  const encodedPath = programPath.split('/').map(encodeURIComponent).join('/');
  await page.goto(`http://localhost:${port}/?program=${encodedPath}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.prog_load === 'function', { timeout: 10000 });
  // Wait for program modules to appear in DOM
  await page.waitForFunction(() => {
    const modules = document.getElementById('modules');
    return modules && modules.childNodes.length > 0;
  }, { timeout: 10000 });
  // Extra wait for UI to settle
  await page.waitForTimeout(500);
}

export async function getProgramState() {
  if (!page) throw new Error('Browser not launched');
  return page.evaluate(() => {
    const modulesContainer = document.getElementById('modules');
    if (!modulesContainer) return [];

    // Parse SVG links to build connection map
    const connections = {}; // moduleId -> { inputs: [{from, port}], outputs: [{to, port}] }
    const svg = document.getElementById('svg');
    if (svg) {
      const linksGroup = svg.getElementById('links');
      if (linksGroup) {
        for (let l = 0; l < linksGroup.childNodes.length; l++) {
          const link = linksGroup.childNodes[l];
          if (!link.id) continue;
          try {
            const linkData = JSON.parse(link.id);
            const source = JSON.parse(linkData.source);
            const dest = JSON.parse(linkData.dest);
            // source: {id, type:"outputs", name:"portName"}
            // dest: {id, type:"inputs", name:"portName"}
            if (!connections[source.id]) connections[source.id] = { inputs: [], outputs: [] };
            if (!connections[dest.id]) connections[dest.id] = { inputs: [], outputs: [] };
            // Find module names for readable connection info
            const srcMod = document.getElementById(source.id);
            const destMod = document.getElementById(dest.id);
            const srcName = srcMod ? srcMod.dataset.name : source.id;
            const destName = destMod ? destMod.dataset.name : dest.id;
            connections[source.id].outputs.push({
              to: destName,
              toId: dest.id,
              port: source.name + ' → ' + dest.name
            });
            connections[dest.id].inputs.push({
              from: srcName,
              fromId: source.id,
              port: source.name + ' → ' + dest.name
            });
          } catch (e) {
            // Skip unparseable links
          }
        }
      }
    }

    const result = [];
    for (let c = 0; c < modulesContainer.childNodes.length; c++) {
      const mod = modulesContainer.childNodes[c];
      const id = mod.id;
      if (!id) continue;
      const name = mod.dataset.name || '';
      const params = [];
      const inputs = mod.querySelectorAll('input');
      for (const input of inputs) {
        let label = '';
        const prev = input.previousSibling;
        if (prev && prev.textContent) label = prev.textContent.trim();
        if (input.type === 'checkbox') {
          params.push({
            label,
            value: input.checked ? 'true' : 'false',
            type: 'checkbox'
          });
        } else {
          params.push({
            label,
            value: input.value,
            type: input.type
          });
        }
      }
      const buttons = [];
      for (const btn of mod.querySelectorAll('button')) {
        buttons.push(btn.textContent.trim());
      }
      const entry = { id, name, params, buttons };
      // Add connection info if available
      if (connections[id]) {
        entry.connectedFrom = connections[id].inputs;
        entry.connectedTo = connections[id].outputs;
      }
      result.push(entry);
    }
    return result;
  });
}

export async function readModuleInput(moduleId, paramName) {
  if (!page) throw new Error('Browser not launched');
  return page.evaluate(({ moduleId, paramName }) => {
    const mod = document.getElementById(moduleId);
    if (!mod) return { error: `Module ${moduleId} not found` };
    const inputs = mod.querySelectorAll('input');
    for (const input of inputs) {
      const prev = input.previousSibling;
      const label = prev ? prev.textContent.trim() : '';
      if (label.includes(paramName)) return { value: input.value, label };
    }
    return { error: `Parameter "${paramName}" not found in module ${moduleId}` };
  }, { moduleId, paramName });
}

export async function setModuleInput(moduleId, paramName, value) {
  if (!page) throw new Error('Browser not launched');
  return page.evaluate(({ moduleId, paramName, value }) => {
    const mod = document.getElementById(moduleId);
    if (!mod) return { error: `Module ${moduleId} not found` };
    const inputs = mod.querySelectorAll('input');
    for (const input of inputs) {
      const prev = input.previousSibling;
      const label = prev ? prev.textContent.trim() : '';
      if (label.includes(paramName)) {
        if (input.type === 'checkbox') {
          input.checked = (value === 'true' || value === '1' || value === 'on');
          input.dispatchEvent(new Event('change'));
          return { success: true, label, type: 'checkbox', newValue: input.checked };
        } else {
          input.value = value;
          input.dispatchEvent(new Event('change'));
          return { success: true, label, newValue: value };
        }
      }
    }
    return { error: `Parameter "${paramName}" not found in module ${moduleId}` };
  }, { moduleId, paramName, value: String(value) });
}

export async function clickModuleButton(moduleId, buttonText) {
  if (!page) throw new Error('Browser not launched');
  return page.evaluate(({ moduleId, buttonText }) => {
    const mod = document.getElementById(moduleId);
    if (!mod) return { error: `Module ${moduleId} not found` };
    const buttons = mod.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.trim().toLowerCase().includes(buttonText.toLowerCase())) {
        btn.click();
        return { success: true, clicked: btn.textContent.trim() };
      }
    }
    const available = Array.from(buttons).map(b => b.textContent.trim());
    return { error: `Button "${buttonText}" not found`, available };
  }, { moduleId, buttonText });
}

export async function injectProgram(programJson) {
  if (!page) throw new Error('Browser not launched');
  await page.evaluate((json) => {
    const prog = JSON.parse(json);
    window.prog_load(prog);
  }, JSON.stringify(programJson));
  await page.waitForTimeout(1000);
}

export async function extractProgramState() {
  if (!page) throw new Error('Browser not launched');
  // Replicate the logic from mods.js save_program() without the download
  return page.evaluate(() => {
    const prog = { modules: {}, links: [] };
    const modulesContainer = document.getElementById('modules');
    if (!modulesContainer) return null;

    for (let c = 0; c < modulesContainer.childNodes.length; c++) {
      const mod = modulesContainer.childNodes[c];
      const idnumber = mod.id;
      if (!idnumber) continue;
      prog.modules[idnumber] = {
        definition: mod.dataset.definition || '',
        top: mod.dataset.top || '0',
        left: mod.dataset.left || '0',
        filename: mod.dataset.filename || '',
        inputs: {},
        outputs: {}
      };
    }

    const svg = document.getElementById('svg');
    if (svg) {
      const links = svg.getElementById('links');
      if (links) {
        for (let l = 0; l < links.childNodes.length; l++) {
          const link = links.childNodes[l];
          if (link.id) prog.links.push(link.id);
        }
      }
    }

    return prog;
  });
}

export async function setModuleFile(moduleId, filePath) {
  if (!page) throw new Error('Browser not launched');
  // Use attribute selector to avoid CSS escaping issues with dot-containing IDs
  const input = page.locator(`[id="${moduleId}"] input[type="file"]`);
  const count = await input.count();
  if (count === 0) {
    return { error: `No file input found in module ${moduleId}` };
  }
  await input.setInputFiles(filePath);
  // Wait for module to process the file
  await page.waitForTimeout(2000);
  return { success: true, file: filePath };
}

export function getLatestDownload() {
  if (downloads.length === 0) return null;
  return downloads[downloads.length - 1];
}

export function clearDownloads() {
  downloads = [];
}

export function getPage() {
  return page;
}

export function isLaunched() {
  return browser !== null && page !== null;
}

export async function close() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}
