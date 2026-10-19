const fs = require('node:fs/promises');
const path = require('node:path');
const { readVisibleDate } = require('./frame-history.cjs');

module.exports = async ({ app, mainWindow, panes, root }) => {
  const directory = path.join(root, 'artifacts');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = script => mainWindow.webContents.executeJavaScript(script);
  let failed = false;
  await fs.mkdir(directory, { recursive: true });
  try {
    let initialized = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      initialized = await js("Boolean(document.querySelector('#compare-source-0 iframe'))");
      if (initialized) break;
      await pause(100);
    }
    if (!initialized) throw new Error('Local comparison UI did not initialize.');
    await js("document.querySelector('#split-four').click(); document.querySelector('#period-menu-tab').click()");
    let ready = false;
    for (let attempt = 0; attempt < 160; attempt++) {
      ready = await js("document.querySelector('#comparison-stage').dataset.periodState === 'ready' && document.querySelector('#comparison-stage').dataset.arranging === 'false'");
      if (ready && panes.size === 4) break;
      await pause(400);
    }
    if (!ready || panes.size !== 4) {
      const state = await js("({stage:{...document.querySelector('#comparison-stage').dataset},status:document.querySelector('#period-status').textContent,errors:[...document.querySelectorAll('.period-editor .inline-error')].map(e=>e.textContent)})");
      throw new Error('Four historical photos did not finish automatic arrangement: ' + JSON.stringify(state));
    }
    await pause(2200);
    const diagnostics = [];
    for (const [index, pane] of panes) {
      diagnostics.push({ index, date: await readVisibleDate(pane.frame), dom: await pane.frame.executeJavaScript(`(() => {
        const viewer = window.Application?.roadviewController?.viewer_?.();
        const map = document.querySelector('[id="view.map"]');
        return { point: viewer?.getViewpoint?.(), slider: document.querySelector('[data-id="slider"]')?.style.left, mapHidden: !map || getComputedStyle(map).opacity === '0' };
      })()`) });
    }
    const years = diagnostics.map(pane => pane.date.match(/20\d{2}/)?.[0]);
    if (new Set(years).size !== 4) throw new Error('Capture does not show four distinct offered years.');
    if (diagnostics.some(pane => !pane.dom.mapHidden)) throw new Error('The original map still covers the panorama.');
    await fs.writeFile(path.join(directory, 'year-comparison-desktop.png'), (await mainWindow.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(directory, 'year-comparison-capture.json'), JSON.stringify({ diagnostics }, null, 2));
    console.log('KEYLESS YEAR COMPARISON', JSON.stringify(diagnostics));
  } catch (error) {
    failed = true; console.error(error.stack);
    await fs.writeFile(path.join(directory, 'live-capture-error.txt'), error.stack);
  } finally { app.exit(failed ? 1 : 0); }
};
