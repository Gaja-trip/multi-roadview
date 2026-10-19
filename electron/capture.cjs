const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({ app, mainWindow, panes, root, remoteSession, searchPlaces }) => {
  const directory = path.join(root, 'artifacts');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const failures = [];
  const consoleErrors = [];
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.focus();
  remoteSession.webRequest.onErrorOccurred(details => { const host = new URL(details.url).hostname; failures.push({ host, error: details.error }); });
  try {
    await pause(1500);
    for (const pane of panes.values()) pane.view.webContents.on('console-message', details => { if (details.level === 'error') consoleErrors.push(details.message); });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (panes.size === 4 && [...panes.values()].every(p => p.state.date)) break;
      await pause(400);
    }
    const before = [];
    for (const [index, pane] of panes) before.push({ index, state: pane.state, dom: await pane.view.webContents.executeJavaScript(`({date:document.querySelector('[data-id="nowDateBtn"]')?.outerHTML, past:document.querySelector('[data-id="pastInfo"]')?.className, items:document.querySelector('[data-id="pastIconContainer"]')?.outerHTML})`) });
    const histories = await mainWindow.webContents.executeJavaScript('Promise.all([0,1,2,3].map(index=>window.roadview.openHistory(index)))');
    console.log('ACTUAL HISTORY OPTIONS:', JSON.stringify(histories.map(items => items.map(item => item.date))));
    const selections = [];
    for (let index = 0; index < 4; index++) {
      const options = histories[index];
      if (options.length < 2) throw new Error(`Pane ${index + 1} did not return historical photography options`);
      const selected = options[Math.min(index * 2, options.length - 1)];
      selections.push({ index, date: selected.date, panoId: selected.panoId });
      await mainWindow.webContents.executeJavaScript(`window.roadview.selectDate(${JSON.stringify({ index, panoId: selected.panoId })})`);
    }
    await pause(10000);
    const diagnostics = [];
    for (const [index, pane] of panes) {
      diagnostics.push({ index, bounds: pane.view.getBounds(), state: pane.state, dom: await pane.view.webContents.executeJavaScript(`(() => {
        const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        return { title: document.title, date: [...document.querySelectorAll('[data-id="nowDateBtn"], [data-id="selectedDateBtn"], [data-id="date"]')].filter(visible).map(e => e.textContent.trim()), slider: document.querySelector('[data-id="slider"]')?.style.left, canvas: [...document.querySelectorAll('canvas')].map(e => ({ width:e.width, height:e.height })), text: document.body.innerText.slice(-1000) };
      })()`) });
      await fs.writeFile(path.join(directory, `live-pane-${index + 1}.png`), (await pane.view.webContents.capturePage()).toPNG());
    }
    await fs.writeFile(path.join(directory, 'live-desktop.png'), (await mainWindow.webContents.capturePage()).toPNG());
    console.log('LIVE VIEW:', JSON.stringify(diagnostics.map(p => ({ index: p.index, status: p.state.status, date: p.dom.date, canvas: p.dom.canvas }))));
    console.log('NETWORK ERRORS:', JSON.stringify(failures.slice(0, 15)));
    await fs.writeFile(path.join(directory, 'history-results.json'), JSON.stringify({ diagnostics, selections, histories, failures }, null, 2));
  } catch (error) {
    console.error(error.stack); console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors.slice(0, 15))); console.log('NETWORK ERRORS:', JSON.stringify(failures.slice(0, 20)));
    await fs.writeFile(path.join(directory, 'live-capture-error.txt'), error.stack);
    const first = panes.get(0); if (first) { try { await fs.writeFile(path.join(directory, 'failure-pane.png'), (await first.view.webContents.capturePage()).toPNG()); } catch {} console.log('FAILED DOM:', await first.view.webContents.executeJavaScript('JSON.stringify({canvas:document.querySelectorAll("canvas").length,width:innerWidth,height:innerHeight,text:document.body.innerText.slice(-700)})')); }
  }
  finally { app.quit(); }
};
