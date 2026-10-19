const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRotationSync, normalize, angularDistance } = require('../electron/rotation-sync.cjs');

const snapshot = (pan = 0, values = {}) => ({ available: true, version: 'frame-1', pan, tilt: 0, zoom: 0, userAt: 0, userSequence: 0, ...values });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness(initial, options = {}) {
  const frames = initial.map(item => item && { ...item }), applications = [], states = [];
  const sync = createRotationSync({
    read: async index => frames[index] && { ...frames[index] },
    apply: async (index, target, current) => {
      applications.push({ index, target, snapshot: current });
      Object.assign(frames[index], target);
      return { ...frames[index] };
    },
    onState: state => states.push(state), now: () => 1000, ...options,
  });
  return { sync, frames, applications, states };
}

test('각도는 0~360으로 정규화하고 359도와 0도의 차이는 1도로 계산한다', () => {
  assert.equal(normalize(-90), 270);
  assert.equal(normalize(721), 1);
  assert.equal(angularDistance(359, 1), 2);
  assert.equal(angularDistance(0, 359), 1);
});

test('기본 A 화면을 기준으로 B를 180도 돌리고 기울기·확대도 맞춘다', async () => {
  const { sync, applications } = harness([snapshot(359, { tilt: 12, zoom: 2 }), snapshot(0)]);
  const result = await sync.tick();
  assert.deepEqual(applications.map(item => [item.index, item.target]), [[1, { pan: 179, tilt: 12, zoom: 2 }]]);
  assert.equal(result.leader, 0);
  assert.equal(result.synchronized, true);
});

test('어느 화면을 조작해도 4개 화면은 해당 화면에서 90도씩 떨어진다', async () => {
  for (let leader = 0; leader < 4; leader++) {
    const { sync, frames } = harness(Array.from({ length: 4 }, (_, index) => snapshot(index === leader ? 7 : 51, { userAt: index === leader ? 10 : 0 })));
    sync.configure({ count: 4 });
    const result = await sync.tick();
    assert.equal(result.leader, leader);
    frames.forEach((frame, index) => assert.equal(frame.pan, normalize(7 + (index - leader) * 90)));
  }
});

test('B에서 조작한 2분할도 B의 방향을 유지하며 A가 반대로 회전한다', async () => {
  const { sync, frames } = harness([snapshot(0), snapshot(12, { userAt: 10, userSequence: 1 })]);
  assert.equal((await sync.tick()).leader, 1);
  assert.equal(frames[0].pan, 192);
  assert.equal(frames[1].pan, 12);
});

test('팔로워의 방향 변화는 새 기준이 되지 않고 신뢰된 최신 입력만 기준을 바꾼다', async () => {
  const { sync, frames, applications } = harness([snapshot(10, { userAt: 20, userSequence: 1 }), snapshot(60)]);
  await sync.tick();
  frames[1].pan = 220;
  assert.equal((await sync.tick()).leader, 0);
  assert.equal(frames[1].pan, 190);
  frames[1] = snapshot(25, { userAt: 21, userSequence: 2 });
  assert.equal((await sync.tick()).leader, 1);
  assert.equal(frames[0].pan, 205);
  assert.equal(applications.length, 3);
});

test('같은 시각의 입력은 신뢰된 입력 순서로 기준을 선택한다', async () => {
  const { sync } = harness([snapshot(0, { userAt: 10, userSequence: 1 }), snapshot(25, { userAt: 10, userSequence: 2 })]);
  assert.equal((await sync.tick()).leader, 1);
});

test('오차 1도 이하는 다시 조작하지 않고 0도 경계에서도 불필요한 회전을 하지 않는다', async () => {
  const { sync, applications } = harness([snapshot(180), snapshot(359)]);
  assert.equal((await sync.tick()).synchronized, true);
  assert.equal(applications.length, 0);
});

test('2분할에서 4분할로 전환하면 유지된 기준 화면에서 C·D도 다시 맞춘다', async () => {
  const { sync, frames } = harness([snapshot(0), snapshot(13, { userAt: 40 }), snapshot(1), snapshot(2)]);
  await sync.tick();
  assert.equal(sync.configure({ count: 4 }).synchronized, false);
  const result = await sync.tick();
  assert.equal(result.leader, 1);
  assert.deepEqual(frames.map(item => item.pan), [283, 13, 103, 193]);
});

