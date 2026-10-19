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

export function createBrowserApi() {
  return {
    desktop: false,
    layout: async () => {},
    move: async point => point,
    setLink: async ({url}) => kakaoUrl(url),
    async search(query) {
      const response = await fetch('/api/search?q=' + encodeURIComponent(query), { signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '검색에 연결하지 못했습니다. 좌표 또는 지도 링크로 이동해 주세요.');
      return result;
    },
    async openExternal(value) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !['map.kakao.com', 'kko.to', 'map.naver.com', 'www.google.com', 'developers.kakao.com'].includes(url.hostname)) throw new Error('허용되지 않는 링크입니다.');
      window.open(url.href, '_blank', 'noopener,noreferrer');
    },
    copy: text => navigator.clipboard.writeText(text),
    settings: async () => ({ hasKey: false, encryption: false }),
  };
}
