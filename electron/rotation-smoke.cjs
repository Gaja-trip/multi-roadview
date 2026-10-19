const fs = require('node:fs/promises');
const path = require('node:path');
const { angularDistance } = require('./rotation-sync.cjs');
const { readVisibleDate } = require('./frame-history.cjs');

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
      return views.every(view => angularDistance(view.pan, source.pan) <= 1.5 && Math.abs(view.tilt - source.tilt) <= 1 && Math.abs(view.zoom - source.zoom) <= .01) && { state, views };
    });
  }
  async function captureDates(count) {
    return Promise.all(Array.from({ length: count }, (_, index) => readVisibleDate(getPane(index).frame)));
  }
  async function arranged(count) {
    return waitFor(`${count} distinct real years`, async () => {
      const state = await js(`(() => { const s=document.querySelector('#comparison-stage');return {count:Number(s.dataset.count),arranging:s.dataset.arranging,periodState:s.dataset.periodState,labels:[...s.querySelectorAll('.compare-source')].filter(e=>!e.classList.contains('source-inactive')).sort((a,b)=>a.dataset.index-b.dataset.index).map(e=>e.querySelector('.source-capture-date').textContent),status:document.querySelector('#period-status').textContent};})()`);
      if (state.count !== count || state.arranging !== 'false' || state.periodState !== 'ready') return false;
      const dates = await captureDates(count), years = dates.map(date => Number(date.match(/20\d{2}/)?.[0]));
      if (new Set(years).size !== count || years.some((year,index)=>!year || index > 0 && year < years[index-1])) return false;
      for (let index = 0; index < count; index++) {
        const match = dates[index].match(/(20\d{2})\D+(\d{1,2})/);
        if (state.labels[index] !== `${match[1]}년 ${Number(match[2])}월`) return false;
      }
      return { ...state, dates, years };
    }, 65000);
  }
  async function drag(index, horizontal = -100, vertical = 0) {
    const rect = await js(`(() => { const r = document.querySelector('#compare-source-${index}').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    const x = Math.round(rect.x + rect.width * .67), y = Math.round(rect.y + 44 + (rect.height - 44) * .63);
    const wc = mainWindow.webContents;
    mainWindow.focus(); wc.focus();
    // Hit-test real trusted input through the local window into Kakao's frame.
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
    await waitFor('local comparison initialized', () => js("Boolean(document.querySelector('#compare-source-0 iframe'))"));
    await js("if (!document.querySelector('#rotation-enabled').checked) document.querySelector('#rotation-enabled').click(); document.querySelector('#compare-split').click(); document.querySelector('#split-two').click();");
    record('2 panes automatically show oldest and newest real years', await arranged(2));
    const start = await synchronized(2);
    record('2 panes face the same absolute direction', start);
    await drag(1);
    const opposite = await synchronized(2, 1);
    if (angularDistance(start.views[1].pan, opposite.views[1].pan) < 5) throw new Error('Trusted drag did not rotate source B.');
    if (opposite.views.some((view, index) => view.panoId !== start.views[index].panoId || view.version !== start.views[index].version)) throw new Error('Rotation changed panorama or frame.');
    record('B drag rotates A to the same direction and keeps dates', { ...opposite, dates: await captureDates(2) });

    await js("document.querySelector('#split-four').click()");
    record('4 panes automatically show different real years in order', await arranged(4));
    const four = await synchronized(4);
    record('4 panes face the same absolute direction', four);
    const fourDates = await captureDates(4);
    await drag(3, -85, 25);
    const fourth = await synchronized(4, 3);
    if (angularDistance(four.views[3].pan, fourth.views[3].pan) < 5) throw new Error('Trusted drag did not rotate source D.');
    if (JSON.stringify(await captureDates(4)) !== JSON.stringify(fourDates)) throw new Error('Rotation changed capture dates.');
    record('D drag rotates A B C to the same direction with tilt', { ...fourth, dates: fourDates });

    // Choose a specific offered date through the same sidebar UI as the user.
    await js("document.querySelector('#compare-source-1 .source-capture-date').click()");
    const dateButtons = await waitFor('manual date choices', () => js("(()=>{const p=document.querySelector('.period-editor[data-index=\"1\"] .date-options');return !p.hidden&&p.children.length?[...p.children].map(b=>({date:b.textContent,selected:b.getAttribute('aria-pressed')==='true'})):false})()"));
    const choice = dateButtons.findIndex((button, index) => index > 0 && !button.selected);
    if (choice < 0) throw new Error('No other offered capture date.');
    await js(`document.querySelector('.period-editor[data-index="1"] .date-options').children[${choice}].click()`);
    await waitFor('manual date applied', () => js("document.querySelector('.period-editor[data-index=\"1\"] .date-options').hidden && !document.querySelector('.period-editor[data-index=\"1\"] .inline-error').textContent"));
    await synchronized(4);
    const manuallySelected = await captureDates(4);
    const historical = await getPane(1).frame.executeJavaScript("({date:document.querySelector('[data-id=selectedDateBtn]')?.textContent.trim(),slider:document.querySelector('[data-id=slider]')?.style.left})");
    await drag(1, 95);
    const historyRotated = await synchronized(4, 1);
    const after = await getPane(1).frame.executeJavaScript("({date:document.querySelector('[data-id=selectedDateBtn]')?.textContent.trim(),slider:document.querySelector('[data-id=slider]')?.style.left})");
    if (historical.date !== after.date || parseFloat(after.slider) < 99.9) throw new Error('Automatic rotation changed historical photo selection.');
    if (JSON.stringify(await captureDates(4)) !== JSON.stringify(manuallySelected)) throw new Error('Manual capture selection was overwritten.');
    record('Manual past date stays selected while B leads same-heading rotation', { requested: dateButtons[choice].date, before: historical, after, dates: manuallySelected, ...historyRotated });

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
    record('Returning to 2 panes restores oldest and newest years', await arranged(2));
    await synchronized(2);
    await js("document.querySelector('#split-four').click()");
    record('Returning to 4 panes restores distinct chronological years', await arranged(4));
    const restored = await synchronized(4);
    if (restored.views.some((view, index) => view.version !== versions[index])) throw new Error('Layout switch reloaded frames.');
    record('2 to 4 layout switch reuses frames and preserves same direction', restored);
    const blocked = await js("document.querySelector('#arrange-periods').click(); getComputedStyle(document.querySelector('#compare-source-0 iframe')).pointerEvents === 'none' && document.querySelector('#compare-source-0 .source-capture-date').disabled");
    if (!blocked) throw new Error('Auto arrangement left original frame input enabled.');
    await js("document.querySelector('#split-two').click(); document.querySelector('#split-four').click()");
    record('Rapid 4 to 2 to 4 during an active arrangement recovers', await arranged(4));
    await synchronized(4);
    const minimapHidden = await getPane(3).frame.executeJavaScript("[...document.querySelectorAll('[id=\"view.map\"]')].every(el=>getComputedStyle(el).opacity==='0')");
    if (!minimapHidden) throw new Error('Mini map covers the road comparison.');
    record('Original mini map no longer covers the dated panorama', { minimapHidden });
    await js("document.querySelector('#period-menu-tab').click()");
    await pause(1500);
    await fs.writeFile(path.join(output, 'year-comparison-desktop.png'), (await mainWindow.webContents.capturePage()).toPNG());
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
