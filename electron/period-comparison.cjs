const { planPeriods } = require('./period-plan.cjs');
const { openHistory, selectDate, readVisibleDate } = require('./frame-history.cjs');

async function arrangePeriods({ versions }, { getPane, sendPane }) {
  if (!Array.isArray(versions) || ![2, 4].includes(versions.length) || versions.some(version => typeof version !== 'string')) throw new Error('비교할 화면 정보가 올바르지 않습니다.');
  const panes = versions.map((version, index) => {
    const pane = getPane(index);
    if (pane.version !== version || pane.selecting) throw new Error('화면을 연결하거나 촬영일을 변경하고 있습니다. 잠시 후 다시 선택해 주세요.');
    return pane;
  });
  const snapshots = panes.map(pane => ({ frame: pane.frame, generation: pane.generation, version: pane.version }));
  const current = index => {
    const pane = getPane(index), snapshot = snapshots[index];
    if (pane !== panes[index] || pane.frame !== snapshot.frame || pane.generation !== snapshot.generation || pane.version !== snapshot.version) throw new Error('비교 위치가 바뀌었습니다. 현재 위치의 촬영일을 다시 불러와 주세요.');
    return pane;
  };
  // Lock every participating pane before the first asynchronous operation.
  // A manual date selection or the camera synchronizer must not interleave.
  panes.forEach(pane => { pane.selecting = true; });
  try {
    const lists = await Promise.allSettled(panes.map(async (pane, index) => {
      const date = await readVisibleDate(pane.frame);
      current(index);
      pane.state.date = date;
      return openHistory(pane);
    }));
    snapshots.forEach((_, index) => current(index));
    const plan = planPeriods(lists.map(result => result.status === 'fulfilled' ? result.value : []));
    const errors = lists.flatMap((result, index) => result.status === 'rejected' ? [{ index, error: result.reason?.message || '촬영일 목록을 불러오지 못했습니다.' }] : []);
    const selections = [];
    for (const selection of plan.selections) {
      current(selection.index);
      try {
        const date = await selectDate(panes[selection.index], selection.panoId);
        current(selection.index);
        sendPane(selection.index, { date });
        selections.push({ ...selection, date, version: versions[selection.index] });
      } catch (error) {
        current(selection.index);
        errors.push({ index: selection.index, error: error.message });
      }
    }
    return { ...plan, selections, errors, distinctYears: new Set(selections.map(selection => selection.year)).size };
  } finally { panes.forEach(pane => { pane.selecting = false; }); }
}

module.exports = { arrangePeriods };
