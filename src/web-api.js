export function kakaoUrl(value) {
  const url = new URL(String(value).trim());
  if (url.protocol !== 'https:' || !['map.kakao.com', 'kko.to'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('카카오맵 HTTPS 공유 링크를 입력해 주세요.');
  return url.href;
}

export function createRoadviewFrame(url, title) {
  const frame = document.createElement('iframe');
  frame.className = 'roadview-frame'; frame.title = title;
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  frame.setAttribute('allow', 'fullscreen'); frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.src = kakaoUrl(url);
  return frame;
}

// Keep each source mounted: switching layouts must preserve its chosen date.
export function createBrowserApi(initialUrl) {
  const urls = Array(4).fill(initialUrl), frames = new Map(), listeners = new Set();
  const states = Array.from({ length: 4 }, (_, index) => ({ index, status: 'idle', url: initialUrl }));
  const emit = (index, state) => { states[index] = { ...states[index], ...state }; listeners.forEach(listener => listener(states[index])); };
  const navigate = (index, url) => {
    urls[index] = kakaoUrl(url); emit(index, { status: 'loading', url: urls[index], date: '', error: '' });
    const frame = frames.get(index); if (frame) frame.src = urls[index];
  };
  return {
    desktop: false,
    async layout(rects) {
      for (const { index } of rects) {
        if (frames.has(index)) continue;
        const frame = createRoadviewFrame(urls[index], `${index + 1}번 카카오맵 로드뷰`);
        frame.addEventListener('load', () => emit(index, { status: 'connected' }));
        frame.addEventListener('error', () => emit(index, { status: 'error', error: '원본 열기로 연결 상태를 확인해 주세요.' }));
        frames.set(index, frame); document.querySelector(`#surface-${index}`).append(frame);
        emit(index, { status: 'loading' });
      }
    },
    async move(point) {
      const url = `https://map.kakao.com/link/roadview/${point.lat},${point.lng}`;
      urls.forEach((_, index) => navigate(index, url)); return point;
    },
    async search(query) {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '검색에 연결하지 못했습니다. 좌표 또는 지도 링크로 이동해 주세요.');
      return result;
    },
    async reload(index) { navigate(index, urls[index]); },
    async setLink({ url, index }) {
      const valid = kakaoUrl(url);
      (index === 'all' ? [0, 1, 2, 3] : [index]).forEach(i => navigate(i, valid)); return valid;
    },
    async openExternal(value) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || !['map.kakao.com', 'kko.to', 'map.naver.com', 'www.google.com', 'developers.kakao.com'].includes(url.hostname)) throw new Error('허용되지 않는 링크입니다.');
      window.open(url.href, '_blank', 'noopener,noreferrer');
    },
    copy: text => navigator.clipboard.writeText(text),
    settings: async () => ({ hasKey: false, encryption: false }),
    onPane(listener) { listeners.add(listener); states.forEach(listener); return () => listeners.delete(listener); },
  };
}
