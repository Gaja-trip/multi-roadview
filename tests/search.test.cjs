const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/search.js');
async function request(handler, url, method = 'GET') {
  const response = { headers: {}, setHeader(name,value) { this.headers[name]=value; }, end(body) { this.body=JSON.parse(body); } };
  await handler({method,url},response); return response;
}
test('웹 검색은 잘못된 입력과 메서드를 외부 요청 전에 거부한다', async () => {
  const handler=createHandler({fetcher:()=>{throw new Error('Must not fetch');},key:()=>''});
  assert.equal((await request(handler,'/api/search?q=a')).statusCode,400);
  assert.equal((await request(handler,'/api/search?q=서울시청','POST')).statusCode,405);
  const response=await request(handler,'/api/search?q=서울시청');
  assert.equal(response.statusCode,200); assert.equal(response.body.places[0].lat,37.5665);
});
test('카카오 검색은 주소가 없을 때 장소를 검색하고 서버 키를 응답에 넣지 않는다', async () => {
  const calls=[];
  const handler=createHandler({key:()=> 'test-server-key',wait:async()=>{},fetcher:async(url,options)=>{
    calls.push({url,options}); return {ok:true,json:async()=>({documents:url.includes('address.json')?[]:[{place_name:'테스트 장소',address_name:'테스트 주소',x:'127.1',y:'37.5'}]})};
  }});
  const result=await request(handler,'/api/search?q=테스트');
  assert.equal(result.statusCode,200); assert.equal(calls.length,2); assert.equal(result.body.places[0].lat,37.5);
  assert.equal(calls[1].options.headers.Authorization,'KakaoAK test-server-key');
  assert.equal(JSON.stringify(result.body).includes('test-server-key'),false);
  await request(handler,'/api/search?q=테스트'); assert.equal(calls.length,2);
});
test('검색 서비스 오류가 사용자에게 재시도 가능한 응답으로 전달된다',async()=>{
  const handler=createHandler({key:()=> 'test-server-key',wait:async()=>{},fetcher:async()=>({ok:false,status:401})});
  const result=await request(handler,'/api/search?q=테스트');
  assert.equal(result.statusCode,502); assert.match(result.body.error,/검색 설정/); assert.equal(JSON.stringify(result.body).includes('test-server-key'),false);
});
