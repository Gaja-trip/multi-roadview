const { app, BrowserWindow, ipcMain, shell, clipboard, safeStorage, session, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { readVisibleDate, openHistory, selectDate } = require('./frame-history.cjs');
const { readRotation, applyRotation } = require('./frame-rotation.cjs');
const { createRotationSync } = require('./rotation-sync.cjs');
const { DEMO, coordinates, roadviewUrl, kakaoUrl, externalUrl, paneIndex, localSearch } = require('./domain.cjs');

const root = path.join(__dirname, '..');
const rendererUrl = pathToFileURL(path.join(root, 'index.html')).href;
const smoke = process.argv.includes('--smoke-test');
const capture = process.argv.includes('--integration-capture');
const rotationTest = process.argv.includes('--rotation-test');
let mainWindow;
let target = { ...DEMO };
let targetUrl = DEMO.url;
let searchQueue = Promise.resolve();
let lastSearch = 0;
const cache = new Map();
const panes = new Map();
const frameStates = new Map();
const rotationReadings = new Map();
let lastRotationMessage = '';
function emitRotationState(state) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const views = [...rotationReadings].filter(([index, value]) => index < state.count && frameStates.get(index)?.version === value.version)
    .map(([index, value]) => ({ index, version: value.version, pan: Math.round(value.pan), tilt: Math.round(value.tilt), zoom: value.zoom }));
  const payload = { enabled: state.enabled, count: state.count, ready: state.ready, leader: state.leader, synchronized: state.synchronized, error: state.error, views };
  const signature = JSON.stringify(payload);
  if (signature !== lastRotationMessage) { lastRotationMessage = signature; mainWindow.webContents.send('roadview:rotation-state', payload); }
}
const rotation = createRotationSync({
  async read(index) {
    let pane; try { pane = getPane(index); } catch { rotationReadings.delete(index); return null; }
    const value = await readRotation(pane);
    if (value) rotationReadings.set(index, value); else rotationReadings.delete(index);
    return value;
  },
  async apply(index, targetPoint, expected) {
    let pane; try { pane = getPane(index); } catch { return { applied: false }; }
    const result = await applyRotation(pane, targetPoint, expected);
    if (result.applied) rotationReadings.set(index, { ...expected, ...result });
    return result;
  },
  onState: emitRotationState,
});
// Keep the panorama compositor active while another window covers part of the app.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (smoke || capture || rotationTest) { fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true }); app.setPath('userData', path.join(root, 'artifacts', rotationTest ? 'rotation-profile' : 'smoke-profile')); }

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
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('roadview:pane', { index, ...pane.state, version: pane.version });
}

function getPane(index) {
  paneIndex(index);
  const active = frameStates.get(index);
  if (!active?.ready) throw new Error('카카오맵 연결 후 촬영일을 선택할 수 있습니다.');
  const frame = mainWindow?.webContents.mainFrame.frames.find(candidate => candidate.name === `roadview-source-${index}-${active.version}`);
  if (!frame || frame.isDestroyed() || frame.detached) throw new Error('카카오맵 연결 후 촬영일을 선택할 수 있습니다.');
  kakaoUrl(frame.url);
  let pane = panes.get(index);
  if (!pane) {
    pane = { frame, version: active.version, state: { url: frame.url, date: '', status: 'connected', error: '' }, history: [], generation: 0, nativeInput: false };
    panes.set(index, pane);
  } else if (pane.frame !== frame || pane.state.url !== frame.url || pane.version !== active.version) {
    pane.generation++; pane.frame = frame; pane.version = active.version; pane.history = []; pane.latestPano = null;
    pane.state = { url: frame.url, date: '', status: 'connected', error: '' };
  }
  return pane;
}

