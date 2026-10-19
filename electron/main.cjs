const { app, BrowserWindow, WebContentsView, ipcMain, shell, clipboard, safeStorage, session, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { DEMO, coordinates, roadviewUrl, kakaoUrl, externalUrl, paneIndex, bounds, localSearch } = require('./domain.cjs');

const root = path.join(__dirname, '..');
const rendererUrl = pathToFileURL(path.join(root, 'index.html')).href;
const smoke = process.argv.includes('--smoke-test');
const capture = process.argv.includes('--integration-capture');
let mainWindow;
let target = { ...DEMO };
let targetUrl = DEMO.url;
let searchQueue = Promise.resolve();
let lastSearch = 0;
const cache = new Map();
const panes = new Map();
// Keep the panorama compositor active while another window covers part of the app.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (smoke || capture) { fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true }); app.setPath('userData', path.join(root, 'artifacts', 'smoke-profile')); }

const readSettings = () => {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')); }
  catch { return {}; }
};
function getKey() {
  const settings = readSettings();
  if (!settings.key || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(settings.key, 'base64')); }
  catch { return ''; }
}
function sendPane(index, changes) {
  const pane = panes.get(index);
  if (!pane) return;
  Object.assign(pane.state, changes);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('roadview:pane', { index, ...pane.state });
}

function allowedNavigation(raw) {
  try { const url = new URL(raw); return url.protocol === 'https:' && ['map.kakao.com', 'kko.to'].includes(url.hostname); }
  catch { return false; }
}

function ensurePane(index) {
  if (panes.has(index)) return panes.get(index);
  const view = new WebContentsView({ webPreferences: {
    nodeIntegration: false, contextIsolation: true, sandbox: true,
    webSecurity: true, backgroundThrottling: false,
    partition: 'persist:roadview-sites',
  } });
  const pane = { view, state: { status: 'idle', url: '', date: '', error: '' }, attached: false, loaded: false, history: [], generation: 0, nativeInput: false };
  panes.set(index, pane);
  view.setBackgroundColor('#f3f5f7');
  const wc = view.webContents;
  wc.on('before-mouse-event', (_event, mouse) => { if (mouse.type === 'mouseDown' && !pane.appSelecting) { pane.history = []; pane.nativeInput = true; } });
  wc.on('before-input-event', () => { pane.history = []; pane.nativeInput = true; });
  // Remote sites never receive the local preload or access to Node / application IPC.
  wc.setWindowOpenHandler(({ url }) => {
    try { void shell.openExternal(externalUrl(url)); } catch { /* Block non-map popups. */ }
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => { if (!allowedNavigation(url)) event.preventDefault(); });
  wc.on('will-redirect', (event, url) => { if (!allowedNavigation(url)) event.preventDefault(); });
  wc.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) { pane.loaded = false; sendPane(index, { status: 'loading', error: '', date: '' }); }
  });
  wc.on('dom-ready', () => {
    pane.loaded = true;
    // The original 310px mini-map otherwise covers the date controls in a four-pane view.
    void wc.insertCSS('@media(max-height:500px){[id="view.map"]{transform:scale(.42);transform-origin:bottom left}}');
    sendPane(index, { status: 'connected', url: wc.getURL() });
  });
  wc.on('did-finish-load', () => {
    pane.loaded = true;
    sendPane(index, { status: 'connected', url: wc.getURL() });
  });
  wc.on('did-navigate-in-page', (_event, url) => sendPane(index, { url }));
  wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    pane.loaded = false;
    sendPane(index, { status: 'error', error: `카카오맵에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요. (${code})` });
  });
  wc.on('render-process-gone', () => { pane.loaded = false; sendPane(index, { status: 'error', error: '로드뷰 화면이 종료되었습니다. 새로고침해 주세요.' }); });
  loadPane(index, targetUrl);
  return pane;
}

function loadPane(index, url, keepHistory = false) {
  const pane = panes.get(index);
  pane.generation++;
  pane.nativeInput = false;
  if (!keepHistory) pane.history = [];
  sendPane(index, { url, status: 'loading', date: '', error: '' });
  pane.view.webContents.loadURL(url).catch(() => { /* did-fail-load provides the user-facing error. */ });
}

