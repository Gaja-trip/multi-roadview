import { createBrowserApi, kakaoUrl } from './web-api.js';
import { createComparison } from './comparison.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const ICONS = {
  pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  split: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
  link: '<path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1)"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .3c0 1.7-2.5 2-2.5 3.7m0 3h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  navigate: '<path d="m21 3-6 18-4-8-8-4 18-6Z"/>',
  'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.8 7M3 4v7h7m2-4v5l3 2"/>',
  bookmark: '<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  external: '<path d="M15 3h6v6m0-6L11 13m-2-8H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  settings: '<path d="m9 3-.6 2.5-2.1 1.2L4 6l-2 3.5L4 11v2l-2 1.5L4 18l2.3-.7 2.1 1.2L9 21h6l.6-2.5 2.1-1.2 2.3.7 2-3.5-2-1.5v-2l2-1.5L20 6l-2.3.7-2.1-1.2L15 3Z"/><circle cx="12" cy="12" r="3"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m-3-6h.01M6 9h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 6v4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  collapse: '<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 8m0-12v5h-5"/>',
  panorama: '<path d="M3 5q9 5 18 0v14q-9-5-18 0V5Z"/><path d="m3 15 5-5 5 5 3-3 5 5"/><circle cx="15.5" cy="8.5" r="1"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.pin}</svg>`; }
function hydrateIcons(parent = document) { parent.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); }); }

const PRESETS = [
  { name: '서울시청', address: '서울특별시 중구 세종대로 110', lat: 37.56650, lng: 126.97800 },
  { name: '광화문', address: '서울특별시 종로구 사직로 161', lat: 37.57590, lng: 126.97680 },
  { name: '강남역', address: '서울특별시 강남구 강남대로 396', lat: 37.49795, lng: 127.02762 },
  { name: '부산역', address: '부산광역시 동구 중앙대로 206', lat: 35.11499, lng: 129.03950 },
  { name: '제주공항', address: '제주특별자치도 제주시 공항로 2', lat: 33.50670, lng: 126.49300 },
];
const DEMO = { name: '청주 분평동', address: '충청북도 청주시 서원구 분평동', lat: 36.6087352, lng: 127.4897056, url: 'https://map.kakao.com/link/roadview/36.6087352,127.4897056' };
function coordinate(value) {
  if (value.lat === '' || value.lng === '' || value.lat == null || value.lng == null) throw new Error('위도와 경도를 모두 입력해 주세요.');
  const lat = Number(value.lat), lng = Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error('위도는 −90~90, 경도는 −180~180 범위의 숫자를 입력해 주세요.');
  return { lat, lng };
}
function readPlaces(key) {
  try { const values = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(values) ? values.slice(0, 8).filter(p => { try { coordinate(p); return typeof p.name === 'string' && typeof p.address === 'string'; } catch { return false; } }).map(p => ({ ...p, ...coordinate(p) })) : []; }
  catch { return []; }
}
function storePlaces(key, values) { try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* Browsing can continue if local storage is full. */ } }

const desktop = Boolean(window.roadview?.desktop);
const api = window.roadview || createBrowserApi();
const comparison = createComparison(DEMO.url, { api, notify: toast, openPeriods: () => openSidebarTab('period') });

let current = { ...DEMO };
let baseUrl = DEMO.url;
let splitCount = 2;
let recent = readPlaces('roadview-recent');
let saved = readPlaces('roadview-saved');
let toastTimer;
let searching = false;
let linkLocation = false;
function preference(key, fallback = '') { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function savePreference(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* Optional browser preference. */ } }
splitCount = preference('roadview-split-count') === '4' ? 4 : 2;
function roadviewUrl(place) { return `https://map.kakao.com/link/roadview/${place.lat},${place.lng}`; }
function toast(message) { $('#toast-message').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500); }
function showError(id, message = '') { const element = $(`#${id}`); element.textContent = message; element.hidden = !message; }
function samePlace(a, b) { return Math.abs(a.lat - b.lat) < .00001 && Math.abs(a.lng - b.lng) < .00001; }
async function safely(action) { try { await action(); } catch (error) { toast(error.message || '작업을 완료하지 못했습니다. 다시 시도해 주세요.'); } }

