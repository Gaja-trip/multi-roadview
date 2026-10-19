const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readRotation, applyRotation } = require('../electron/frame-rotation.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function source(options = {}) {
  const listeners = new Map(), setCalls = [];
  const live = { initialized: true, active: true, panoId: 'historical-2010', date: '2010.04', point: { pan: 10, tilt: 0, zoom: 0 }, ...options.live };
  const viewer = {
    isEngineInit: () => live.initialized,
    isViewActive: () => live.active,
    getPanoId: () => live.panoId,
    getViewpoint: () => live.point && { ...live.point },
    setViewpoint: point => {
      setCalls.push({ ...point });
      if (!options.ignoreSetter) live.point = { ...point };
    },
  };
  let activeViewer = viewer, executeCalls = 0, waits = 0, clock = 100;
  const window = { Application: { roadviewController: { viewer_: () => activeViewer } } };
  const dispatch = (type, properties = {}) => {
    const event = { type, isTrusted: true, buttons: 0, ...properties };
    for (const listener of listeners.get(type) || []) listener(event);
  };
  const document = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
  };
  const context = vm.createContext({
    window, document,
    Date: { now: () => ++clock },
    setTimeout(callback) {
      waits++;
      options.onWait?.({ live, dispatch, waits, pane, replaceViewer: value => { activeViewer = value; } });
      queueMicrotask(callback);
    },
  });
  const frame = {
    async executeJavaScript(script) {
      executeCalls++;
      const result = await vm.runInContext(script, context);
      await options.afterExecute?.({ script, result, pane });
      return result;
    },
  };
  const pane = { frame, generation: 7, version: 'iframe-version', selecting: false };
  return { pane, live, viewer, setCalls, dispatch, listeners, get executeCalls() { return executeCalls; }, get waits() { return waits; } };
}

test('원본 엔진·파노라마·활성 화면이 준비되기 전에는 0도 화면을 연결 완료로 읽지 않는다', async () => {
  for (const live of [
    { initialized: false, point: { pan: 0, tilt: 0, zoom: 0 } },
    { active: false },
    { panoId: null },
    { point: null },
    { point: { pan: NaN, tilt: 0, zoom: 0 } },
  ]) {
    const frame = source({ live });
    assert.equal(await readRotation(frame.pane), null);
    assert.equal(frame.setCalls.length, 0);
  }
});

test('실제 주입 스크립트는 방향과 문서 정보를 읽고 입력 감시자를 중복 등록하지 않는다', async () => {
  const frame = source({ live: { point: { pan: -10, tilt: 12, zoom: 3 } } });
  const reading = await readRotation(frame.pane);
  assert.equal(reading.pan, 350);
  assert.equal(reading.tilt, 12);
  assert.equal(reading.zoom, 3);
  assert.equal(reading.version, 'iframe-version');
  assert.equal(reading.generation, 7);
  assert.equal(reading.panoId, 'historical-2010');
  await readRotation(frame.pane);
  assert.deepEqual([...frame.listeners].map(([type, listeners]) => [type, listeners.length]), [['pointerdown', 1], ['pointermove', 1], ['wheel', 1], ['keydown', 1]]);
});

test('합성 이벤트와 버튼 없는 포인터 이동은 새 사용자 입력으로 기록하지 않는다', async () => {
  const frame = source();
  const initial = await readRotation(frame.pane);
  frame.dispatch('pointerdown', { isTrusted: false, buttons: 1 });
  frame.dispatch('pointermove', { buttons: 0 });
  const ignored = await readRotation(frame.pane);
  assert.equal(ignored.userAt, initial.userAt);
  assert.equal(ignored.userSequence, initial.userSequence);
  frame.dispatch('pointerdown', { buttons: 1 });
  frame.dispatch('pointermove', { buttons: 1 });
  const trusted = await readRotation(frame.pane);
  assert.ok(trusted.userAt > ignored.userAt);
  assert.equal(trusted.userSequence, initial.userSequence + 2);
});

test('읽기 응답을 기다리는 중 세대나 문서가 바뀌면 이전 방향을 반환하지 않는다', async () => {
  for (const change of [pane => { pane.generation++; }, pane => { pane.frame = {}; }, pane => { pane.version = 'replacement'; }, pane => { pane.selecting = true; }]) {
    const gate = deferred(), entered = deferred();
    const frame = source({ afterExecute: async () => { entered.resolve(); await gate.promise; } });
    const pending = readRotation(frame.pane);
    await entered.promise; change(frame.pane); gate.resolve();
    assert.equal(await pending, null);
  }
});

