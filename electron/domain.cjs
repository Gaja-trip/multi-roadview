const PRESETS = [
  { name: '서울시청', address: '서울특별시 중구 세종대로 110', lat: 37.56650, lng: 126.97800 },
  { name: '광화문', address: '서울특별시 종로구 사직로 161', lat: 37.57590, lng: 126.97680 },
  { name: '강남역', address: '서울특별시 강남구 강남대로 396', lat: 37.49795, lng: 127.02762 },
  { name: '부산역', address: '부산광역시 동구 중앙대로 206', lat: 35.11499, lng: 129.03950 },
  { name: '제주공항', address: '제주특별자치도 제주시 공항로 2', lat: 33.50670, lng: 126.49300 },
];
const DEMO = { name: '청주 분평동', address: '충청북도 청주시 서원구 분평동', lat: 36.6087352, lng: 127.4897056, url: 'https://map.kakao.com/link/roadview/36.6087352,127.4897056' };

function coordinates(value) {
  if (!value || value.lat === '' || value.lng === '' || value.lat == null || value.lng == null) {
    throw new Error('위도와 경도를 모두 입력해 주세요.');
  }
  const lat = Number(value.lat), lng = Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('위도는 -90~90, 경도는 -180~180 범위의 숫자를 입력해 주세요.');
  }
  return { lat, lng };
}

function roadviewUrl(value) {
  const { lat, lng } = coordinates(value);
  return `https://map.kakao.com/link/roadview/${lat},${lng}`;
}

function kakaoUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('올바른 카카오맵 링크를 입력해 주세요.'); }
  if (url.protocol !== 'https:' || !['map.kakao.com', 'kko.to'].includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error('https://map.kakao.com 또는 https://kko.to 링크만 사용할 수 있습니다.');
  }
  return url.href;
}

function externalUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' || url.username || url.password || url.port || ![
    'map.kakao.com', 'kko.to', 'map.naver.com', 'www.google.com',
    'developers.kakao.com', 'apis.map.kakao.com', 'www.openstreetmap.org',
  ].includes(url.hostname)) throw new Error('허용되지 않는 링크입니다.');
  return url.href;
}

function paneIndex(value) {
  if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error('화면 번호가 올바르지 않습니다.');
  return value;
}

function bounds(value, size) {
  if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite)) return null;
  const x = Math.min(size.width, Math.max(0, Math.round(value.x)));
  const y = Math.min(size.height, Math.max(0, Math.round(value.y)));
  const width = Math.min(Math.max(0, Math.round(value.width)), size.width - x);
  const height = Math.min(Math.max(0, Math.round(value.height)), size.height - y);
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function localSearch(query) {
  const normalized = query.replace(/\s/g, '').toLowerCase();
  return PRESETS.filter(place => [place.name, place.address].some(text => text.replace(/\s/g, '').toLowerCase().includes(normalized)));
}

module.exports = { PRESETS, DEMO, coordinates, roadviewUrl, kakaoUrl, externalUrl, paneIndex, bounds, localSearch };
