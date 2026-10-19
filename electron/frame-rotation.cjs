const INPUT_KEY = '__roadviewTimeRotationInputV1';

function capture(pane) {
  if (!pane?.frame || pane.selecting) return null;
  return { frame: pane.frame, generation: pane.generation, version: pane.version };
}
function current(pane, context) {
  return context && pane.frame === context.frame && pane.generation === context.generation && pane.version === context.version && !pane.selecting;
}
function reader() {
  const inputKey = '__roadviewTimeRotationInputV1';
  let input = window[inputKey];
  if (!input) {
    input = window[inputKey] = { userAt: 0, userSequence: 0 };
    const remember = event => {
      if (!event.isTrusted) return;
      if ((event.type === 'pointermove' || event.type === 'mousemove') && !event.buttons) return;
      input.userAt = Date.now(); input.userSequence++;
    };
    for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown']) document.addEventListener(type, remember, { capture: true, passive: true });
  }
  try {
    const controller = window.Application?.roadviewController;
    if (typeof controller?.viewer_ !== 'function') return { available: false };
    const viewer = controller.viewer_();
    if (!viewer || typeof viewer.getViewpoint !== 'function' || typeof viewer.setViewpoint !== 'function' || !viewer.isEngineInit?.() || !viewer.getPanoId?.() || !viewer.isViewActive?.()) return { available: false };
    const point = viewer.getViewpoint();
    if (!point || !['pan', 'tilt', 'zoom'].every(key => Number.isFinite(point[key]))) return { available: false };
    return { available: true, pan: ((point.pan % 360) + 360) % 360, tilt: point.tilt, zoom: point.zoom, userAt: input.userAt, userSequence: input.userSequence, panoId: viewer.getPanoId() };
  } catch { return { available: false }; }
}

async function readRotation(pane) {
  const context = capture(pane);
  if (!context) return null;
  try {
    const value = await context.frame.executeJavaScript(`(${reader.toString()})()`);
    if (!current(pane, context) || !value?.available) return null;
    return { ...value, version: context.version, generation: context.generation };
  } catch { return null; }
}

async function applyRotation(pane, target, expected) {
  const context = capture(pane);
  if (!context || context.version !== expected.version || context.generation !== expected.generation || !['pan', 'tilt', 'zoom'].every(key => Number.isFinite(target[key]))) return { applied: false, error: '화면이 변경되었습니다.' };
  const command = { pan: ((Math.round(target.pan) % 360) + 360) % 360, tilt: Math.round(target.tilt), zoom: Math.round(target.zoom), userSequence: expected.userSequence, panoId: expected.panoId };
  try {
    const result = await context.frame.executeJavaScript(`(async () => {
      const command = ${JSON.stringify(command)};
      const input = window[${JSON.stringify(INPUT_KEY)}];
      if (!input || input.userSequence !== command.userSequence) return { applied: false, error: '사용자 조작을 우선합니다.' };
      const viewer = window.Application?.roadviewController?.viewer_?.();
      if (!viewer?.isEngineInit?.() || !viewer.isViewActive?.()) return { applied: false, error: '로드뷰 준비 중입니다.' };
      const panoId = viewer.getPanoId();
      if (panoId !== command.panoId) return { applied: false, error: '촬영 지점이 변경되었습니다.' };
      viewer.setViewpoint({ pan: command.pan, tilt: command.tilt, zoom: command.zoom });
      let point;
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 25));
        if (input.userSequence !== command.userSequence) return { applied: false, error: '사용자 조작을 우선합니다.' };
        if (viewer !== window.Application?.roadviewController?.viewer_?.() || !viewer.isViewActive?.() || viewer.getPanoId() !== panoId) return { applied: false, error: '촬영 지점이 변경되었습니다.' };
        point = viewer.getViewpoint();
        const delta = Math.abs(((point.pan - command.pan + 540) % 360) - 180);
        if (delta <= 1 && Math.abs(point.tilt - command.tilt) <= 1 && Math.abs(point.zoom - command.zoom) < .01) return { applied: true, pan: point.pan, tilt: point.tilt, zoom: point.zoom, userSequence: input.userSequence };
      }
      return { applied: false, error: '방향을 맞추는 중입니다.' };
    })()`);
    if (!current(pane, context)) return { applied: false, error: '화면이 변경되었습니다.' };
    return { ...result, version: context.version };
  } catch { return { applied: false, error: '원본 회전 제어를 다시 연결하고 있습니다.' }; }
}

module.exports = { readRotation, applyRotation };
