// These operations use Kakao Map's rendered date controls. Historical panorama
// IDs must not be loaded as ordinary live-roadview URLs.
const visible = `el => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 &&
    r.left < innerWidth && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden';
}`;
const staleMessage = '로드뷰 위치나 화면이 변경되었습니다. 현재 화면의 촬영일 목록을 다시 열어 주세요.';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function dateKey(value) {
  const match = String(value || '').match(/(20\d{2})\s*[.년/-]\s*(0?[1-9]|1[0-2])(?:\D|$)/);
  return match ? `${match[1]}.${match[2].padStart(2, '0')}` : '';
}

function validId(value) {
  return typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n;
}

function context(pane) {
  if (!pane?.frame || typeof pane.frame.executeJavaScript !== 'function') {
    throw new Error('카카오맵 연결 후 촬영일을 선택할 수 있습니다.');
  }
  return { frame: pane.frame, generation: pane.generation };
}

function assertCurrent(pane, snapshot) {
  if (pane.frame !== snapshot.frame || pane.generation !== snapshot.generation) throw new Error(staleMessage);
}

async function execute(pane, snapshot, script) {
  assertCurrent(pane, snapshot);
  let result;
  try { result = await snapshot.frame.executeJavaScript(script); }
  catch {
    assertCurrent(pane, snapshot);
    throw new Error('카카오맵 화면이 다시 연결되는 중입니다. 이미지가 표시된 후 촬영일을 다시 선택해 주세요.');
  }
  assertCurrent(pane, snapshot);
  return result;
}

const readDateScript = `(() => {
  const visible = ${visible};
  const selectors = ['[data-id="selectedDateBtn"]', '[data-id="nowDateBtn"]', '[data-id="date"]'];
  for (const selector of selectors) {
    const label = [...document.querySelectorAll(selector)].find(el => visible(el) && /20\\d{2}[년.]/.test(el.textContent));
    if (label) return label.textContent.trim();
  }
  return '';
})()`;

async function readVisibleDate(frame) {
  return frame.executeJavaScript(readDateScript);
}

async function prepareCaptureView(frame) {
  // Keep the original controls laid out for date selection, while the app
  // displays one verified capture date in a consistent corner of each pane.
  return frame.executeJavaScript(`(() => {
    if (document.getElementById('roadview-time-capture-labels')) return;
    const style = document.createElement('style');
    style.id = 'roadview-time-capture-labels';
    style.textContent = '.info_roadview .txt_add,.info_roadview .info_date,[data-id="address"],[data-id="selectedDateBtn"],[data-id="currentDateContainer"],[data-id="minimap"],[data-id="minimapBtn"],[data-id="minimapContainer"],.view_minimap,[id="view.map"],[id="minimapEdge"]{opacity:0!important;pointer-events:none!important}';
    document.head.append(style);
  })()`);
}

async function openHistory(pane) {
  const snapshot = context(pane);
  pane.history = [];
  pane.latestPano = null;
  const initial = await execute(pane, snapshot, `(() => {
    const visible = ${visible};
    const selected = [...document.querySelectorAll('[data-id="selectedDateBtn"]')].find(visible);
    const current = [...document.querySelectorAll('[data-id="nowDateBtn"]')].find(visible);
    const button = selected || current;
    if (!button) return null;
    const result = { currentDate: current?.textContent.trim() || '', selectedDate: selected?.textContent.trim() || '', url: location.href };
    if (!button.parentElement.classList.contains('opt_open')) button.click();
    return result;
  })()`);
  if (!initial || !dateKey(initial.selectedDate || initial.currentDate)) {
    throw new Error('로드뷰 촬영 정보를 아직 불러오는 중입니다. 이미지가 표시된 후 다시 선택해 주세요.');
  }

  let options = [];
  try {
    // Always refresh: the user can move inside the original iframe without a
    // navigation event or an application-controlled generation change.
    for (let attempt = 0; attempt < 16; attempt++) {
      options = await execute(pane, snapshot, `(() => {
        return [...document.querySelectorAll('[data-id="pastIconContainer"] button[data-pano-id], [data-id="dateList"] [data-pano-id]')]
          .map(button => ({ panoId: button.getAttribute('data-pano-id'), date: button.textContent.trim() }));
      })()`);
      options = (Array.isArray(options) ? options : []).filter(item => validId(item?.panoId) && dateKey(item.date))
        .map(item => ({ panoId: item.panoId, date: dateKey(item.date) }));
      if (options.length) break;
      await pause(350);
      assertCurrent(pane, snapshot);
    }
  } finally {
    // Do not close controls in a replacement document after a navigation.
    assertCurrent(pane, snapshot);
    await execute(pane, snapshot, `(() => {
      const visible = ${visible};
      const button = [...document.querySelectorAll('[data-id="selectedDateBtn"]'), ...document.querySelectorAll('[data-id="nowDateBtn"]')].find(visible);
      if (button?.parentElement.classList.contains('opt_open')) button.click();
    })()`);
  }

  // A live URL can remain in the address bar while an old photo is selected.
  // Only pair that ID with the actual current-date button in live-view mode.
  let latestPano = null;
  if (!initial.selectedDate && dateKey(initial.currentDate)) {
    try {
      const url = new URL(initial.url || pane.state?.url);
      const id = url.searchParams.get('panoid');
      if (validId(id)) {
        latestPano = id;
        options.push({ panoId: id, date: dateKey(initial.currentDate) });
        pane.latestCapture = { frame: snapshot.frame, generation: snapshot.generation, url: initial.url, panoId: id, date: dateKey(initial.currentDate) };
      }
    } catch { /* A date list can still be used when no live ID is available. */ }
  }
  const knownLatest = pane.latestCapture;
  if (!latestPano && knownLatest?.frame === snapshot.frame && knownLatest.generation === snapshot.generation && knownLatest.url === initial.url) {
    latestPano = knownLatest.panoId;
    options.push({ panoId: knownLatest.panoId, date: knownLatest.date });
  }
  assertCurrent(pane, snapshot);
  pane.latestPano = latestPano;
  pane.history = [...new Map(options.map(item => [item.panoId, item])).values()].sort((a, b) => b.date.localeCompare(a.date));
  return pane.history;
}