function renderPlaces() {
  function list(parent, places, isSaved) {
    parent.replaceChildren();
    for (const place of places) {
      const row = document.createElement('div'); row.className = 'place-row';
      const button = document.createElement('button'); button.className = 'place-go';
      const symbol = document.createElement('span'); symbol.dataset.icon = isSaved ? 'bookmark' : 'pin';
      const description = document.createElement('span'); description.className = 'place-description';
      const name = document.createElement('strong'); name.textContent = place.name;
      const address = document.createElement('small'); address.textContent = place.address || `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
      description.append(name, address); button.append(symbol, description);
      button.addEventListener('click', () => safely(() => moveTo(place))); row.append(button);
      if (isSaved) {
        const remove = document.createElement('button'); remove.className = 'delete-place'; remove.setAttribute('aria-label', `${place.name} 저장 해제`); remove.innerHTML = icon('close');
        remove.addEventListener('click', () => { saved = saved.filter(p => !samePlace(p, place)); storePlaces('roadview-saved', saved); renderPlaces(); toast('저장한 위치에서 삭제했습니다.'); }); row.append(remove);
      }
      parent.append(row);
    }
    hydrateIcons(parent);
  }
  list($('#recent-places'), recent.slice(0, 3), false);
  if (!recent.length) { const empty = document.createElement('p'); empty.className = 'empty-saved'; empty.textContent = '최근에 이동한 위치가 여기에 표시됩니다.'; $('#recent-places').append(empty); }
  $('#saved-heading').hidden = saved.length === 0;
  list($('#saved-places'), saved, true);
}

function displayLocation() {
  $('#location-name').textContent = current.name;
  $('#location-address').textContent = current.address || 'WGS84 좌표로 선택한 위치';
  $('#location-coordinates').textContent = linkLocation ? '지도 링크의 위치' : `${current.lat.toFixed(6)}, ${current.lng.toFixed(6)}`;
  $('#copy-coordinates').disabled = linkLocation;
  $('#latitude').value = current.lat.toFixed(6);
  $('#longitude').value = current.lng.toFixed(6);
}

async function moveTo(place) {
  const point = { ...place, ...coordinate(place), name: place.name || '좌표로 선택한 위치', address: place.address || '' };
  await api.move(point);
  if (place.url) await api.setLink({ index: 'all', url: place.url });
  current = point; baseUrl = place.url || roadviewUrl(point); linkLocation = false;
  comparison.navigate(baseUrl);
  recent = [point, ...recent.filter(item => !samePlace(item, point))].slice(0, 6);
  storePlaces('roadview-recent', recent); renderPlaces(); displayLocation();
  $('#search-results').replaceChildren(); showError('search-error');
  toast(`${point.name} 주변 로드뷰로 모든 화면을 이동합니다. 촬영일을 다시 선택해 주세요.`);
}

function renderLayout() {
  comparison.setCount(splitCount);
  $('#view-count').textContent = splitCount === 4 ? 'A · B · C · D' : 'A · B';
  $('#split-two').setAttribute('aria-pressed', String(splitCount === 2));
  $('#split-four').setAttribute('aria-pressed', String(splitCount === 4));
  savePreference('roadview-split-count', splitCount);
}

function selectTab(id) {
  $$('.search-tabs [role="tab"]').forEach(button => { const active = button.dataset.tab === id; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; $(`#${button.dataset.tab}-panel`).hidden = !active; });
}

function selectSidebarTab(id) {
  if (!['location', 'compare', 'period'].includes(id)) id = 'location';
  $$('.sidebar-tabs [role="tab"]').forEach(button => {
    const active = button.dataset.menu === id;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    $(`#${button.dataset.menu}-menu-panel`).hidden = !active;
  });
  $('.sidebar-scroll').scrollTop = 0;
  savePreference('roadview-sidebar-tab', id);
}
function openSidebarTab(id) { setSidebar(false); selectSidebarTab(id); $(`#${id}-menu-tab`).focus(); }

function showDialog(id) {
  $(`#${id}`).showModal();
}

hydrateIcons(); renderLayout(); renderPlaces(); displayLocation();
if (!desktop) {
  $('#app-mode').textContent = '웹 로드뷰';
  $('#workspace-notice').textContent = '각 화면의 촬영일 선택으로 과거 사진을 고르세요. 실제 촬영일은 카카오맵 원본에서 확인할 수 있습니다.';
}
selectSidebarTab(preference('roadview-sidebar-tab', 'location'));
$$('.sidebar-tabs [role="tab"]').forEach(button => {
  button.addEventListener('click', () => selectSidebarTab(button.dataset.menu));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tabs = $$('.sidebar-tabs [role="tab"]');
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectSidebarTab(tabs[index].dataset.menu); tabs[index].focus();
  });
});
$('#open-compare-menu').addEventListener('click', () => openSidebarTab('compare'));
$('#keyless-help-button').addEventListener('click', () => showDialog('help-dialog'));