function invalidatePanes() {
  for (const pane of panes.values()) { pane.generation++; pane.history = []; pane.state.date = ''; }
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
  handle('frame', value => {
    const index = paneIndex(value?.index), version = value?.version;
    if (typeof version !== 'string' || !/^[a-f0-9-]{36}$/i.test(version) || typeof value.ready !== 'boolean') throw new Error('화면 연결 정보가 올바르지 않습니다.');
    const previous = frameStates.get(index);
    if (value.ready && previous && previous.version !== version) return false;
    frameStates.set(index, { version, ready: value.ready });
    if (!value.ready) rotationReadings.delete(index);
    const pane = panes.get(index);
    if (pane && (!value.ready || pane.version !== version)) { pane.generation++; pane.history = []; pane.state.date = ''; }
    return true;
  });
  handle('move', value => {
    target = { ...coordinates(value), name: String(value.name || '선택한 위치').slice(0, 150), address: String(value.address || '').slice(0, 300) };
    targetUrl = roadviewUrl(target); invalidatePanes(); return target;
  });
  // The renderer owns the sandboxed iframe layout. No native views cover it.
  handle('layout', () => true);
  handle('rotation', value => {
    if (typeof value?.enabled !== 'boolean' || ![2, 4].includes(value.count)) throw new Error('자동 회전 설정이 올바르지 않습니다.');
    const state = rotation.configure({ enabled: value.enabled, count: value.count });
    lastRotationMessage = ''; emitRotationState(state); return state;
  });

  handle('search', searchPlaces);
  handle('reload', value => { const pane = getPane(paneIndex(value)); pane.generation++; pane.history = []; return pane.frame.reload(); });
  handle('history', async value => {
    const index = paneIndex(value), pane = getPane(index);
    pane.state.date = await readVisibleDate(pane.frame);
    if (pane.selecting) throw new Error('촬영일을 변경하는 중입니다. 잠시 후 다시 선택해 주세요.');
    pane.selecting = true;
    try { const dates = await openHistory(pane); sendPane(index, { date: pane.state.date }); return dates; }
    finally { pane.selecting = false; }
  });
  handle('select-date', async value => {
    const index = paneIndex(value?.index), pane = getPane(index);
    if (pane.selecting) throw new Error('촬영일을 변경하는 중입니다. 잠시 후 다시 선택해 주세요.');
    pane.selecting = true;
    try { const date = await selectDate(pane, value?.panoId); sendPane(index, { date }); return { date }; }
    finally { pane.selecting = false; }
  });
  handle('link', value => {
    const url = kakaoUrl(value?.url);
    if (value.index === 'all') { targetUrl = url; invalidatePanes(); }
    else { const pane = panes.get(paneIndex(Number(value.index))); if (pane) { pane.generation++; pane.history = []; } }
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
    show: !smoke && !capture, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false, offscreen: smoke || capture },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { void shell.openExternal(externalUrl(url)); } catch { /* Only approved map links may leave the app. */ }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== rendererUrl) event.preventDefault(); });
  mainWindow.on('closed', () => {
    panes.clear(); frameStates.clear(); rotationReadings.clear(); mainWindow = null;
  });
  const localReady = new Promise(resolve => mainWindow.webContents.once('dom-ready', resolve));
  await Promise.race([mainWindow.loadURL(rendererUrl), localReady]);
  if (smoke || capture) mainWindow.webContents.setFrameRate(30);
}

app.whenReady().then(async () => {
  const remoteSession = session.defaultSession;
  remoteSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  remoteSession.setPermissionCheckHandler(() => false);
  registerIPC();
  await createWindow();
  // Observe the actual named comparison frames, including manual date changes.
  const timer = setInterval(async () => {
    for (let index = 0; index < 4; index++) {
      let pane;
      try { pane = getPane(index); } catch { continue; }
      if (pane.polling || pane.selecting) continue;
      const generation = pane.generation, frame = pane.frame;
      pane.polling = true;
      try {
        const date = await readVisibleDate(frame);
        if (pane.generation === generation && pane.frame === frame) sendPane(index, { status: 'connected', date, url: frame.url });
      } catch { /* A source frame may be navigating. */ }
      finally { pane.polling = false; }
    }
  }, 2000);

  timer.unref();
  const rotationTimer = setInterval(() => {
    emitRotationState(rotation.getState());
    void rotation.tick().then(emitRotationState).catch(() => {});
  }, 80);
  rotationTimer.unref();
  if (smoke) require('./smoke.cjs')({ app, mainWindow, panes, root });
  if (capture) require('./capture.cjs')({ app, mainWindow, panes, root, remoteSession, searchPlaces });
  if (rotationTest) require('./rotation-smoke.cjs')({ app, mainWindow, panes, root, rotation, getPane, readRotation });
});

app.on('window-all-closed', () => app.quit());
