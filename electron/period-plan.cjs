// Plans only from dates offered by each original Roadview. This module never
// invents a panorama ID or treats a historical ID as a live-view URL.
function compareIds(left, right) {
  const a = left.replace(/^0+/, ''), b = right.replace(/^0+/, '');
  return a.length - b.length || a.localeCompare(b) || left.localeCompare(right);
}

function normalizeHistory(history, index) {
  const byId = new Map(), conflicts = new Set();
  for (const item of Array.isArray(history) ? history : []) {
    const panoId = typeof item?.panoId === 'string' ? item.panoId :
      Number.isSafeInteger(item?.panoId) && item.panoId > 0 ? String(item.panoId) : '';
    if (!/^\d+$/.test(panoId) || !/[1-9]/.test(panoId)) continue;
    const match = typeof item.date === 'string' && item.date.match(/^\s*(20\d{2})\s*[.년/-]\s*(0?[1-9]|1[0-2])\s*월?\s*$/);
    if (!match) continue;
    const date = `${match[1]}.${match[2].padStart(2, '0')}`;
    const previous = byId.get(panoId);
    // An ID with contradictory dates is not reliable enough to auto-select.
    if (previous && previous.date !== date) conflicts.add(panoId);
    else byId.set(panoId, { index, panoId, date, year: Number(match[1]) });
  }
  const byYear = new Map();
  for (const item of byId.values()) {
    if (conflicts.has(item.panoId)) continue;
    const previous = byYear.get(item.year);
    if (!previous || item.date > previous.date || item.date === previous.date && compareIds(item.panoId, previous.panoId) < 0) byYear.set(item.year, item);
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

function maximumDistinctYears(panes) {
  const owners = new Map();
  function assign(index, seen) {
    for (const item of panes[index]) {
      if (seen.has(item.year)) continue;
      seen.add(item.year);
      const owner = owners.get(item.year);
      if (owner === undefined || assign(owner, seen)) { owners.set(item.year, index); return true; }
    }
    return false;
  }
  for (let index = 0; index < panes.length; index++) assign(index, new Set());
  return owners.size;
}

function comparePaths(left, right) {
  for (let index = 0; index < left.length; index++) {
    const difference = left[index].year - right[index].year || compareIds(left[index].panoId, right[index].panoId);
    if (difference) return difference;
  }
  return 0;
}

function chronologicalPlan(panes, distinct, targets) {
  let states = new Map([['start', { path: [], first: null, last: null, distinct: 0, cost: 0 }]]);
  for (let index = 0; index < panes.length; index++) {
    const next = new Map();
    for (const state of states.values()) for (const item of panes[index]) {
      if (state.last !== null && item.year < state.last) continue;
      const unique = state.distinct + Number(state.last !== item.year);
      if (unique > distinct || unique + panes.length - index - 1 < distinct) continue;
      const first = state.first ?? item.year;
      const candidate = { path: [...state.path, item], first, last: item.year, distinct: unique, cost: state.cost + (item.year - targets[index]) ** 2 };
      const key = `${first}:${item.year}:${unique}`, previous = next.get(key);
      if (!previous || candidate.cost < previous.cost || candidate.cost === previous.cost && comparePaths(candidate.path, previous.path) < 0) next.set(key, candidate);
    }
    states = next;
  }
  let best = null;
  for (const state of states.values()) {
    if (state.distinct !== distinct) continue;
    const span = state.last - state.first, previousSpan = best ? best.last - best.first : -1;
    if (!best || span > previousSpan || span === previousSpan && (state.cost < best.cost || state.cost === best.cost && comparePaths(state.path, best.path) < 0)) best = state;
  }
  return best?.path;
}

function unorderedPlan(panes, distinct, targets) {
  // Different locations may offer incompatible chronological lists. Preserve
  // the maximum possible number of real years, then minimize order inversions.
  const choices = panes.map((items, index) => [...items].sort((a, b) => Math.abs(a.year - targets[index]) - Math.abs(b.year - targets[index]) || a.year - b.year));
  const path = [], years = new Set();
  let best = null;
  function visit(index, inversions, minimum, maximum, cost) {
    if (years.size + panes.length - index < distinct || best && inversions > best.inversions) return;
    if (index === panes.length) {
      if (years.size !== distinct) return;
      const span = maximum - minimum;
      if (!best || inversions < best.inversions || inversions === best.inversions && (span > best.span || span === best.span && (cost < best.cost || cost === best.cost && comparePaths(path, best.path) < 0))) best = { path: [...path], inversions, span, cost };
      return;
    }
    for (const item of choices[index]) {
      const seen = years.has(item.year);
      if (years.size === distinct && !seen) continue;
      const nextInversions = inversions + path.filter(previous => previous.year > item.year).length;
      if (best && nextInversions > best.inversions) continue;
      path.push(item); years.add(item.year);
      visit(index + 1, nextInversions, Math.min(minimum, item.year), Math.max(maximum, item.year), cost + (item.year - targets[index]) ** 2);
      path.pop(); if (!seen) years.delete(item.year);
    }
  }
  visit(0, 0, Infinity, -Infinity, 0);
  return best?.path || [];
}

function planPeriods(histories) {
  const supplied = Array.isArray(histories) ? histories : [];
  if (supplied.length > 4) throw new RangeError('시기 자동 배치는 최대 4개 화면을 지원합니다.');
  const normalized = Array.from(supplied, normalizeHistory);
  const unavailable = normalized.flatMap((items, index) => items.length ? [] : [index]);
  const panes = normalized.filter(items => items.length);
  const allYears = [...new Set(panes.flatMap(items => items.map(item => item.year)))].sort((a, b) => a - b);
  const distinctYears = maximumDistinctYears(panes);
  const targets = panes.map((_, index) => allYears[0] + (allYears.at(-1) - allYears[0]) * (panes.length > 1 ? index / (panes.length - 1) : 1));
  const selections = chronologicalPlan(panes, distinctYears, targets) || unorderedPlan(panes, distinctYears, targets);
  const groups = new Map();
  for (const item of selections) {
    if (!groups.has(item.year)) groups.set(item.year, []);
    groups.get(item.year).push(item.index);
  }
  return {
    selections,
    distinctYears,
    totalYears: allYears.length,
    unavailable,
    duplicateYears: [...groups].filter(([, indices]) => indices.length > 1).map(([year, indices]) => ({ year, indices })),
    chronological: selections.every((item, index) => index === 0 || selections[index - 1].year <= item.year),
  };
}

module.exports = { planPeriods };