test('적용 전에 세대가 바뀌었으면 원격 화면에서 setter를 실행하지 않는다', async () => {
  const frame = source();
  const expected = await readRotation(frame.pane);
  frame.pane.generation++;
  const before = frame.executeCalls;
  const result = await applyRotation(frame.pane, { pan: 190, tilt: 0, zoom: 0 }, expected);
  assert.equal(result.applied, false);
  assert.equal(frame.executeCalls, before);
  assert.equal(frame.setCalls.length, 0);
});

test('읽은 후 파노라마가 바뀌면 이전 촬영 지점에 대한 회전을 새 사진에 적용하지 않는다', async () => {
  const frame = source();
  const expected = await readRotation(frame.pane);
  frame.live.panoId = 'different-location';
  const result = await applyRotation(frame.pane, { pan: 190, tilt: 0, zoom: 0 }, expected);
  assert.equal(result.applied, false);
  assert.match(result.error, /촬영 지점/);
  assert.equal(frame.setCalls.length, 0);
});

test('목표 화면에 새 신뢰된 입력이 있으면 자동 회전보다 사용자의 조작을 우선한다', async () => {
  const frame = source();
  const expected = await readRotation(frame.pane);
  frame.dispatch('pointerdown', { buttons: 1 });
  const result = await applyRotation(frame.pane, { pan: 190, tilt: 0, zoom: 0 }, expected);
  assert.equal(result.applied, false);
  assert.match(result.error, /사용자 조작/);
  assert.equal(frame.setCalls.length, 0);
});

test('회전 확인을 기다리는 중 세대가 바뀌면 성공을 이전 문서에 기록하지 않는다', async () => {
  const frame = source({ onWait: ({ pane }) => { pane.generation++; } });
  const expected = await readRotation(frame.pane);
  const result = await applyRotation(frame.pane, { pan: 190, tilt: 0, zoom: 0 }, expected);
  assert.equal(frame.setCalls.length, 1);
  assert.equal(result.applied, false);
  assert.match(result.error, /화면이 변경/);
});

test('회전 확인 중 새 사용자 입력·새 파노라마·새 viewer가 나타나면 성공으로 기록하지 않는다', async () => {
  const changes = [
    ({ dispatch }) => dispatch('pointermove', { buttons: 1 }),
    ({ live }) => { live.panoId = 'replacement-pano'; },
    ({ live }) => { live.active = false; },
    ({ replaceViewer }) => replaceViewer({}),
  ];
  for (const onWait of changes) {
    const frame = source({ onWait });
    const expected = await readRotation(frame.pane);
    const result = await applyRotation(frame.pane, { pan: 190, tilt: 0, zoom: 0 }, expected);
    assert.equal(result.applied, false);
    assert.equal(frame.setCalls.length, 1);
  }
});

test('실제 방향 읽기에서 목표를 확인해야 성공하며 촬영일과 파노라마는 보존한다', async () => {
  const frame = source();
  const expected = await readRotation(frame.pane);
  const result = await applyRotation(frame.pane, { pan: -90, tilt: 12, zoom: 3 }, expected);
  assert.equal(result.applied, true);
  assert.equal(result.pan, 270);
  assert.equal(result.tilt, 12);
  assert.equal(result.zoom, 3);
  assert.equal(result.version, expected.version);
  assert.deepEqual(frame.setCalls, [{ pan: 270, tilt: 12, zoom: 3 }]);
  assert.equal(frame.live.panoId, 'historical-2010');
  assert.equal(frame.live.date, '2010.04');
});

test('원본이 명령을 반영하지 않으면 제한된 확인 후 실패를 반환한다', async () => {
  const frame = source({ ignoreSetter: true });
  const expected = await readRotation(frame.pane);
  const result = await applyRotation(frame.pane, { pan: 190, tilt: 0, zoom: 0 }, expected);
  assert.equal(result.applied, false);
  assert.equal(frame.waits, 6);
  assert.equal(frame.setCalls.length, 1);
  assert.equal(frame.live.point.pan, 10);
});

test('촬영일 선택 중에는 원격 방향 읽기와 회전을 시작하지 않는다', async () => {
  const frame = source();
  const expected = await readRotation(frame.pane);
  frame.pane.selecting = true;
  const before = frame.executeCalls;
  assert.equal(await readRotation(frame.pane), null);
  assert.equal((await applyRotation(frame.pane, { pan: 190, tilt: 0, zoom: 0 }, expected)).applied, false);
  assert.equal(frame.executeCalls, before);
  assert.equal(frame.setCalls.length, 0);
});
