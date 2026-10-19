const fs = require('node:fs/promises');
const path = require('node:path');
const { angularDistance, normalize } = require('./rotation-sync.cjs');

module.exports = async ({ app, mainWindow, root, rotation, getPane, readRotation }) => {
  const output = path.join(root, 'artifacts');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = script => mainWindow.webContents.executeJavaScript(script);
  const checks = [];
  async function waitFor(label, predicate, timeout = 45000) {
    const until = Date.now() + timeout;
    let value;
    while (Date.now() < until) {
      try { value = await predicate(); if (value) return value; } catch { /* Frames may still be loading. */ }
      await pause(180);
    }
    throw new Error(`${label} timed out; state=${JSON.stringify(rotation.getState())}`);
  }
  async function readings(count) {
    return Promise.all(Array.from({ length: count }, (_, index) => readRotation(getPane(index))));
  }
  async function synchronized(count, leader) {
    return waitFor(`${count} pane synchronization`, async () => {
      const state = rotation.getState();
      if (!state.enabled || state.count !== count || !state.synchronized || (leader !== undefined && state.leader !== leader)) return false;
      const views = await readings(count);
      if (views.some(view => !view)) return false;
      const source = views[state.leader];
      return views.every((view, index) => angularDistance(view.pan, normalize(source.pan + (index - state.leader) * 360 / count)) <= 1.5 && Math.abs(view.tilt - source.tilt) <= 1 && Math.abs(view.zoom - source.zoom) <= .01) && { state, views };
    });
  }
  async function drag(index, horizontal = -100, vertical = 0) {
    const rect = await js(`(() => { const r = document.querySelector('#compare-source-${index}').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    const x = Math.round(rect.x + rect.width * .67), y = Math.round(rect.y + 44 + (rect.height - 44) * .63);
    const wc = mainWindow.webContents;
    mainWindow.focus(); wc.focus();
    // DevTools input reaches the real cross-origin hit-tested renderer even
    // when the offscreen integration window has no OS keyboard focus.
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    const mouse = (type, mx, my, buttons = 0) => wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: mx, y: my, button: buttons || type === 'mouseReleased' ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, 1);
    for (let step = 1; step <= 10; step++) {
      await mouse('mouseMoved', Math.round(x + horizontal * step / 10), Math.round(y + vertical * step / 10), 1);
      await pause(30);
    }
    await mouse('mouseReleased', x + horizontal, y + vertical);
    await pause(600);
    console.log('DRAG', index, JSON.stringify(await readRotation(getPane(index))));
  }
  function record(name, details) { checks.push({ name, ...details }); console.log('PASS', name, JSON.stringify(details)); }
  let failed = false;
  try {
    await fs.mkdir(output, { recursive: true });
    await js("if (!document.querySelector('#rotation-enabled').checked) document.querySelector('#rotation-enabled').click(); document.querySelector('#compare-split').click(); document.querySelector('#split-two').click();");
    const start = await synchronized(2);
    record('2 panes initially opposite', start);
    await drag(1);
    const opposite = await synchronized(2, 1);
    if (angularDistance(start.views[1].pan, opposite.views[1].pan) < 5) throw new Error('Trusted drag did not rotate source B.');
    if (opposite.views.some((view, index) => view.panoId !== start.views[index].panoId || view.version !== start.views[index].version)) throw new Error('Rotation changed panorama or frame.');
    record('B drag rotates A by 180 degrees', opposite);

    await js("document.querySelector('#split-four').click()");
    const four = await synchronized(4);
    record('4 panes initially spaced 90 degrees', four);
    await drag(3, -85, 25);
    const fourth = await synchronized(4, 3);
    if (angularDistance(four.views[3].pan, fourth.views[3].pan) < 5) throw new Error('Trusted drag did not rotate source D.');
    record('D drag rotates A B C by 90 degrees with tilt', fourth);

    const dates = await js('window.roadview.openHistory(1)');
    if (dates.length < 2) throw new Error('Past date unavailable at demonstration location.');
    const past = dates[dates.length - 1];
    const selected = await js(`window.roadview.selectDate(${JSON.stringify({ index: 1, panoId: past.panoId })})`);
    await synchronized(4);
    const historical = await getPane(1).frame.executeJavaScript("({date:document.querySelector('[data-id=selectedDateBtn]')?.textContent.trim(),slider:document.querySelector('[data-id=slider]')?.style.left})");
    await drag(1, 95);
    const historyRotated = await synchronized(4, 1);
    const after = await getPane(1).frame.executeJavaScript("({date:document.querySelector('[data-id=selectedDateBtn]')?.textContent.trim(),slider:document.querySelector('[data-id=slider]')?.style.left})");
    if (historical.date !== after.date || parseFloat(after.slider) < 99.9) throw new Error('Automatic rotation changed historical photo selection.');
    record('Past date stays selected while B leads rotation', { requested: past.date, selected: selected.date, before: historical, after, ...historyRotated });

    await js("document.querySelector('#rotation-enabled').click()");
    await waitFor('rotation disabled', () => !rotation.getState().enabled);
    const disabledBefore = await readings(4);
    await drag(0, -95);
    const disabledAfter = await readings(4);
    if (angularDistance(disabledBefore[0].pan, disabledAfter[0].pan) < 5 || disabledAfter.slice(1).some((view, index) => angularDistance(view.pan, disabledBefore[index + 1].pan) > 1)) throw new Error('Disabled auto rotation did not leave other views independent.');
    record('Auto rotation checkbox permits independent views', { before: disabledBefore, after: disabledAfter });
    await js("document.querySelector('#rotation-enabled').click()");
    await synchronized(4, 0);
    const versions = (await readings(4)).map(view => view.version);
    await js("document.querySelector('#split-two').click()");
    await synchronized(2);
    await js("document.querySelector('#split-four').click(); document.querySelector('#open-compare-menu').click()");
    const restored = await synchronized(4);
    if (restored.views.some((view, index) => view.version !== versions[index])) throw new Error('Layout switch reloaded frames.');
    record('2 to 4 layout switch reuses frames and updates offsets', restored);
    await pause(1200);
    await fs.writeFile(path.join(output, 'rotation-desktop.png'), (await mainWindow.webContents.capturePage()).toPNG());
  } catch (error) {
    failed = true;
    console.error(error.stack);
    checks.push({ error: error.stack, state: rotation.getState() });
    try { await fs.writeFile(path.join(output, 'rotation-error.png'), (await mainWindow.webContents.capturePage()).toPNG()); } catch { /* Keep original failure. */ }
  } finally {
    await fs.writeFile(path.join(output, 'rotation-results.json'), JSON.stringify({ passed: !failed, checks }, null, 2));
    app.exit(failed ? 1 : 0);
  }
};