$$('.search-tabs [role="tab"]').forEach(button => {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tabs = $$('.search-tabs [role="tab"]'); let index = tabs.indexOf(button);
    index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[index].dataset.tab); tabs[index].focus();
  });
});

$('#address-form').addEventListener('submit', async event => {
  event.preventDefault(); if (searching) return;
  const query = $('#address-query').value.trim();
  if (query.length < 2) { showError('search-error', '주소 또는 장소명을 두 글자 이상 입력해 주세요.'); return; }
  searching = true; $('#search-submit').disabled = true; $('#search-submit>span:nth-child(2)').textContent = '검색 중…';
  showError('search-error'); $('#search-results').replaceChildren();
  try {
    const result = await api.search(query);
    if (!result.places.length) { const message = document.createElement('p'); message.className = 'empty-state'; message.textContent = '검색 결과가 없습니다. 도로명·지번 주소로 다시 검색하거나, 좌표·카카오맵 링크를 입력해 주세요.'; $('#search-results').append(message); }
    for (const place of result.places) {
      const button = document.createElement('button'); button.className = 'result-item';
      const name = document.createElement('strong'); name.textContent = place.name;
      const address = document.createElement('p'); address.textContent = place.address;
      button.append(name, address); button.addEventListener('click', () => safely(() => moveTo(place))); $('#search-results').append(button);
    }
    $('#search-credit').textContent = result.source === 'kakao' ? '주소·장소 검색 제공 © Kakao' : result.source === 'preset' ? '빠른 위치 · 대표 장소' : '주소 검색 © OpenStreetMap 기여자';
  } catch (error) { showError('search-error', error.message); }
  finally { searching = false; $('#search-submit').disabled = false; $('#search-submit>span:nth-child(2)').textContent = '위치 검색'; }
});

$('#coordinates-form').addEventListener('submit', async event => {
  event.preventDefault(); showError('coordinates-error');
  try { await moveTo({ ...coordinate({ lat: $('#latitude').value.trim(), lng: $('#longitude').value.trim() }), name: '좌표로 선택한 위치', address: '' }); }
  catch (error) { showError('coordinates-error', error.message); }
});
$('#link-form').addEventListener('submit', async event => {
  event.preventDefault(); showError('link-error');
  try {
    const target = $('#link-target').value;
    const url = kakaoUrl($('#map-link').value.trim());
    comparison.navigate(url, target);
    if (target === 'all') { baseUrl = url; linkLocation = true; current = { ...current, name: '카카오맵 링크의 위치', address: '좌표는 지도 링크 원본에서 확인해 주세요.' }; displayLocation(); }
    if (target !== 'all' && Number(target) >= 2) { splitCount = 4; renderLayout(); }
    toast('지도 링크를 열었습니다. 원본 로드뷰의 촬영일을 확인해 주세요.');
  } catch (error) { showError('link-error', error.message || '올바른 카카오맵 링크를 입력해 주세요.'); }
});

