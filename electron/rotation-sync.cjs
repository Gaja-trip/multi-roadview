const LETTERS = ['A', 'B', 'C', 'D'];
const normalize = value => ((value % 360) + 360) % 360;
const angularDistance = (first, second) => Math.abs(((first - second + 540) % 360 + 360) % 360 - 180);

function aligned(current, target) {
  return angularDistance(current.pan, target.pan) <= 1 &&
    Math.abs(current.tilt - target.tilt) <= 1 && Math.abs(current.zoom - target.zoom) <= 0.01;
}

function available(snapshot) {
  return snapshot?.available === true && typeof snapshot.version === 'string' && snapshot.version.length > 0 &&
    [snapshot.pan, snapshot.tilt, snapshot.zoom].every(Number.isFinite);
}

function createRotationSync({ read, apply, onState = () => {}, now = Date.now }) {
  if (typeof read !== 'function' || typeof apply !== 'function') throw new TypeError('read와 apply 함수가 필요합니다.');
  let enabled = true, count = 2, epoch = 0, leader = null, running = null, queued = false;
  let state = { enabled, count, ready: 0, leader, synchronized: false, error: '', checkedAt: now() };
  let delivered = '';

  function publish(changes) {
    state = { ...state, ...changes, enabled, count, checkedAt: now() };
    // The scheduler can run frequently; notify the renderer only for meaningful changes.
    const signature = JSON.stringify({ ...state, checkedAt: undefined });
    if (signature !== delivered) {
      delivered = signature;
      try { onState({ ...state }); } catch { /* A renderer listener must not stop synchronization. */ }
    }
    return { ...state };
  }

  function configure(value = {}) {
    const nextEnabled = value.enabled === undefined ? enabled : value.enabled;
    const nextCount = value.count === undefined ? count : value.count;
    if (typeof nextEnabled !== 'boolean' || ![2, 4].includes(nextCount)) throw new TypeError('enabled는 boolean, count는 2 또는 4여야 합니다.');
    if (enabled === nextEnabled && count === nextCount) return { ...state };
    const resized = count !== nextCount;
    enabled = nextEnabled; count = nextCount; epoch++;
    if (leader !== null && leader >= count) leader = null;
    return publish({ ready: resized ? 0 : state.ready, leader, synchronized: false, error: '' });
  }

  async function cycle() {
    const currentEpoch = epoch, currentCount = count;
    if (!enabled) return publish({ synchronized: false, error: '' });
    const results = await Promise.allSettled(Array.from({ length: currentCount }, (_, index) => Promise.resolve().then(() => read(index))));
    if (epoch !== currentEpoch || !enabled) return { ...state };
    const snapshots = results.map(result => result.status === 'fulfilled' && available(result.value) ? result.value : null);
    const ready = snapshots.filter(Boolean).length;
    const errors = results.flatMap((result, index) => result.status === 'rejected' ? [`화면 ${LETTERS[index]} 방향 확인 실패: ${result.reason?.message || String(result.reason)}`] : []);
    const candidates = snapshots.map((snapshot, index) => ({ snapshot, index })).filter(item => item.snapshot);
    if (!candidates.length) {
      leader = null;
      return publish({ ready, leader, synchronized: false, error: errors[0] || '로드뷰 연결을 기다리는 중입니다.' });
    }

    // Heading changes alone never elect a source. Only trusted input revisions
    // supplied by the frame adapter can make a follower become the leader.
    const activity = snapshot => Number.isFinite(snapshot.userAt) ? snapshot.userAt : 0;
    const sequence = snapshot => Number.isFinite(snapshot.userSequence) ? snapshot.userSequence : 0;
    candidates.sort((first, second) => activity(second.snapshot) - activity(first.snapshot) ||
      sequence(second.snapshot) - sequence(first.snapshot) || (first.index === leader ? -1 : second.index === leader ? 1 : first.index - second.index));
    leader = candidates[0].index;
    const source = snapshots[leader];
    let confirmed = true;
    for (let index = 0; index < currentCount; index++) {
      if (epoch !== currentEpoch || !enabled) return { ...state };
      const snapshot = snapshots[index];
      if (!snapshot || index === leader) continue;
      // Year-to-year comparison keeps every panorama on the same absolute camera.
      const target = { pan: normalize(source.pan), tilt: source.tilt, zoom: source.zoom };
      if (aligned(snapshot, target)) continue;
      try {
        const result = await apply(index, target, snapshot);
        if (epoch !== currentEpoch || !enabled) return { ...state };
        const changedVersion = result?.version !== undefined && result.version !== snapshot.version;
        const changedInput = (Number.isFinite(result?.userAt) && result.userAt > activity(snapshot)) ||
          (Number.isFinite(result?.userSequence) && result.userSequence !== sequence(snapshot));
        const numericResult = result && [result.pan, result.tilt, result.zoom].every(Number.isFinite);
        const rejected = result?.applied === false || result?.ok === false;
        const verified = !rejected && (numericResult ? aligned(result, target) : result === true || result?.ok === true || result?.applied === true);
        if (changedVersion || changedInput || !verified) {
          confirmed = false;
          errors.push(`화면 ${LETTERS[index]} 회전 결과를 확인하지 못했습니다.${result?.error ? ` ${result.error}` : ''}`);
        }
      } catch (error) {
        if (epoch !== currentEpoch || !enabled) return { ...state };
        confirmed = false;
        errors.push(`화면 ${LETTERS[index]} 회전 실패: ${error?.message || String(error)}`);
      }
    }
    if (ready < currentCount && !errors.length) errors.push(`로드뷰 연결을 기다리는 중입니다. (${ready}/${currentCount})`);
    return publish({ ready, leader, synchronized: ready === currentCount && confirmed && errors.length === 0, error: errors[0] || '' });
  }

  function tick() {
    if (running) { queued = true; return running; }
    running = (async () => {
      do { queued = false; await cycle(); } while (queued);
      return { ...state };
    })().finally(() => { running = null; });
    return running;
  }

  return { configure, tick, getState: () => ({ ...state }) };
}

module.exports = { createRotationSync, normalize, angularDistance };
