const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openHistory, selectDate } = require('../electron/frame-history.cjs');

function paneWith(executeJavaScript) {
  return { frame: { executeJavaScript }, generation: 1, state: { date: '2025.11', url: 'https://map.kakao.com/?panoid=300' }, history: [] };
}

test('원본에서 제공된 목록에 없는 촬영 ID는 원격 화면을 조작하지 않는다', async () => {
  let calls = 0;
  const pane = paneWith(async () => { calls++; });
  pane.history = [{ panoId: '100', date: '2018.07' }];
  await assert.rejects(selectDate(pane, '999'), /목록을 다시/);
  await assert.rejects(selectDate(pane, '100;alert(1)'), /목록을 다시/);
  assert.equal(calls, 0);
  assert.equal(pane.state.date, '2025.11');
});

test('목록을 읽는 사이 화면이 바뀌면 이전 목록을 새 화면에 저장하지 않는다', async () => {
  let release;
  const pane = paneWith(() => new Promise(resolve => { release = resolve; }));
  pane.history = [{ panoId: '300', date: '2025.11' }];
  const pending = openHistory(pane);
  pane.generation++;
  release({ currentDate: '2025.11', selectedDate: '', url: pane.state.url });
  await assert.rejects(pending, /화면이 변경/);
  assert.deepEqual(pane.history, []);
});

test('과거 사진 화면의 날짜를 주소 표시줄에 남은 최신 ID와 결합하지 않는다', async () => {
  const results = [
    { currentDate: '', selectedDate: '2018년 7월', url: 'https://map.kakao.com/?panoid=300' },
    [{ panoId: '100', date: '2018.07' }, { panoId: '200', date: '2020.09' }],
    undefined,
  ];
  const pane = paneWith(async () => results.shift());
  pane.latestPano = '300';
  pane.history = [{ panoId: 'old-cache', date: '2010.01' }];
  assert.deepEqual(await openHistory(pane), [{ panoId: '200', date: '2020.09' }, { panoId: '100', date: '2018.07' }]);
  assert.equal(pane.latestPano, null);
});

test('촬영일 전환 도중 iframe이 교체되면 이전 날짜를 새 화면에 기록하지 않는다', async () => {
  let release;
  const pane = paneWith(() => new Promise(resolve => { release = resolve; }));
  pane.history = [{ panoId: '100', date: '2018.07' }];
  const pending = selectDate(pane, '100');
  pane.frame = { executeJavaScript: async () => '2018.07' };
  release('compare');
  await assert.rejects(pending, /화면이 변경/);
  assert.equal(pane.state.date, '2025.11');
});

test('원본에서 확인한 표시 날짜만 성공 결과와 상태에 반영한다', async () => {
  const results = ['compare', undefined, true, '2018년 7월'];
  const pane = paneWith(async () => results.shift());
  pane.history = [{ panoId: '100', date: '2018.07' }];
  assert.equal(await selectDate(pane, '100'), '2018년 7월');
  assert.equal(pane.state.date, '2018년 7월');
});

test('과거 사진의 비교 경계 확장을 확인하지 못하면 선택 성공을 기록하지 않는다', async () => {
  const results = ['compare', undefined, false];
  const pane = paneWith(async () => results.shift());
  pane.history = [{ panoId: '100', date: '2018.07' }];
  await assert.rejects(selectDate(pane, '100'), /전체 표시를 확인하지 못/);
  assert.equal(pane.state.date, '2025.11');
});