$$('[data-preset]').forEach(button => button.addEventListener('click', () => safely(() => moveTo(PRESETS[Number(button.dataset.preset)]))));
$('#home').addEventListener('click', event => { event.preventDefault(); void safely(() => moveTo(DEMO)); });
$('#split-two').addEventListener('click', () => { splitCount = 2; renderLayout(); });
$('#split-four').addEventListener('click', () => { splitCount = 4; renderLayout(); });
function setSidebar(collapsed) {
  if (collapsed && $('#sidebar').contains(document.activeElement)) $('#sidebar-toggle').focus();
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  $('#sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('#sidebar-toggle').title = collapsed ? '왼쪽 메뉴 보이기' : '왼쪽 메뉴 숨기기';
  $('#sidebar-toggle-label').textContent = collapsed ? '메뉴 보이기' : '메뉴 숨기기';
  $('#sidebar').inert = collapsed;
  try { localStorage.setItem('roadview-sidebar-hidden', String(collapsed)); } catch { /* Optional preference. */ }
}
try { setSidebar(localStorage.getItem('roadview-sidebar-hidden') === 'true'); } catch { setSidebar(false); }
$('#sidebar-toggle').addEventListener('click', () => {
  setSidebar(!document.body.classList.contains('sidebar-collapsed'));
});
$('#sidebar-close').addEventListener('click', () => setSidebar(true));
$('#copy-location').addEventListener('click', () => safely(async () => { await api.copy(baseUrl); toast('현재 비교 위치의 카카오맵 링크를 복사했습니다.'); }));
$('#copy-coordinates').addEventListener('click', () => safely(async () => { await api.copy(`${current.lat.toFixed(6)}, ${current.lng.toFixed(6)}`); toast('위도·경도를 복사했습니다.'); }));
$('#save-place').addEventListener('click', () => {
  if (linkLocation) { toast('지도 링크 위치는 좌표로 다시 이동한 후 저장해 주세요.'); return; }
  if (saved.some(place => samePlace(place, current))) { toast('이미 저장한 위치입니다.'); return; }
  if (saved.length >= 8) { toast('위치는 최대 8개까지 저장할 수 있습니다. 기존 위치를 삭제한 후 저장해 주세요.'); return; }
  saved.unshift({ ...current }); storePlaces('roadview-saved', saved); renderPlaces(); toast('현재 위치를 저장했습니다.');
});
$$('[data-map]').forEach(button => button.addEventListener('click', () => safely(async () => {
  if (linkLocation && button.dataset.map !== 'kakao') { toast('다른 지도에서 열려면 주소 또는 좌표로 위치를 먼저 선택해 주세요.'); return; }
  const urls = { kakao: baseUrl, naver: `https://map.naver.com/p/search/${encodeURIComponent(`${current.lat},${current.lng}`)}`, google: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${current.lat},${current.lng}` };
  await api.openExternal(urls[button.dataset.map]);
})));
$('#help-button').addEventListener('click', () => showDialog('help-dialog'));
$$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach(dialog => { dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }); });
$('#settings-button').addEventListener('click', () => safely(async () => {
  const settings = await api.settings();
  $('#settings-status').textContent = settings.hasKey ? '카카오 주소·장소 검색 연결됨' : desktop ? '기본 주소 검색 사용 중 · OpenStreetMap' : '웹 검색은 서버에서 연결합니다. 선택 사항: Vercel 환경 변수 KAKAO_REST_API_KEY 설정 후 재배포';
  $('#api-key').value = ''; $('#api-key').placeholder = settings.hasKey ? '새 키를 입력하면 연결을 교체합니다' : 'REST API 키 입력';
  $('#api-key').disabled = !settings.encryption; $('#save-key').disabled = !settings.encryption; $('#remove-key').disabled = !settings.hasKey;
  showError('settings-error'); showDialog('settings-dialog');
}));
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault(); showError('settings-error');
  const key = $('#api-key').value.trim(); if (!key) { showError('settings-error', '저장할 REST API 키를 입력해 주세요.'); return; }
  try { await api.saveKey(key); $('#api-key').value = ''; $('#settings-dialog').close(); $('#search-credit').textContent = '주소·장소 검색 제공 © Kakao'; toast('카카오 주소 검색 연결을 저장했습니다. 검색 시 키가 확인됩니다.'); }
  catch (error) { showError('settings-error', error.message); }
});
$('#remove-key').addEventListener('click', () => safely(async () => { await api.saveKey(''); $('#api-key').value = ''; $('#settings-dialog').close(); $('#search-credit').textContent = '주소 검색 © OpenStreetMap 기여자'; toast('카카오 검색 연결을 해제하고 기본 검색으로 변경했습니다.'); }));
$('#developer-link').addEventListener('click', () => safely(() => api.openExternal('https://developers.kakao.com/')));
