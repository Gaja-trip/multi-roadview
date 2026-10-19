const { test } = require('node:test');
const assert = require('node:assert/strict');
const { coordinates, kakaoUrl, roadviewUrl, externalUrl, bounds, paneIndex, localSearch } = require('../electron/domain.cjs');

test('실제 이동 좌표의 범위와 빈 값을 검증한다', () => {
  assert.deepEqual(coordinates({ lat: '37.5665', lng: '126.978' }), { lat: 37.5665, lng: 126.978 });
  assert.deepEqual(coordinates({ lat: 0, lng: 0 }), { lat: 0, lng: 0 });
  for (const input of [{ lat: '', lng: 127 }, { lat: null, lng: 127 }, { lat: '서울', lng: 127 }, { lat: 91, lng: 127 }, { lat: 37, lng: 181 }, { lat: NaN, lng: 0 }, { lat: 0, lng: Infinity }]) assert.throws(() => coordinates(input));
  assert.equal(roadviewUrl({ lat: 37.5665, lng: 126.978 }), 'https://map.kakao.com/link/roadview/37.5665,126.978');
});

test('외부 페이지와 지도 링크는 명시된 HTTPS 호스트만 허용한다', () => {
  assert.equal(kakaoUrl('https://kko.to/example'), 'https://kko.to/example');
  assert.equal(kakaoUrl('https://map.kakao.com/?panoid=123'), 'https://map.kakao.com/?panoid=123');
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows/', 'http://map.kakao.com/', 'https://map.kakao.com.evil.test/', 'https://map.kakao.com@evil.test/', 'https://x:password@map.kakao.com/', 'https://map.kakao.com:444/', 'https://naver.com/']) assert.throws(() => kakaoUrl(url));
  assert.equal(externalUrl('https://www.google.com/maps/@?api=1'), 'https://www.google.com/maps/@?api=1');
  assert.throws(() => externalUrl('https://unknown.example/'));
});

test('원격 화면 영역은 앱 창 안으로 제한한다', () => {
  const size = { width: 1000, height: 700 };
  assert.deepEqual(bounds({ x: -20, y: 100, width: 2000, height: 900 }, size), { x: 0, y: 100, width: 1000, height: 600 });
  assert.equal(bounds({ x: NaN, y: 0, width: 10, height: 10 }, size), null);
  assert.equal(bounds({ x: 1200, y: 0, width: 10, height: 10 }, size), null);
  assert.equal(bounds({ x: 0, y: 0, width: -1, height: 10 }, size), null);
  assert.equal(paneIndex(3), 3);
  for (const index of [-1, 4, 1.5, '1', null]) assert.throws(() => paneIndex(index));
});

test('검색의 빠른 위치는 공백과 장소명·주소를 처리한다', () => {
  assert.equal(localSearch('서울 시청')[0].name, '서울시청');
  assert.equal(localSearch('세종대로 110')[0].name, '서울시청');
  assert.equal(localSearch('부산역')[0].lng, 129.0395);
  assert.equal(localSearch('없는주소가나다').length, 0);
});