async function searchPlaces(raw) {
  const query = String(raw ?? '').trim();
  if (query.length < 2 || query.length > 200) throw new Error('검색어를 2~200자로 입력해 주세요.');
  const presets = localSearch(query);
  const key = getKey();
  const cacheKey = `${key ? 'kakao' : 'osm'}:${query}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  // Cache and serialize public geocoding requests: no autocomplete or bulk search.
  const work = searchQueue.then(async () => {
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    if (presets.length && !key) return { places: presets, source: 'preset' };
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - lastSearch))));
    lastSearch = Date.now();
    let places, source;
    if (key) {
      const headers = { Authorization: `KakaoAK ${key}` };
      let response = await net.fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`, { headers, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '카카오 REST API 키 또는 카카오맵 사용 설정을 확인해 주세요.' : '주소 검색 서비스에 연결하지 못했습니다.');
      let data = await response.json();
      if (!data.documents?.length) {
        response = await net.fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=6`, { headers, signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error('장소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        data = await response.json();
      }
      places = (data.documents || []).slice(0, 6).map(item => ({
        name: item.place_name || item.road_address?.building_name || item.address_name,
        address: item.road_address_name || item.road_address?.address_name || item.address_name,
        ...coordinates({ lat: item.y, lng: item.x }),
      }));
      source = 'kakao';
    } else {
      const response = await net.fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'RoadviewTime/1.0 (desktop geocoding; user-initiated search)', Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error('주소 검색이 일시적으로 제한되었습니다. 좌표나 카카오맵 링크로 이동해 주세요.');
      const data = await response.json();
      places = data.map(item => ({ name: item.name || item.display_name.split(',')[0], address: item.display_name, ...coordinates({ lat: item.lat, lng: item.lon }) }));
      source = 'osm';
    }
    const result = { places, source };
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, result);
    return result;
  });
  searchQueue = work.catch(() => {});
  try { return await work; }
  catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'TypeError') throw new Error('검색 서버에 연결하지 못했습니다. 인터넷 연결을 확인하거나 좌표·지도 링크로 이동해 주세요.');
    throw error;
  }
}

function registerIPC() {
  function handle(name, fn) {
    ipcMain.handle(`roadview:${name}`, async (event, payload) => {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== rendererUrl) {
        return { ok: false, error: '허용되지 않는 요청입니다.' };
      }
      try { return { ok: true, data: await fn(payload) }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
  }
  handle('move', value => {
    target = { ...coordinates(value), name: String(value.name || '선택한 위치').slice(0, 150), address: String(value.address || '').slice(0, 300) };
    targetUrl = roadviewUrl(target);
    for (const [index] of panes) loadPane(index, targetUrl);
    return target;
  });
  handle('layout', value => {
    if (!Array.isArray(value) || value.length > 4) throw new Error('화면 구성이 올바르지 않습니다.');
    const size = mainWindow.getContentBounds();
    const visible = new Set();
    for (const item of value) {
      const index = paneIndex(item.index);
      const rect = bounds(item, size);
      if (!rect) continue;
      visible.add(index);
      const pane = ensurePane(index);
      if (!pane.attached) { mainWindow.contentView.addChildView(pane.view); pane.attached = true; }
      pane.view.setBounds(rect);
      const zoom = rect.height < 300 ? 0.75 : 1;
      if (!pane.appSelecting && pane.view.webContents.getZoomFactor() !== zoom) pane.view.webContents.setZoomFactor(zoom);
      pane.view.setVisible(pane.state.status !== 'error');
    }
    for (const [index, pane] of panes) {
      if (!visible.has(index) && pane.attached) { mainWindow.contentView.removeChildView(pane.view); pane.attached = false; }
    }
    return true;
  });
  handle('search', searchPlaces);
  handle('reload', value => {
    const index = paneIndex(value), pane = panes.get(index);
    if (pane) { pane.view.setVisible(true); pane.view.webContents.reload(); }
    return true;
  });
  handle('history', async value => {
    const pane = panes.get(paneIndex(value));
    if (!pane?.loaded) throw new Error('카카오맵 연결 후 촬영일을 선택할 수 있습니다.');
    if (!pane.state.date) throw new Error('로드뷰 촬영 정보를 아직 불러오는 중입니다. 이미지가 표시된 후 다시 선택해 주세요.');
    if (pane.history.length > 1) return pane.history;
    const generation = pane.generation;
    const found = await pane.view.webContents.executeJavaScript(`(() => {
      const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden'; };
      const button = [...document.querySelectorAll('[data-id="nowDateBtn"], [data-id="selectedDateBtn"]')].find(visible);
      if (!button) return false;
      if (!button.parentElement.classList.contains('opt_open')) button.click(); return true;
    })()`);
    if (!found) throw new Error('촬영 정보를 불러오는 중입니다. 잠시 후 다시 시도하거나 원본의 촬영일 메뉴를 이용해 주세요.');
    let options = [];
    for (let attempt = 0; attempt < 16; attempt++) {
      options = await pane.view.webContents.executeJavaScript(`(() => {
        return [...document.querySelectorAll('[data-id="pastIconContainer"] button[data-pano-id]')].map(button => ({
          panoId: button.getAttribute('data-pano-id'), date: button.textContent.trim()
        })).filter(item => /^\\d+$/.test(item.panoId) && /^20\\d{2}\\.\\d{2}$/.test(item.date));
      })()`);
      if (options.length) break;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    await pane.view.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-id="nowDateBtn"]');
      if (button?.parentElement.classList.contains('opt_open')) button.click();
    })()`);
    if (pane.generation !== generation) throw new Error('위치가 변경되었습니다. 현재 위치의 촬영일을 다시 선택해 주세요.');
    const base = new URL(pane.state.url);
    const currentId = base.searchParams.get('panoid');
    if (currentId && pane.state.date && !pane.nativeInput) options.push({ panoId: currentId, date: pane.state.date.replace(/년\s*/, '.').replace(/월.*/, '').trim() });
    if (currentId && !pane.nativeInput) pane.latestPano = currentId;
    pane.history = [...new Map(options.map(item => [item.panoId, item])).values()].sort((a, b) => b.date.localeCompare(a.date));
    return pane.history;
  });
  handle('select-date', async value => {
    const index = paneIndex(value?.index), pane = panes.get(index);
    const item = pane?.history.find(item => item.panoId === value.panoId);
    if (!item) throw new Error('해당 위치에서 제공되는 촬영일을 다시 선택해 주세요.');
    const wc = pane.view.webContents;
    const visible = `el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; }`;
    const originalZoom = wc.getZoomFactor();
    pane.appSelecting = true;
    try {
      if (item.panoId === pane.latestPano) {
        await wc.executeJavaScript(`(() => { const visible = ${visible}; const back = document.querySelector('[data-id="backToRoadviewBtn"]'); if (visible(back)) back.click(); })()`);
        return true;
      }
      // Historical IDs are not ordinary live-view URLs. Use the source site's actual
      // history selector and comparison controls to render the historical photograph.
      const result = await wc.executeJavaScript(`(() => {
        const visible = ${visible};
        const oldDate = document.querySelector('[data-id="selectedDateBtn"]');
        const id = ${JSON.stringify(item.panoId)};
        if (visible(oldDate)) {
          const option = [...document.querySelectorAll('[data-id="dateList"] [data-pano-id]')].find(el => el.getAttribute('data-pano-id') === id);
          if (!option) return 'missing'; option.click(); return 'compare';
        }
        const date = document.querySelector('[data-id="nowDateBtn"]');
        if (!date) return 'missing';
        if (!date.parentElement.classList.contains('opt_open')) date.click();
        const option = [...document.querySelectorAll('[data-id="pastIconContainer"] button[data-pano-id]')].find(el => el.getAttribute('data-pano-id') === id);
        if (!option) return 'missing'; option.click(); return 'thumbnail';
      })()`);
      if (result === 'missing') throw new Error('원본의 촬영일 선택기가 변경되었습니다. 로드뷰 안의 날짜 메뉴에서 선택해 주세요.');
      if (result === 'thumbnail') {
        let ready = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          ready = await wc.executeJavaScript(`(() => { const visible = ${visible}; return visible(document.querySelector('[data-id="selectedDateBtn"]')); })()`);
          if (ready) break;
          await wc.executeJavaScript(`document.querySelector('[data-id="diffBtn"]')?.click()`);
          await new Promise(resolve => setTimeout(resolve, 350));
        }
        if (!ready) throw new Error('과거 사진을 불러오는 중입니다. 잠시 후 같은 촬영일을 다시 선택해 주세요.');
      }
      await wc.executeJavaScript(`(() => { const id = ${JSON.stringify(item.panoId)}; [...document.querySelectorAll('[data-id="dateList"] [data-pano-id]')].find(el => el.getAttribute('data-pano-id') === id)?.click(); })()`);
      wc.setZoomFactor(1);
      await new Promise(resolve => setTimeout(resolve, 350));
      const slider = await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-id="slider"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2, width:innerWidth }; })()`);
      if (slider) {
        const zoom = wc.getZoomFactor();
        const x = Math.round(slider.x * zoom), y = Math.round(slider.y * zoom);
        const endX = Math.floor(slider.width * zoom) - 1;
        wc.focus();
        wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await new Promise(resolve => setTimeout(resolve, 50));
        wc.sendInputEvent({ type: 'mouseMove', x: endX, y, movementX: endX - x, movementY: 0 });
        await new Promise(resolve => setTimeout(resolve, 80));
        wc.sendInputEvent({ type: 'mouseUp', x: endX, y, button: 'left', clickCount: 1 });
      }
      wc.setZoomFactor(originalZoom);
      await new Promise(resolve => setTimeout(resolve, 150));
      // Complete the native slider drag in document coordinates after zoom settles.
      // This avoids Windows display scaling leaving a thin strip of the recent view.
      await wc.executeJavaScript(`(() => {
        const slider = document.querySelector('[data-id="slider"]');
        if (!slider || parseFloat(slider.style.left) >= 99.9) return;
        const rect = slider.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        const fire = (target, type, clientX, buttons) => {
          const event = new MouseEvent(type, { view:window, bubbles:true, cancelable:true, clientX, clientY:y, button:0, buttons });
          Object.defineProperty(event, 'which', { value:1 }); target.dispatchEvent(event);
        };
        fire(slider, 'mousedown', x, 1);
        fire(document, 'mousemove', innerWidth + 30, 1);
        fire(document, 'mouseup', innerWidth + 30, 0);
      })()`);
      await new Promise(resolve => setTimeout(resolve, 200));
      const displayed = await wc.executeJavaScript(`document.querySelector('[data-id="selectedDateBtn"]')?.textContent.trim() || ''`);
      if (displayed.replace(/\D/g, '') !== item.date.replace(/\D/g, '')) throw new Error('촬영일 전환을 확인하지 못했습니다. 같은 촬영일을 다시 선택해 주세요.');
      sendPane(index, { date: displayed });
      return true;
    } finally { wc.setZoomFactor(originalZoom); pane.appSelecting = false; }
  });
  handle('link', value => {
    const url = kakaoUrl(value?.url);
    if (value.index === 'all') { targetUrl = url; for (const [index] of panes) loadPane(index, url); }
    else { const index = paneIndex(value.index); ensurePane(index); loadPane(index, url); }
    return url;
  });
  handle('external', value => shell.openExternal(externalUrl(value)));
  handle('copy', value => { if (typeof value !== 'string' || value.length > 5000) throw new Error('복사할 내용이 올바르지 않습니다.'); clipboard.writeText(value); return true; });
  handle('settings', () => ({ hasKey: Boolean(getKey()), encryption: safeStorage.isEncryptionAvailable() }));
  handle('save-key', value => {
    if (typeof value !== 'string' || (value && !/^[a-zA-Z0-9]{20,100}$/.test(value))) throw new Error('카카오 REST API 키를 확인해 주세요.');
    if (value && !safeStorage.isEncryptionAvailable()) throw new Error('이 PC에서 암호화 저장을 사용할 수 없습니다.');
    const settings = value ? { key: safeStorage.encryptString(value).toString('base64') } : {};
    fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings));
    cache.clear();
    return { hasKey: Boolean(value) };
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: '로드뷰 타임 · 같은 장소, 다른 시간', width: 1500, height: 950,
    minWidth: 980, minHeight: 680, backgroundColor: '#f6f7f9',
    show: !smoke, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { void shell.openExternal(externalUrl(url)); } catch { /* Only approved map links may leave the app. */ }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== rendererUrl) event.preventDefault(); });
  mainWindow.on('closed', () => {
    for (const pane of panes.values()) if (!pane.view.webContents.isDestroyed()) pane.view.webContents.close();
    panes.clear(); mainWindow = null;
  });
  await mainWindow.loadFile(path.join(root, 'index.html'));
}

app.whenReady().then(async () => {
  const remoteSession = session.fromPartition('persist:roadview-sites');
  remoteSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  remoteSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  registerIPC();
  await createWindow();
  // Read only the current, visible date label; hidden website templates are ignored.
  const timer = setInterval(async () => {
    for (const [index, pane] of panes) {
      if (!pane.loaded || !pane.attached || pane.polling || pane.view.webContents.isDestroyed()) continue;
      pane.polling = true;
      try {
        const date = await pane.view.webContents.executeJavaScript(`(() => {
          const labels = [...document.querySelectorAll('[data-id="nowDateBtn"], [data-id="selectedDateBtn"], [data-id="date"]')];
          return labels.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden'; }).map(el => el.textContent.trim()).find(t => /20\\d{2}[년.]/.test(t)) || '';
        })()`);
        if (date !== pane.state.date) sendPane(index, { date });
      } catch { /* The site may be navigating while its date is polled. */ }
      finally { pane.polling = false; }
    }
  }, 2000);
  timer.unref();
  if (smoke) require('./smoke.cjs')({ app, mainWindow, panes, root });
  if (capture) require('./capture.cjs')({ app, mainWindow, panes, root, remoteSession, searchPlaces });
});

app.on('window-all-closed', () => app.quit());
