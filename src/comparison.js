import { createRoadviewFrame, kakaoUrl } from './web-api.js';

export function createComparison(initialUrl) {
  const stage = document.querySelector('#comparison-stage');
  const frames = [], urls = [initialUrl, initialUrl];
  let mode = 'split', position = 50;
  function render() {
    stage.dataset.mode = mode;
    stage.style.setProperty('--wipe', `${position}%`);
    document.querySelector('#compare-overlap').setAttribute('aria-pressed', String(mode === 'overlap'));
    document.querySelector('#compare-split').setAttribute('aria-pressed', String(mode === 'split'));
    document.querySelector('#wipe-controls').hidden = mode !== 'overlap';
    document.querySelector('#wipe-handle').hidden = mode !== 'overlap';
    document.querySelector('#wipe-range').value = position;
    document.querySelector('#wipe-value').textContent = `${position}%`;
    const handle = document.querySelector('#wipe-handle');
    handle.setAttribute('aria-valuenow', position);
    handle.setAttribute('aria-valuetext', `시점 A ${position}%, 시점 B ${100 - position}%`);
  }
  function setPosition(value) { position = Math.round(Math.max(0, Math.min(100, value))); render(); }
  function setMode(value) { mode = value; render(); }
  document.querySelector('#compare-overlap').addEventListener('click', () => setMode('overlap'));
  document.querySelector('#compare-split').addEventListener('click', () => setMode('split'));
  document.querySelector('#choose-periods').addEventListener('click', () => setMode('split'));
  document.querySelector('#wipe-range').addEventListener('input', event => setPosition(Number(event.target.value)));
  const handle = document.querySelector('#wipe-handle');
  handle.addEventListener('pointerdown', event => { handle.setPointerCapture(event.pointerId); stage.classList.add('dragging'); });
  handle.addEventListener('pointermove', event => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    const rect = stage.getBoundingClientRect(); setPosition((event.clientX - rect.left) / rect.width * 100);
  });
  handle.addEventListener('lostpointercapture', () => stage.classList.remove('dragging'));
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); setPosition(event.key === 'Home' ? 0 : event.key === 'End' ? 100 : position + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1));
  });
  document.querySelectorAll('[data-compare-reload]').forEach(button => button.addEventListener('click', () => { const i = Number(button.dataset.compareReload); if (frames[i]) frames[i].src = urls[i]; }));
  render();
  return {
    mount() {
      if (frames.length) return;
      for (let i = 0; i < 2; i++) {
        const frame = createRoadviewFrame(urls[i], `시점 ${i === 0 ? 'A' : 'B'} 카카오맵 로드뷰 · 촬영일은 원본에서 선택`);
        frames.push(frame); document.querySelector(`#compare-source-${i}`).append(frame);
      }
    },
    navigate(url, target = 'all') {
      const valid = kakaoUrl(url);
      (target === 'all' ? [0, 1] : [Number(target)].filter(i => i < 2)).forEach(i => { urls[i] = valid; if (frames[i]) frames[i].src = valid; });
    },
  };
}
