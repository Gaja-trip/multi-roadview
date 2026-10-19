const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({ app, mainWindow, panes, root }) => {
  const directory = path.join(root, 'artifacts');
  await fs.mkdir(directory, { recursive: true });
  const checks = [];
  const check = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); };
  const js = code => mainWindow.webContents.executeJavaScript(code);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  mainWindow.webContents.on('console-message', details => { if (details.level === 'error') console.log('RENDERER:', details.message); });
  try {
    await pause(2000);
    check('four native panes created', panes.size === 4, String(panes.size));
    check('remote isolation', [...panes.values()].every(p => { const prefs = p.view.webContents.getLastWebPreferences(); return prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration && !prefs.preload; }));
    await js("document.querySelector('#split-two').click()"); await pause(300);
    check('two panes visible', [...panes.values()].filter(p => p.attached).length === 2, String([...panes.values()].filter(p => p.attached).length));
    await js("document.querySelector('[data-action=expand]').click()"); await pause(250);
    check('one pane maximized', [...panes.values()].filter(p => p.attached).length === 1, String([...panes.values()].filter(p => p.attached).length));
    await js("document.querySelector('#help-button').click()"); await pause(250);
    check('modal covers native views safely', [...panes.values()].every(p => !p.attached));
    await js("document.querySelector('#help-dialog').close(); document.querySelector('#split-four').click()"); await pause(300);
    check('four panes restored after modal', [...panes.values()].filter(p => p.attached).length === 4);
    const preset = await js("window.roadview.search('서울시청')"); check('address search returns coordinates', preset.places[0].lat === 37.5665);
    const blocked = await js("window.roadview.setLink({index:0,url:'https://example.com'}).then(()=>false,()=>true)"); check('untrusted navigation blocked', blocked);
    await js("window.roadview.move({name:'광화문',address:'서울특별시 종로구 사직로 161',lat:37.5759,lng:126.9768})");
    check('all panes move to same coordinates', [...panes.values()].every(p => p.state.url.includes('37.5759,126.9768')));
    await js("document.querySelector('[data-preset=\"1\"]').click()");
    await pause(20000);
    check('four remote pages connected', [...panes.values()].every(p => p.loaded), JSON.stringify([...panes.values()].map(p => ({ status: p.state.status, url: p.state.url, date: p.state.date }))));
    const diagnostics = [];
    for (const [index, pane] of panes) diagnostics.push({ index, bounds: pane.view.getBounds(), url: pane.state.url, text: await pane.view.webContents.executeJavaScript('document.body.innerText.slice(-2000)') });
    await fs.writeFile(path.join(directory, 'remote-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    await fs.writeFile(path.join(directory, 'desktop.png'), (await mainWindow.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
    await js("document.querySelector('#help-button').click()"); await pause(200);
    await fs.writeFile(path.join(directory, 'help.png'), (await mainWindow.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
    await fs.writeFile(path.join(directory, 'smoke-results.json'), JSON.stringify(checks, null, 2));
  } catch (error) { check('smoke execution', false, error.stack); await fs.writeFile(path.join(directory, 'smoke-results.json'), JSON.stringify(checks, null, 2)); }
  finally { app.exit(checks.every(check => check.pass) ? 0 : 1); }
};
