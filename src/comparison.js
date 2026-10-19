import { createRoadviewFrame, kakaoUrl } from './web-api.js';

const $ = selector => document.querySelector(selector);
const LETTERS = ['A', 'B', 'C', 'D'];

export function createComparison(initialUrl) {
  const stage = $('#comparison-stage');
  const frames = new Map(), urls = Array(4).fill(initialUrl), connected = new Set();
  let mode = 'split', count = 2, x = 50, y = 50, focused = null;

  for (let index = 0; index < 4; index++) {
    const source = document.createElement('div');
    source.className = 'compare-source'; source.id = `compare-source-${index}`;
    source.dataset.index = index; source.setAttribute('aria-label', `비교 시점 ${LETTERS[index]}`);
    const label = document.createElement('div'); label.className = 'compare-source-label';
    const badge = document.createElement('b'); badge.textContent = LETTERS[index];
    const title = document.createElement('span'); title.textContent = '비교 시점';
    function button(text, name, action) {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
      element.setAttribute('aria-label', `시점 ${LETTERS[index]} ${name}`); element.title = name;
      element.addEventListener('click', action); return element;
    }
    const expand = button('⛶', '크게 보기', () => { focused = focused === index ? null : index; render(); });
    expand.dataset.expandSource = index;
    const reload = button('↻', '새로고침', () => { if (frames.has(index)) frames.get(index).src = urls[index]; });
    const original = document.createElement('a'); original.href = urls[index]; original.target = '_blank'; original.rel = 'noopener noreferrer'; original.textContent = '© Kakao ↗'; original.title = `시점 ${LETTERS[index]} 원본 열기`;
    label.append(badge, title, expand, reload, original); source.append(label); stage.prepend(source);
  }
  function ensureFrames() {
    for (let index = 0; index < count; index++) {
      if (frames.has(index)) continue;
      const frame = createRoadviewFrame(urls[index], `시점 ${LETTERS[index]} 카카오맵 로드뷰 · 촬영일은 원본에서 선택`);
      frame.addEventListener('load', () => { connected.add(index); updateConnection(); });
      frames.set(index, frame); $(`#compare-source-${index}`).append(frame);
    }
  }
  function updateConnection() {
    const loaded = [...connected].filter(index => index < count).length;
    $('#connection-status').textContent = `원본 페이지 연결 ${loaded}/${count}`;
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
    updateConnection();
  }
  function position(nextX = x, nextY = y) { x = Math.round(Math.max(0, Math.min(100, nextX))); y = Math.round(Math.max(0, Math.min(100, nextY))); render(); }
  function setMode(value) { mode = value; focused = null; render(); }
  $('#compare-overlap').addEventListener('click', () => setMode('overlap'));
  $('#compare-split').addEventListener('click', () => setMode('split'));
  $('#choose-periods').addEventListener('click', () => setMode('split'));
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
  return {
    setCount(value) { count = value === 4 ? 4 : 2; focused = null; ensureFrames(); render(); },
    navigate(url, target = 'all') {
      const valid = kakaoUrl(url);
      (target === 'all' ? [0, 1, 2, 3] : [Number(target)]).forEach(index => {
        if (!Number.isInteger(index) || index < 0 || index > 3) return;
        urls[index] = valid; connected.delete(index); if (frames.has(index)) frames.get(index).src = valid;
        $(`#compare-source-${index} a`).href = valid;
      });
      updateConnection();
    },
  };
}
