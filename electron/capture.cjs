const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({ app, mainWindow, panes, root }) => {
  const directory = path.join(root, 'artifacts');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let failed = false;
  await fs.mkdir(directory, { recursive: true });
  try {
    // Exercise the same original iframe documents the user sees.
    await mainWindow.webContents.executeJavaScript("document.querySelector('#split-four').click()");
    for (let attempt = 0; attempt < 100; attempt++) {
      if (panes.size === 4 && [...panes.values()].every(pane => pane.state.date)) break;
      await pause(400);
    }
    if (panes.size !== 4 || [...panes.values()].some(pane => !pane.state.date)) throw new Error('Four dated original iframe documents did not load.');
    const histories = await mainWindow.webContents.executeJavaScript('Promise.all([0,1,2,3].map(index => window.roadview.openHistory(index)))');
    const selections = [];
    for (let index = 0; index < 4; index++) {
      if (histories[index].length < 2) throw new Error(`Pane ${index + 1}: no historical dates supplied by original controls.`);
      const item = histories[index][Math.min(index * 2, histories[index].length - 1)];
      const result = await mainWindow.webContents.executeJavaScript(`window.roadview.selectDate(${JSON.stringify({ index, panoId: item.panoId })})`);
      selections.push({ index, requested: item.date, displayed: result.date });
    }
    const diagnostics = [];
    for (const [index, pane] of panes) {
      diagnostics.push({ index, state: pane.state, dom: await pane.frame.executeJavaScript(`(() => {
        const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        return { date: [...document.querySelectorAll('[data-id="selectedDateBtn"], [data-id="nowDateBtn"]')].filter(visible).map(el => el.textContent.trim()), slider: document.querySelector('[data-id="slider"]')?.style.left, canvas: document.querySelectorAll('canvas').length };
      })()`) });
    }
    await fs.writeFile(path.join(directory, 'live-desktop.png'), (await mainWindow.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(directory, 'history-results.json'), JSON.stringify({ diagnostics, histories, selections }, null, 2));
    console.log('KEYLESS ORIGINAL HISTORY:', JSON.stringify(selections));
  } catch (error) {
    failed = true; console.error(error.stack);
    await fs.writeFile(path.join(directory, 'live-capture-error.txt'), error.stack);
  } finally { app.exit(failed ? 1 : 0); }
};