async function selectDate(pane, panoId) {
  const snapshot = context(pane);
  const id = typeof panoId === 'number' && Number.isSafeInteger(panoId) ? String(panoId) : panoId;
  const item = validId(id) && pane.history?.find(option => option.panoId === id && dateKey(option.date));
  if (!item) throw new Error('해당 화면에서 제공되는 촬영일 목록을 다시 열어 선택해 주세요.');

  if (id === pane.latestPano) {
    await execute(pane, snapshot, `(() => {
      const visible = ${visible};
      const back = document.querySelector('[data-id="backToRoadviewBtn"]');
      if (visible(back)) back.click();
    })()`);
  } else {
    const result = await execute(pane, snapshot, `(() => {
      const visible = ${visible}, id = ${JSON.stringify(id)};
      const selected = document.querySelector('[data-id="selectedDateBtn"]');
      const current = document.querySelector('[data-id="nowDateBtn"]');
      const button = visible(selected) ? selected : visible(current) ? current : null;
      if (!button) return 'missing';
      if (!button.parentElement.classList.contains('opt_open')) button.click();
      const selector = button === selected ? '[data-id="dateList"] [data-pano-id]' : '[data-id="pastIconContainer"] button[data-pano-id]';
      const option = [...document.querySelectorAll(selector)].find(el => el.getAttribute('data-pano-id') === id);
      if (!option) return 'missing';
      option.click();
      return button === selected ? 'compare' : 'thumbnail';
    })()`);
    if (result !== 'compare' && result !== 'thumbnail') {
      pane.history = [];
      throw new Error('현재 위치에서 해당 촬영일을 찾지 못했습니다. 촬영일 목록을 다시 열어 주세요.');
    }

    if (result === 'thumbnail') {
      let ready = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        ready = await execute(pane, snapshot, `(() => {
          const visible = ${visible};
          if (visible(document.querySelector('[data-id="selectedDateBtn"]'))) return true;
          document.querySelector('[data-id="diffBtn"]')?.click();
          return false;
        })()`);
        if (ready) break;
        await pause(350);
        assertCurrent(pane, snapshot);
      }
      if (!ready) throw new Error('과거 사진을 불러오는 중입니다. 잠시 후 같은 촬영일을 다시 선택해 주세요.');
    }

    await execute(pane, snapshot, `(() => {
      const id = ${JSON.stringify(id)};
      [...document.querySelectorAll('[data-id="dateList"] [data-pano-id]')].find(el => el.getAttribute('data-pano-id') === id)?.click();
    })()`);
    // The original comparison view may finish laying out after the date click.
    await pause(200);
    assertCurrent(pane, snapshot);
    const expanded = await execute(pane, snapshot, `(() => {
      const slider = document.querySelector('[data-id="slider"]');
      if (!slider) return false;
      if (parseFloat(slider.style.left) >= 99.9) return true;
      const rect = slider.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      const fire = (target, type, clientX, buttons) => {
        const event = new MouseEvent(type, { view: window, bubbles: true, cancelable: true, clientX, clientY: y, button: 0, buttons });
        Object.defineProperty(event, 'which', { value: 1 });
        target.dispatchEvent(event);
      };
      fire(slider, 'mousedown', x, 1);
      fire(document.body, 'mousemove', innerWidth + 30, 1);
      fire(document.body, 'mouseup', innerWidth + 30, 0);
      return parseFloat(slider.style.left) >= 99.9;
    })()`);
    if (!expanded) throw new Error('과거 사진의 전체 표시를 확인하지 못했습니다. 원본 화면의 비교 경계를 오른쪽 끝으로 옮겨 주세요.');
  }

  let displayed = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    displayed = await execute(pane, snapshot, readDateScript);
    if (dateKey(displayed) === dateKey(item.date)) break;
    await pause(250);
    assertCurrent(pane, snapshot);
  }
  if (dateKey(displayed) !== dateKey(item.date)) throw new Error('촬영일 전환을 확인하지 못했습니다. 현재 화면의 날짜 메뉴를 확인하고 다시 선택해 주세요.');
  assertCurrent(pane, snapshot);
  pane.state.date = displayed;
  return displayed;
}

module.exports = { readVisibleDate, prepareCaptureView, openHistory, selectDate };
