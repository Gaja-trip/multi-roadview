const { localSearch, coordinates } = require('../electron/domain.cjs');

// The REST key stays on the server and is never included in the web build.
function createHandler({ fetcher = fetch, key = () => process.env.KAKAO_REST_API_KEY || '', now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const cache = new Map(); let queue = Promise.resolve(), lastRequest = 0;
  async function search(query) {
    const apiKey = key().trim(), source = apiKey ? 'kakao' : 'osm', cacheKey = `${source}:${query}`;
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.time < 3600000) return cached.result;
    const presets = localSearch(query);
    if (!apiKey && presets.length) return { places: presets, source: 'preset' };
    const job = queue.then(async () => {
      const hit = cache.get(cacheKey);
      if (hit && now() - hit.time < 3600000) return hit.result;
      await wait(Math.max(0, 1100 - (now() - lastRequest))); lastRequest = now();
      const headers = apiKey ? { Authorization: `KakaoAK ${apiKey}` } : { 'User-Agent': 'RoadviewTime/1.1 (manual address search; https://multi-roadview.vercel.app)', 'Accept-Language': 'ko' };
      const request = async url => {
        const response = await fetcher(url, { headers, signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(apiKey ? '카카오 검색 설정을 확인해 주세요. 좌표 또는 지도 링크로도 이동할 수 있습니다.' : '주소 검색에 연결하지 못했습니다. 좌표 또는 지도 링크로 이동해 주세요.');
        return response.json();
      };
      let places;
      if (apiKey) {
        let data = await request(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`);
        if (!data.documents?.length) data = await request(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=6`);
        places = (data.documents || []).slice(0, 6).map(item => ({ name: item.place_name || item.road_address?.building_name || item.address_name, address: item.road_address_name || item.road_address?.address_name || item.address_name, lat: item.y, lng: item.x }));
      } else {
        const data = await request(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(query)}`);
        places = data.slice(0, 6).map(item => ({ name: item.name || item.display_name?.split(',')[0] || query, address: item.display_name || '', lat: item.lat, lng: item.lon }));
      }
      places = places.flatMap(place => { try { return [{ ...place, ...coordinates(place) }]; } catch { return []; } });
      const result = { places, source }; if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { time: now(), result }); return result;
    });
    queue = job.catch(() => {}); return job;
  }
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, result) => { res.statusCode = status; res.end(JSON.stringify(result)); };
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(405, { error: 'GET 요청만 사용할 수 있습니다.' }); }
    const query = new URL(req.url, 'https://localhost').searchParams.get('q')?.trim() || '';
    if (query.length < 2 || query.length > 200) return send(400, { error: '검색어를 2~200자로 입력해 주세요.' });
    try { const result = await search(query); res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400'); send(200, result); }
    catch (error) { send(502, { error: error.name === 'TimeoutError' ? '검색 응답이 늦습니다. 잠시 후 다시 시도하거나 좌표로 이동해 주세요.' : error.message }); }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
