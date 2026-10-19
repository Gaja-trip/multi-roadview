const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planPeriods } = require('../electron/period-plan.cjs');

const history = (years, prefix = '') => years.map(year => ({ panoId: `${prefix}${year}`, date: `${year}.06` }));
const chosenYears = plan => plan.selections.map(item => item.year);

test('2분할은 실제 제공되는 가장 오래된 연도와 가장 최근 연도를 배치한다', () => {
  const list = history([2010, 2013, 2018, 2025]);
  const plan = planPeriods([list, list]);
  assert.deepEqual(chosenYears(plan), [2010, 2025]);
  assert.equal(plan.distinctYears, 2);
  assert.equal(plan.totalYears, 4);
  assert.deepEqual(plan.duplicateYears, []);
});

test('4분할은 과거부터 최근까지 서로 다른 연도를 고르게 배치한다', () => {
  const list = history([2010, 2011, 2015, 2020, 2024, 2025]);
  const plan = planPeriods(Array(4).fill(list));
  assert.deepEqual(chosenYears(plan), [2010, 2015, 2020, 2025]);
  assert.equal(plan.chronological, true);
  assert.deepEqual(plan.selections.map(item => item.index), [0, 1, 2, 3]);
});

test('같은 연도에서는 가장 최근 촬영월과 안정적인 ID를 선택한다', () => {
  const list = [{ panoId: '101', date: '2010.01' }, { panoId: '105', date: '2010.11' }, { panoId: '102', date: '2010.11' }, { panoId: '202', date: '2025.03' }];
  const plan = planPeriods([list, list]);
  assert.deepEqual(plan.selections[0], { index: 0, panoId: '102', date: '2010.11', year: 2010 });
  assert.equal(plan.selections[1].panoId, '202');
  assert.deepEqual(planPeriods([list.toReversed(), list.toReversed()]), plan);
});

test('화면별 제공 목록이 달라도 해당 화면에 있는 실제 ID만 선택한다', () => {
  const lists = [history([2010, 2020], '1'), history([2011, 2021], '2'), history([2012, 2022], '3'), history([2013, 2025], '4')];
  const plan = planPeriods(lists);
  assert.equal(plan.distinctYears, 4);
  assert.deepEqual(chosenYears(plan), [2010, 2011, 2022, 2025]);
  for (const selected of plan.selections) assert(lists[selected.index].some(item => item.panoId === selected.panoId && item.date === selected.date));
});

test('전체 연도는 충분해도 화면별 제약으로 중복이 불가피하면 메타데이터로 알린다', () => {
  const plan = planPeriods([history([2010]), history([2010]), history([2011, 2020]), history([2012, 2025])]);
  assert.equal(plan.totalYears, 5);
  assert.equal(plan.distinctYears, 3);
  assert.deepEqual(chosenYears(plan), [2010, 2010, 2020, 2025]);
  assert.deepEqual(plan.duplicateYears, [{ year: 2010, indices: [0, 1] }]);
});

test('연도가 부족하면 범위를 유지하며 필요한 화면만 연도를 중복한다', () => {
  const list = history([2010, 2025]);
  const plan = planPeriods(Array(4).fill(list));
  assert.deepEqual(chosenYears(plan), [2010, 2010, 2025, 2025]);
  assert.equal(plan.distinctYears, 2);
  assert.equal(plan.duplicateYears.length, 2);
});

test('촬영일이 하나뿐이면 이를 실제 촬영일로 유지하고 연도 중복을 알린다', () => {
  const plan = planPeriods(Array(4).fill([{ panoId: '22', date: '2025년 3월' }]));
  assert.deepEqual(chosenYears(plan), [2025, 2025, 2025, 2025]);
  assert.deepEqual(plan.duplicateYears, [{ year: 2025, indices: [0, 1, 2, 3] }]);
  assert(plan.selections.every(item => item.panoId === '22' && item.date === '2025.03'));
});

test('빈 목록과 누락된 목록은 화면 번호를 보존하여 반환한다', () => {
  const lists = [history([2010, 2025]), undefined, [], history([2010, 2025])];
  const plan = planPeriods(lists);
  assert.deepEqual(plan.unavailable, [1, 2]);
  assert.deepEqual(plan.selections.map(item => item.index), [0, 3]);
  assert.deepEqual(chosenYears(plan), [2010, 2025]);
  const sparse = Array(2); sparse[1] = history([2025]);
  assert.deepEqual(planPeriods(sparse).unavailable, [0]);
  assert.deepEqual(planPeriods(), { selections: [], distinctYears: 0, totalYears: 0, unavailable: [], duplicateYears: [], chronological: true });
});

test('잘못된 날짜와 식별자, 서로 모순되는 중복 ID를 자동 선택하지 않는다', () => {
  const list = [{ panoId: '0', date: '2010.01' }, { panoId: 'x', date: '2010.01' }, { panoId: '4', date: '2020.13' }, { panoId: '5', date: '2020.00' }, { panoId: '6', date: '2020.1 garbage' }, { panoId: '7', date: '2010.01' }, { panoId: '7', date: '2020.01' }, { panoId: '8', date: '2021.07' }, { panoId: '8', date: '2021.07' }, { panoId: 9, date: '2025/3' }];
  const plan = planPeriods([list, list]);
  assert.deepEqual(chosenYears(plan), [2021, 2025]);
  assert.deepEqual(plan.selections.map(item => item.panoId), ['8', '9']);
  assert.equal(plan.totalYears, 2);
});

test('다른 연도 선택과 시간순 배치를 함께 만족할 수 없을 때 실제 다른 연도를 우선한다', () => {
  const plan = planPeriods([history([2025]), history([2010])]);
  assert.deepEqual(chosenYears(plan), [2025, 2010]);
  assert.equal(plan.distinctYears, 2);
  assert.equal(plan.chronological, false);
  assert.deepEqual(plan.duplicateYears, []);
});

test('연도 범위가 넓어도 같은 입력은 순서와 무관하게 같은 결과를 낸다', () => {
  const list = history(Array.from({ length: 100 }, (_, index) => 2000 + index));
  const plan = planPeriods(Array(4).fill(list));
  assert.deepEqual(chosenYears(plan), [2000, 2033, 2066, 2099]);
  assert.deepEqual(planPeriods(Array(4).fill(list.toReversed())), plan);
});
