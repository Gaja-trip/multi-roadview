import { createRoadviewFrame, kakaoUrl } from './web-api.js';
import { captureDateKey, captureDateLabel } from './capture-date.js';

const $ = selector => document.querySelector(selector);
const LETTERS = ['A', 'B', 'C', 'D'];

export function createComparison(initialUrl, options = {}) {
  const stage = $('#comparison-stage');
  const frames = new Map(), urls = Array(4).fill(initialUrl), connected = new Set();
  const actualDates = Array(4).fill(''), editors = [], requestIds = Array(4).fill(0);
  const versions = Array.from({ length: 4 }, () => crypto.randomUUID());
  const desktop = Boolean(options.api?.desktop);
  stage.classList.toggle('native-comparison', desktop);
  const supportsRotation = desktop && typeof options.api?.rotation === 'function';
  const supportsPeriods = desktop && typeof options.api?.arrangePeriods === 'function';
  let arranging = false, arrangedKey = '', periodStatus = '', arrangementEpoch = 0;
  const dateBusy = new Set();
  let rotationEnabled = true, rotationState = null, rotationConfiguration = '';
  try { rotationEnabled = localStorage.getItem('roadview-rotation-enabled') !== 'false'; } catch { /* Optional preference. */ }
  let mode = 'split', count = 2, x = 50, y = 50, focused = null;

  for (let index = 0; index < 4; index++) {
    const source = document.createElement('div');
    source.className = 'compare-source'; source.id = `compare-source-${index}`;
    source.dataset.index = index; source.setAttribute('aria-label', `비교 시점 ${LETTERS[index]}`);
    const label = document.createElement('div'); label.className = 'compare-source-label';
    const badge = document.createElement('b'); badge.textContent = LETTERS[index];
    const bearing = document.createElement('span'); bearing.className = 'source-bearing'; bearing.hidden = true;
    bearing.setAttribute('aria-label', `화면 ${LETTERS[index]} 현재 방향`);
    const title = document.createElement('button'); title.className = 'source-period';
    title.addEventListener('click', () => void openDates(index));
    const captureDate = document.createElement('button'); captureDate.type = 'button'; captureDate.className = 'source-capture-date'; captureDate.hidden = !desktop;
    captureDate.addEventListener('click', () => void openDates(index));
    function button(text, name, action) {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
      element.setAttribute('aria-label', `시점 ${LETTERS[index]} ${name}`); element.title = name;
      element.addEventListener('click', action); return element;
    }
    const expand = button('⛶', '크게 보기', () => { focused = focused === index ? null : index; render(); });
    expand.dataset.expandSource = index;
    const reload = button('↻', '새로고침', () => reloadSource(index));
    const original = document.createElement('a'); original.href = urls[index]; original.target = '_blank'; original.rel = 'noopener noreferrer'; original.textContent = '© Kakao ↗'; original.title = `시점 ${LETTERS[index]} 원본 열기`;
    label.append(badge, title, bearing, expand, reload, original); source.append(label, captureDate); stage.prepend(source);
    const form = document.createElement('form'); form.className = 'period-editor'; form.dataset.index = index;
    const heading = document.createElement('h3'); heading.textContent = `화면 ${LETTERS[index]}`;
    const currentDate = document.createElement('p'); currentDate.className = 'period-current-date';
    const urlLabel = document.createElement('label'); urlLabel.htmlFor = `period-url-${index}`; urlLabel.textContent = '카카오맵 위치 링크';
    const urlInput = document.createElement('input'); urlInput.id = urlLabel.htmlFor; urlInput.type = 'url'; urlInput.maxLength = 5000; urlInput.placeholder = 'https://map.kakao.com/…';
    const error = document.createElement('p'); error.className = 'inline-error'; error.setAttribute('role', 'alert'); error.hidden = true;
    const chooseDate = button('촬영일 선택', '촬영일 선택', () => void openDates(index));
    chooseDate.className = 'button quiet wide'; chooseDate.dataset.chooseDate = index;
    const dateOptions = document.createElement('div'); dateOptions.className = 'date-options'; dateOptions.hidden = true;
    const actions = document.createElement('div'); actions.className = 'period-actions';
    const apply = document.createElement('button'); apply.type = 'submit'; apply.className = 'button quiet'; apply.textContent = '이 화면에 적용';
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'text-button'; reset.textContent = '현재 위치로 초기화';
    reset.addEventListener('click', () => { navigate(initialUrl, index); options.notify?.(`화면 ${LETTERS[index]}를 현재 비교 위치로 초기화했습니다.`); });
    const locationDetails = document.createElement('details'); locationDetails.className = 'period-location';
    const summary = document.createElement('summary'); summary.textContent = '이 화면의 위치 링크 변경';
    actions.append(apply, reset); locationDetails.append(summary, urlLabel, urlInput, actions);
    form.append(heading, currentDate, chooseDate, dateOptions, error, locationDetails);
    form.addEventListener('submit', event => {
      event.preventDefault(); error.hidden = true;
      try {
        const link = urlInput.value.trim();
        if (!link) throw new Error('카카오맵 위치 링크를 입력해 주세요.');
        navigate(link, index);
        options.notify?.(`화면 ${LETTERS[index]}의 위치를 변경했습니다. 제공되는 촬영 시기를 다시 확인합니다.`);
      } catch (problem) { error.textContent = problem.message; error.hidden = false; }
    });
    editors.push({ form, currentDate, urlInput, error, chooseDate, dateOptions }); $('#period-editors').append(form); renderPeriod(index);
  }
  async function openDates(index) {
    if (dateBusy.has(index)) return;
    if (arranging) { options.notify?.('서로 다른 촬영 연도를 배치하고 있습니다. 잠시 후 촬영일을 변경해 주세요.'); return; }
    options.openPeriods?.();
    const editor = editors[index], token = ++requestIds[index];
    editor.chooseDate.focus();
    editor.error.hidden = true;
    if (!desktop) {
      focused = index; render();
      options.notify?.(`화면 ${LETTERS[index]}를 크게 열었습니다. 원본 왼쪽 위 촬영일·시계에서 과거 사진을 선택한 뒤 비교로 돌아오세요.`);
      return;
    }
    // An explicit date choice takes precedence over pending automatic setup.
    arrangedKey = periodKey(); dateBusy.add(index); updatePeriodStatus();
    editor.chooseDate.disabled = true; editor.chooseDate.textContent = '촬영일 불러오는 중…';
    editor.dateOptions.replaceChildren(); editor.dateOptions.hidden = false;
    try {
      const dates = await options.api.openHistory(index);
      if (requestIds[index] !== token) return;
      if (!dates.length) throw new Error('제공되는 과거 촬영일을 찾지 못했습니다. 원본의 날짜 메뉴에서 확인해 주세요.');
      for (const item of dates) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'date-option'; button.textContent = captureDateLabel(item.date) || item.date;
        button.setAttribute('aria-pressed', String(captureDateKey(actualDates[index]) === captureDateKey(item.date)));
        button.addEventListener('click', async () => {
          if (requestIds[index] !== token) return;
          editor.error.hidden = true;
          dateBusy.add(index); updatePeriodStatus();
          editor.dateOptions.querySelectorAll('button').forEach(option => { option.disabled = true; });
          try {
            const result = await options.api.selectDate({ index, panoId: item.panoId });
            if (requestIds[index] !== token) return;
            actualDates[index] = result.date; renderPeriod(index);
            periodStatus = '촬영일을 직접 선택했습니다. 다른 화면의 촬영 시기는 유지됩니다.'; updatePeriodStatus();
            editor.dateOptions.hidden = true;
            options.notify?.(`화면 ${LETTERS[index]}를 ${result.date} 촬영분으로 변경했습니다.`);
          } catch (error) {
            if (requestIds[index] === token) { editor.error.textContent = error.message; editor.error.hidden = false; }
          } finally { dateBusy.delete(index); editor.dateOptions.querySelectorAll('button').forEach(option => { option.disabled = false; }); updatePeriodStatus(); }
        });
        editor.dateOptions.append(button);
      }
    } catch (error) {
      if (requestIds[index] === token) { editor.error.textContent = error.message; editor.error.hidden = false; }
    } finally {
      dateBusy.delete(index);
      if (requestIds[index] === token) { editor.chooseDate.disabled = false; editor.chooseDate.textContent = '촬영일 선택'; }
      updatePeriodStatus();
    }
  }
  function renderPeriod(index) {
    const source = $(`#compare-source-${index}`), title = source.querySelector('.source-period');
    const date = captureDateLabel(actualDates[index]);
    title.textContent = '촬영일 변경';
    title.title = `촬영일 선택${date ? ` · 실제 촬영 ${date}` : ''}`;
    title.setAttribute('aria-label', `화면 ${LETTERS[index]} ${title.title}`);
    source.dataset.period = actualDates[index];
    const badge = source.querySelector('.source-capture-date');
    badge.textContent = date || '촬영일 확인 중…'; badge.dataset.confirmed = String(Boolean(date));
    badge.setAttribute('aria-label', `화면 ${LETTERS[index]} ${date ? `실제 촬영 ${date} · 촬영일 변경` : '촬영일 확인 중'}`);
    if (editors[index]) editors[index].currentDate.textContent = date || (desktop ? '실제 촬영일을 확인하고 있습니다.' : '원본 왼쪽 위 촬영일을 확인하세요.');
  }
  function periodKey() { return `${count}:${versions.slice(0, count).join(':')}`; }
  function periodReady() { return actualDates.slice(0, count).every((date, index) => connected.has(index) && captureDateKey(date)); }
  function updatePeriodStatus() {
    const button = $('#arrange-periods');
    button.disabled = !supportsPeriods || arranging || dateBusy.size > 0 || !periodReady();
    button.textContent = arranging ? '촬영 연도 배치 중…' : '서로 다른 연도 자동 배치';
    $('#period-status').textContent = !supportsPeriods ? '웹에서는 원본 촬영일 메뉴에서 화면마다 다른 연도를 직접 선택하세요. Windows 앱은 실제 촬영 연도를 자동으로 배치합니다.' : periodStatus || '원본 촬영일을 확인하면 과거부터 최신까지 서로 다른 연도로 자동 배치합니다.';
    stage.dataset.arranging = String(arranging);
    for (let index = 0; index < 4; index++) {
      $(`#compare-source-${index} .source-period`).disabled = arranging || dateBusy.has(index);
      $(`#compare-source-${index} .source-capture-date`).disabled = arranging || dateBusy.has(index);
      editors[index].chooseDate.disabled = arranging || dateBusy.has(index);
    }
  }
  async function arrangePeriods(force = false) {
    if (!supportsPeriods || arranging || dateBusy.size || !periodReady()) return;
    const key = periodKey(), epoch = arrangementEpoch;
    if (!force && key === arrangedKey) return;
    arrangedKey = key; arranging = true; periodStatus = '제공되는 실제 촬영일을 확인해 과거부터 최신 순으로 배치하고 있습니다.';
    for (const editor of editors) { editor.dateOptions.hidden = true; editor.error.hidden = true; }
    updatePeriodStatus(); updateConnection();
    try {
      const result = await options.api.arrangePeriods({ versions: versions.slice(0, count) });
      if (key !== periodKey() || epoch !== arrangementEpoch) return;
      for (const selection of result.selections) {
        if (selection.version !== versions[selection.index]) continue;
        actualDates[selection.index] = selection.date; renderPeriod(selection.index);
      }
      for (const problem of result.errors) { const editor = editors[problem.index]; editor.error.textContent = problem.error; editor.error.hidden = false; }
      periodStatus = result.errors.length ? `${result.selections.length}/${count}개 화면의 촬영일을 배치했습니다. 연결되지 않은 화면의 촬영일을 다시 선택해 주세요.` : result.distinctYears < count ? `화면별 제공 목록에서 ${result.distinctYears}개 연도로 배치했습니다. 일부 화면은 같은 연도로 표시됩니다. 전체 제공 연도는 ${result.totalYears}개입니다.` : `${result.distinctYears}개 실제 촬영 연도를 ${result.chronological ? '과거부터 최신 순으로' : '화면별 제공 범위에서'} 배치했습니다. 각 화면의 촬영일을 직접 바꿀 수도 있습니다.`;
      stage.dataset.periodState = result.errors.length ? 'partial' : 'ready';
      options.notify?.(periodStatus);
    } catch (error) {
      if (key === periodKey() && epoch === arrangementEpoch) { periodStatus = error.message; stage.dataset.periodState = 'error'; }
    } finally {
      arranging = false; updatePeriodStatus(); updateConnection();
      if (key !== periodKey() || epoch !== arrangementEpoch) {
        arrangedKey = ''; void arrangePeriods();
      }
    }
  }
  function reloadSource(index) {
    arrangementEpoch++; periodStatus = ''; stage.dataset.periodState = 'waiting';
    requestIds[index]++; actualDates[index] = '';
    versions[index] = crypto.randomUUID();
    const bearing = $(`#compare-source-${index} .source-bearing`); bearing.hidden = true;
    void options.api?.frame?.({ index, version: versions[index], ready: false }).catch(() => {});
    editors[index].dateOptions.hidden = true; editors[index].chooseDate.disabled = false; editors[index].chooseDate.textContent = '촬영일 선택';
    connected.delete(index);
    if (frames.has(index)) { frames.get(index).name = `roadview-source-${index}-${versions[index]}`; frames.get(index).src = urls[index]; }
    renderPeriod(index); updateConnection();
  }
  function ensureFrames() {
    for (let index = 0; index < count; index++) {
      if (frames.has(index)) continue;
      const frame = createRoadviewFrame(urls[index], `시점 ${LETTERS[index]} 카카오맵 로드뷰 · 원본 촬영일 선택`);
      frame.name = `roadview-source-${index}-${versions[index]}`;
      frame.addEventListener('load', () => {
        connected.add(index); updateConnection();
        void options.api?.frame?.({ index, version: versions[index], ready: true }).then(() => arrangePeriods()).catch(() => {});
      });
      frames.set(index, frame); $(`#compare-source-${index}`).append(frame);
    }
  }
  function updateConnection() {
    const loaded = [...connected].filter(index => index < count).length;
    $('#connection-status').textContent = `원본 페이지 연결 ${loaded}/${count}`;
    const state = rotationState;
    $('#rotation-enabled').disabled = !supportsRotation;
    $('#rotation-enabled').checked = supportsRotation && rotationEnabled;
    $('#view-mode-status').textContent = arranging ? '시기별 사진 배치 중…' : supportsRotation && rotationEnabled ? state?.synchronized ? '같은 방향으로 연동 중' : `회전 연결 중 · ${state?.ready || 0}/${count}` : '키 없이 원본 보기 · 방향 개별 조절';
    $('#sync-status').textContent = !supportsRotation ? '일반 웹브라우저에서는 원본 화면을 직접 조절합니다. 키 없는 자동 회전은 Windows 앱에서 사용할 수 있습니다.' : !rotationEnabled ? '자동 회전을 껐습니다. 각 화면을 따로 조절할 수 있습니다.' : state?.synchronized ? `화면 ${LETTERS[state.leader] || 'A'} 기준으로 ${count}개 화면의 방향·기울기·확대를 연동합니다. 각 화면의 촬영 시기는 유지합니다.` : state?.error || `로드뷰 회전 제어를 연결하는 중입니다. (${state?.ready || 0}/${count})`;
    $('#sync-status').classList.toggle('has-error', supportsRotation && rotationEnabled && Boolean(state?.error) && state?.ready === count);
    $('#layout-summary').textContent = state?.synchronized && rotationEnabled ? `${count}분할 · 같은 방향` : `${count}분할 · 비교 설정`;
    for (let index = 0; index < 4; index++) {
      const bearing = $(`#compare-source-${index} .source-bearing`);
      const value = rotationEnabled && state?.views?.find(view => view.index === index && view.version === versions[index]);
      bearing.hidden = !value || !Number.isFinite(value.pan);
      if (!bearing.hidden) bearing.textContent = `${Math.round(value.pan)}°`;
    }
  }
  function configureRotation() {
    if (!supportsRotation) return;
    const configuration = `${count}:${rotationEnabled}`;
    if (configuration === rotationConfiguration) return;
    rotationConfiguration = configuration; rotationState = null;
    void options.api.rotation({ count, enabled: rotationEnabled }).catch(error => {
      if (configuration !== rotationConfiguration) return;
      rotationConfiguration = ''; rotationState = { error: error.message, ready: 0 }; updateConnection();
    });
  }
  function render() {
    stage.dataset.mode = mode; stage.dataset.count = count;
    stage.classList.toggle('source-focused', focused !== null);
    stage.style.setProperty('--wipe-x', `${x}%`); stage.style.setProperty('--wipe-y', `${y}%`);
    for (let index = 0; index < 4; index++) {
      const source = $(`#compare-source-${index}`);
      const inactive = focused !== null ? index !== focused : index >= count;
      source.classList.toggle('source-inactive', inactive); source.inert = inactive;
      source.setAttribute('aria-hidden', String(inactive));
      const button = source.querySelector('[data-expand-source]');
      button.textContent = focused === index ? '↙' : '⛶';
      button.title = focused === index ? '비교로 돌아가기' : '크게 보기';
      button.setAttribute('aria-label', `시점 ${LETTERS[index]} ${button.title}`);
      editors[index].form.hidden = index >= count;
    }
    $('#compare-overlap').setAttribute('aria-pressed', String(mode === 'overlap'));
    $('#compare-split').setAttribute('aria-pressed', String(mode === 'split'));
    $('#compare-title').textContent = `같은 장소 · ${count}개 시점`;
    $('#comparison').setAttribute('aria-label', `한 화면에서 ${count}개 시점 ${mode === 'overlap' ? '겹침' : '분할'} 비교`);
    const overlay = mode === 'overlap' && focused === null;
    $('#wipe-controls').hidden = !overlay; $('#wipe-handle').hidden = !overlay;
    $('#wipe-horizontal').hidden = !overlay || count !== 4; $('#wipe-center').hidden = !overlay || count !== 4;
    $('#wipe-y-control').hidden = count !== 4;
    for (const [axis, value] of [['x', x], ['y', y]]) {
      $(`#wipe-${axis}`).value = value; $(`#wipe-${axis}-value`).textContent = `${value}%`;
    }
    $('#wipe-handle').setAttribute('aria-valuenow', x); $('#wipe-horizontal').setAttribute('aria-valuenow', y);
    $('#wipe-center').setAttribute('aria-label', `4분할 경계 이동 · 가로 ${x}%, 세로 ${y}%. 방향키로 조절`);
    $('#compare-back').hidden = focused === null;
    $('#sync-rule').textContent = '모든 촬영 시기를 같은 방향으로 비교';
    $('#direction-preview').replaceChildren(...LETTERS.slice(0, count).map((letter, index) => {
      const item = document.createElement('span'); item.textContent = `${letter} · 같은 방향`; return item;
    }));
    configureRotation(); updateConnection(); updatePeriodStatus();
  }
  function position(nextX = x, nextY = y) { x = Math.round(Math.max(0, Math.min(100, nextX))); y = Math.round(Math.max(0, Math.min(100, nextY))); render(); }
  function setMode(value) { mode = value; focused = null; render(); }
  $('#compare-overlap').addEventListener('click', () => setMode('overlap'));
  $('#compare-split').addEventListener('click', () => setMode('split'));
  $('#choose-periods').addEventListener('click', () => options.openPeriods?.());
  $('#compare-back').addEventListener('click', () => { focused = null; render(); });
  $('#wipe-x').addEventListener('input', event => position(Number(event.target.value), y));
  $('#wipe-y').addEventListener('input', event => position(x, Number(event.target.value)));
  $('#reset-boundary').addEventListener('click', () => position(50, 50));
  function draggable(element, axis) {
    element.addEventListener('pointerdown', event => { element.setPointerCapture(event.pointerId); stage.classList.add('dragging'); });
    element.addEventListener('pointermove', event => {
      if (!element.hasPointerCapture(event.pointerId)) return;
      const rect = stage.getBoundingClientRect();
      position(axis === 'y' ? x : (event.clientX - rect.left) / rect.width * 100, axis === 'x' ? y : (event.clientY - rect.top) / rect.height * 100);
    });
    element.addEventListener('lostpointercapture', () => stage.classList.remove('dragging'));
    element.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const step = event.shiftKey ? 10 : 1;
      if (event.key === 'Home' || event.key === 'End') { const edge = event.key === 'Home' ? 0 : 100; position(axis === 'y' ? x : edge, axis === 'x' ? y : edge); return; }
      position(x + (axis !== 'y' ? (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) : 0), y + (axis !== 'x' ? (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) : 0));
    });
  }
  draggable($('#wipe-handle'), 'x'); draggable($('#wipe-horizontal'), 'y'); draggable($('#wipe-center'), 'both');
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]') && focused !== null) { focused = null; render(); } });
  function navigate(url, target = 'all') {
    const valid = kakaoUrl(url);
    if (target === 'all') initialUrl = valid;
    (target === 'all' ? [0, 1, 2, 3] : [Number(target)]).forEach(index => {
      if (!Number.isInteger(index) || index < 0 || index > 3) return;
      urls[index] = valid; editors[index].urlInput.value = target === 'all' ? '' : valid; editors[index].error.hidden = true;
      reloadSource(index);
      $(`#compare-source-${index} a`).href = valid;
    });
  }
  options.api?.onPane?.(({ index, date, version }) => {
    if (!Number.isInteger(index) || index < 0 || index > 3 || typeof date !== 'string' || version !== versions[index]) return;
    actualDates[index] = date; renderPeriod(index);
    updatePeriodStatus(); void arrangePeriods();
  });
  options.api?.onRotation?.(state => {
    if (state.count !== count || state.enabled !== rotationEnabled) return;
    rotationState = state; updateConnection();
  });
  $('#rotation-enabled').addEventListener('change', event => {
    rotationEnabled = event.target.checked;
    try { localStorage.setItem('roadview-rotation-enabled', String(rotationEnabled)); } catch { /* Optional preference. */ }
    configureRotation(); updateConnection();
  });
  $('#arrange-periods').addEventListener('click', () => void arrangePeriods(true));
  return {
    setCount(value) { const next = value === 4 ? 4 : 2; if (next !== count) { arrangementEpoch++; stage.dataset.periodState = 'waiting'; periodStatus = ''; } count = next; focused = null; ensureFrames(); render(); void arrangePeriods(); },
    navigate,
  };
}