test('중첩된 tick은 동시에 실행하지 않고 최신 상태를 읽는 한 차례로 합친다', async () => {
  const gate = deferred();
  let reads = 0, applying = 0, maxApplying = 0;
  const frames = [snapshot(10), snapshot(0)];
  const sync = createRotationSync({
    read: async index => { reads++; return { ...frames[index] }; },
    apply: async (index, target) => {
      applying++; maxApplying = Math.max(maxApplying, applying);
      await gate.promise;
      Object.assign(frames[index], target); applying--;
      return { ...frames[index] };
    },
  });
  const first = sync.tick();
  await new Promise(resolve => setImmediate(resolve));
  const second = sync.tick(), third = sync.tick();
  assert.equal(first, second);
  assert.equal(second, third);
  frames[0] = snapshot(20, { userAt: 30 });
  gate.resolve();
  assert.equal((await first).synchronized, true);
  assert.equal(reads, 4);
  assert.equal(maxApplying, 1);
  assert.equal(frames[1].pan, 200);
});

test('읽는 중 일시 중지하면 이전 설정으로 회전을 적용하지 않는다', async () => {
  const gate = deferred(); let applied = 0;
  const sync = createRotationSync({ read: index => index === 0 ? gate.promise : snapshot(0), apply: async () => { applied++; return true; } });
  const pending = sync.tick();
  sync.configure({ enabled: false }); gate.resolve(snapshot(20));
  const result = await pending;
  assert.equal(applied, 0);
  assert.equal(result.enabled, false);
  assert.equal(result.synchronized, false);
});

test('회전 적용 중 설정이 바뀌면 남은 화면에 이전 각도를 적용하지 않는다', async () => {
  const gate = deferred(), applications = [];
  const sync = createRotationSync({ read: async index => snapshot(index === 0 ? 11 : 0), apply: async index => { applications.push(index); await gate.promise; return true; } });
  sync.configure({ count: 4 });
  const pending = sync.tick(); await new Promise(resolve => setImmediate(resolve));
  sync.configure({ count: 2 }); gate.resolve();
  const result = await pending;
  assert.deepEqual(applications, [1]);
  assert.equal(result.count, 2);
  assert.equal(result.synchronized, false);
});

test('연결이 끊긴 화면이 있으면 사용 가능한 화면 수를 알리고 완료로 표시하지 않는다', async () => {
  const { sync, frames } = harness([snapshot(0), null]);
  const disconnected = await sync.tick();
  assert.equal(disconnected.ready, 1);
  assert.equal(disconnected.synchronized, false);
  assert.match(disconnected.error, /1\/2/);
  frames[1] = snapshot(180);
  assert.equal((await sync.tick()).synchronized, true);
  frames[0] = null; frames[1] = null;
  const empty = await sync.tick();
  assert.equal(empty.ready, 0);
  assert.equal(empty.leader, null);
  assert.equal(empty.synchronized, false);
});

test('읽기·회전 오류와 확인되지 않은 회전 결과는 완료로 표시하지 않는다', async () => {
  const reading = harness([snapshot(0), snapshot(0)], { read: async index => { if (index === 1) throw new Error('연결 끊김'); return snapshot(0); } });
  assert.match((await reading.sync.tick()).error, /연결 끊김/);
  for (const apply of [async () => { throw new Error('회전 오류'); }, async () => undefined, async () => ({ ok: false }), async () => snapshot(0)]) {
    const { sync } = harness([snapshot(0), snapshot(0)], { apply });
    const result = await sync.tick();
    assert.equal(result.synchronized, false);
    assert.ok(result.error);
  }
});

test('회전 도중 문서나 입력이 바뀐 결과는 이전 요청의 성공으로 기록하지 않는다', async () => {
  for (const values of [{ version: 'replacement' }, { userAt: 30 }, { userSequence: 1 }]) {
    const { sync } = harness([snapshot(0), snapshot(0)], { apply: async () => snapshot(180, values) });
    assert.equal((await sync.tick()).synchronized, false);
  }
});

test('네이티브 적용 결과는 실제 각도를 확인하며 실패 응답을 성공으로 처리하지 않는다', async () => {
  const good = harness([snapshot(0), snapshot(0)], { apply: async () => ({ applied: true, pan: 180, tilt: 0, zoom: 0, version: 'frame-1' }) });
  assert.equal((await good.sync.tick()).synchronized, true);
  for (const apply of [
    async () => ({ applied: true, pan: 175, tilt: 0, zoom: 0, version: 'frame-1' }),
    async () => ({ applied: false, pan: 180, tilt: 0, zoom: 0, version: 'frame-1', error: '새 입력 감지' }),
  ]) {
    const { sync } = harness([snapshot(0), snapshot(0)], { apply });
    assert.equal((await sync.tick()).synchronized, false);
  }
});

test('회전 목표에는 방향·기울기·확대만 포함되고 촬영일·파노라마는 보존한다', async () => {
  const { sync, frames, applications } = harness([snapshot(0, { panoId: 'now', date: '2025.11' }), snapshot(10, { panoId: 'old', date: '2010.04' })]);
  await sync.tick();
  assert.deepEqual(Object.keys(applications[0].target).sort(), ['pan', 'tilt', 'zoom']);
  assert.equal(frames[1].panoId, 'old');
  assert.equal(frames[1].date, '2010.04');
});
