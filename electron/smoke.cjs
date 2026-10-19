const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({ app, mainWindow, panes, root }) => {
  const checks = [];
  const check = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`); };
  try {
    await new Promise(resolve => setTimeout(resolve, 12000));
    const state = await mainWindow.webContents.executeJavaScript(`(() => ({
      frames: document.querySelectorAll('#comparison iframe').length,
      count: document.querySelector('#comparison-stage').dataset.count,
      sources: document.querySelectorAll('.compare-source').length,
      overflow: getComputedStyle(document.querySelector('#compare-source-0')).overflow,
      sandbox: [...document.querySelectorAll('iframe')].every(frame => frame.sandbox.contains('allow-scripts') && !frame.sandbox.contains('allow-top-navigation')),
      desktop: window.roadview?.desktop === true,
      noGrid: !document.querySelector('#view-grid')
    }))()`);
    check('desktop renderer and shared comparison initialized', state.desktop && state.frames === 2 && state.sources === 4 && state.count === '2' && state.noGrid, JSON.stringify(state));
    check('iframe isolation and mini-map clipping', state.sandbox && state.overflow === 'clip');
    check('no native views cover comparison', panes.size === 0);
    const prefs = mainWindow.webContents.getLastWebPreferences();
    check('local renderer isolation', prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration && prefs.webSecurity);
    const urls = mainWindow.webContents.mainFrame.frames.map(frame => frame.url);
    check('two real roadview documents loaded', urls.filter(url => url.startsWith('https://map.kakao.com/')).length === 2, JSON.stringify(urls));
  } catch (error) { check('desktop startup', false, error.stack); }
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(root, 'artifacts', 'smoke-results.json'), JSON.stringify(checks, null, 2));
  app.exit(checks.every(item => item.pass) ? 0 : 1);
};
