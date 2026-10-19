const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const filename = path.join(__dirname, '../electron/period-comparison.cjs');
const nativeRequire = createRequire(filename);
const source = fs.readFileSync(filename, 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness(options = {}) {
  const count = options.count || 2;
  const panes = Array.from({ length: count }, (_, index) => ({
    index, frame: { index }, generation: 1, version: `frame-${index}`, selecting: false,
    state: { date: '2025.11' }, history: [],
  }));
  const offered = options.offered || panes.map((_, index) => [
    { panoId: String(100 + index * 10), date: '2010.04' },
    { panoId: String(101 + index * 10), date: '2025.11' },
  ]);
  const calls = [], sent = [];
  function record(operation, index) {
    calls.push({ operation, index, allLocked: panes.every(pane => pane.selecting) });
  }
  const history = {
    async readVisibleDate(frame) {
      record('read', frame.index);
      return options.readDate ? options.readDate(frame, panes) : '2025.11';
    },
    async openHistory(pane) {
      record('history', pane.index);
      const values = options.openHistory ? await options.openHistory(pane, panes) : offered[pane.index];
      pane.history = values;
      return values;
    },
    async selectDate(pane, panoId) {
      record('select', pane.index);
      const item = pane.history.find(item => item.panoId === panoId);
      assert.ok(item, `Pane ${pane.index} must never select an ID absent from its refreshed original history.`);
      const date = options.selectDate ? await options.selectDate(pane, panoId, panes) : item.date;
      pane.state.date = date;
      return date;
    },
  };
  const module = { exports: {} };
  const wrapper = new vm.Script(`(function(require, module, exports) { ${source}\n})`, { filename }).runInNewContext();
  wrapper(specifier => {
    if (specifier === './frame-history.cjs') return history;
    if (specifier === './period-plan.cjs' && options.planPeriods) return { planPeriods: options.planPeriods };
    return nativeRequire(specifier);
  }, module, module.exports);
  const dependencies = {
    getPane: index => panes[index],
    sendPane: (index, changes) => sent.push({ index, ...changes }),
  };
  const versions = panes.map(pane => pane.version);
  return { panes, offered, calls, sent, versions, arrange: payload => module.exports.arrangePeriods(payload || { versions }, dependencies) };
}

test('모든 화면을 먼저 잠그고 새로 제공된 각 화면의 촬영 ID만 선택한다', async () => {
  const batch = harness({ count: 4, offered: [
    [{ panoId: '111', date: '2010.04' }],
    [{ panoId: '222', date: '2015.06' }],
    [{ panoId: '333', date: '2020.07' }],
    [{ panoId: '444', date: '2025.11' }],
  ] });
  const result = await batch.arrange();
  assert.equal(result.selections.length, 4);
  assert.equal(result.distinctYears, 4);
  for (const selection of result.selections) {
    assert.ok(batch.offered[selection.index].some(item => item.panoId === selection.panoId && item.date === selection.date));
    assert.equal(selection.version, batch.versions[selection.index]);
  }
  assert.ok(batch.calls.every(call => call.allLocked));
  assert.equal(batch.sent.length, 4);
  assert.ok(batch.panes.every(pane => !pane.selecting));
});

test('잘못된 화면 수와 교체된 화면 버전은 원격 작업이나 잠금 전에 거부한다', async () => {
  for (const payload of [{ versions: ['frame-0'] }, { versions: ['old-frame', 'frame-1'] }, { versions: ['frame-0', 1] }]) {
    const batch = harness();
    await assert.rejects(batch.arrange(payload));
    assert.equal(batch.calls.length, 0);
    assert.ok(batch.panes.every(pane => !pane.selecting));
  }
});

test('실행 중인 배치와 두 번째 배치는 겹치지 않고 기존 잠금을 해제하지 않는다', async () => {
  const entered = deferred(), gate = deferred();
  const batch = harness({ readDate: async frame => { if (frame.index === 0) { entered.resolve(); await gate.promise; } return '2025.11'; } });
  const first = batch.arrange();
  await entered.promise;
  await assert.rejects(batch.arrange(), /변경하고 있습니다/);
  assert.ok(batch.panes.every(pane => pane.selecting));
  assert.equal(batch.calls.filter(call => call.operation === 'read').length, 2);
  gate.resolve();
  assert.equal((await first).selections.length, 2);
  assert.ok(batch.panes.every(pane => !pane.selecting));
});

test('날짜 읽기 중 위치가 바뀌면 오래된 날짜를 기록하거나 촬영 ID를 선택하지 않는다', async () => {
  const entered = deferred(), gate = deferred();
  const batch = harness({ readDate: async frame => { if (frame.index === 0) { entered.resolve(); await gate.promise; return '2010.04'; } return '2025.11'; } });
  const pending = batch.arrange();
  await entered.promise;
  batch.panes[0].generation++;
  batch.panes[0].state.date = '';
  gate.resolve();
  await assert.rejects(pending, /비교 위치가 바뀌었습니다/);
  assert.equal(batch.panes[0].state.date, '');
  assert.equal(batch.calls.filter(call => call.operation === 'select').length, 0);
  assert.ok(batch.panes.every(pane => !pane.selecting));
});

test('목록을 불러오는 중 프레임이 교체되면 이전 목록을 새 프레임에 적용하지 않는다', async () => {
  const entered = deferred(), gate = deferred();
  const batch = harness({ openHistory: async pane => {
    if (pane.index === 0) { entered.resolve(); await gate.promise; }
    return [{ panoId: String(300 + pane.index), date: '2020.07' }];
  } });
  const pending = batch.arrange(); await entered.promise;
  batch.panes[0].frame = { index: 0 };
  gate.resolve();
  await assert.rejects(pending, /비교 위치가 바뀌었습니다/);
  assert.equal(batch.calls.filter(call => call.operation === 'select').length, 0);
  assert.ok(batch.panes.every(pane => !pane.selecting));
});

test('한 화면의 목록 실패는 다른 화면의 유효한 선택을 유지하고 실제 성공 수만 보고한다', async () => {
  const batch = harness({ openHistory: async pane => {
    if (pane.index === 0) throw new Error('목록 연결 실패');
    return [{ panoId: '222', date: '2018.07' }];
  } });
  const result = await batch.arrange();
  assert.equal(result.selections.length, 1);
  assert.equal(result.selections[0].index, 1);
  assert.equal(result.distinctYears, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 0);
  assert.match(result.errors[0].error, /목록 연결 실패/);
  assert.deepEqual(batch.sent, [{ index: 1, date: '2018.07' }]);
  assert.ok(batch.panes.every(pane => !pane.selecting));
});

test('한 화면의 날짜 읽기가 실패해도 배치가 종료되면 모든 잠금을 해제한다', async () => {
  const batch = harness({ readDate: async () => { throw new Error('원본 날짜 없음'); } });
  const result = await batch.arrange();
  assert.equal(result.selections.length, 0);
  assert.equal(result.distinctYears, 0);
  assert.equal(result.errors.length, 2);
  assert.equal(batch.sent.length, 0);
  assert.ok(batch.panes.every(pane => !pane.selecting));
});

test('한 화면의 선택 실패는 성공한 촬영일을 취소하거나 실패한 시기를 성공 수에 포함하지 않는다', async () => {
  const batch = harness({ selectDate: async (pane, panoId) => {
    if (pane.index === 1) throw new Error('사진 변경 확인 실패');
    return pane.history.find(item => item.panoId === panoId).date;
  } });
  const result = await batch.arrange();
  assert.equal(result.selections.length, 1);
  assert.equal(result.selections[0].index, 0);
  assert.equal(result.distinctYears, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 1);
  assert.match(result.errors[0].error, /사진 변경 확인 실패/);
  assert.deepEqual(batch.sent, [{ index: 0, date: result.selections[0].date }]);
  assert.ok(batch.panes.every(pane => !pane.selecting));
});

test('첫 선택 후 다른 화면이 이동하면 남은 화면에 이전 계획을 적용하지 않는다', async () => {
  const batch = harness({ selectDate: async (pane, panoId, panes) => {
    if (pane.index === 0) panes[1].generation++;
    return pane.history.find(item => item.panoId === panoId).date;
  } });
  await assert.rejects(batch.arrange(), /비교 위치가 바뀌었습니다/);
  assert.deepEqual(batch.calls.filter(call => call.operation === 'select').map(call => call.index), [0]);
  assert.equal(batch.sent.length, 1);
  assert.ok(batch.panes.every(pane => !pane.selecting));
});

test('선택 결과 확인 중 프레임이 교체되면 이전 선택 성공을 새 화면에 전송하지 않는다', async () => {
  const entered = deferred(), gate = deferred();
  const batch = harness({ selectDate: async (pane, panoId) => {
    if (pane.index === 0) { entered.resolve(); await gate.promise; }
    return pane.history.find(item => item.panoId === panoId).date;
  } });
  const pending = batch.arrange(); await entered.promise;
  batch.panes[0].frame = { index: 0 }; gate.resolve();
  await assert.rejects(pending, /비교 위치가 바뀌었습니다/);
  assert.equal(batch.sent.length, 0);
  assert.ok(batch.panes.every(pane => !pane.selecting));
});

test('계획 계산에서 예외가 발생해도 배치 잠금은 남지 않는다', async () => {
  const batch = harness({ planPeriods: () => { throw new Error('계획 계산 중단'); } });
  await assert.rejects(batch.arrange(), /계획 계산 중단/);
  assert.equal(batch.sent.length, 0);
  assert.ok(batch.panes.every(pane => !pane.selecting));
});
