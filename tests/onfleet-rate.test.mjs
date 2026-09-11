import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnfleetRequest,retryDelay,readPages,getOnfleet} from '../lib/onfleet.mjs';
const ok=(value={tasks:[]},headers={})=>new Response(JSON.stringify(value),{status:200,headers});
const limited=(headers={})=>new Response(JSON.stringify({message:{cause:'Slow down',request:'test-request'}}),{status:429,headers});
function client(){let now=100000;const waits=[];const request=createOnfleetRequest({clock:()=>now,sleep:async ms=>{waits.push(ms);now+=ms;},random:()=>0});return {request,waits,now:()=>now,advance:ms=>{now+=ms;}};}
test('parallel transport callers are serial and spaced; missing quota header does not pause a full second',async()=>{
 const c=client(),starts=[];let busy=0,max=0;
 const fetcher=async()=>{starts.push(c.now());busy++;max=Math.max(max,busy);await Promise.resolve();busy--;return ok();};
 await Promise.all(Array.from({length:5},()=>c.request('/workers',{fetcher,key:'test'})));
 assert.equal(max,1);assert.deepEqual(starts,[100000,100400,100800,101200,101600]);
});
test('429 retries only after Retry-After and returns successful data',async()=>{
 const c=client(),starts=[];let calls=0;
 const fetcher=async()=>{starts.push(c.now());return ++calls===1?limited({'Retry-After':'2'}):ok({tasks:[{id:'x'}]});};
 const result=await c.request('/tasks/all',{fetcher,key:'test'});
 assert.equal(calls,2);assert.ok(starts[1]-starts[0]>=2000);assert.equal(result.tasks[0].id,'x');
});
test('Retry-After supports dates and rejects invalid values',()=>{
 const now=Date.parse('2026-09-11T13:00:00Z');
 assert.equal(retryDelay('Fri, 11 Sep 2026 13:00:05 GMT',now),5000);
 assert.equal(retryDelay('garbage',now),2000);assert.equal(retryDelay(null,now),2000);
});
test('long Retry-After returns immediately with retry metadata, not a long sleeping function',async()=>{
 const c=client();let calls=0;
 await assert.rejects(c.request('/workers',{key:'test',fetcher:async()=>{calls++;return limited({'Retry-After':'120'});}}),e=>e.status===429&&e.retryAfterMs>=120000);
 assert.equal(calls,1);assert.deepEqual(c.waits,[]);
});
test('exhausted retries open cooldown and do not hammer provider for each driver',async()=>{
 const c=client();let calls=0;const fetcher=async()=>{calls++;return limited();};
 await assert.rejects(c.request('/workers',{fetcher,key:'test'}),e=>e.status===429);
 await assert.rejects(c.request('/tasks/second',{fetcher,key:'test'}),e=>e.status===429&&e.retryAfterMs>=15000);
 assert.equal(calls,2);
 c.advance(16000);assert.deepEqual(await c.request('/workers',{key:'test',fetcher:async()=>ok([])}),[]);
});
test('quota remaining is obeyed when actually present',async()=>{
 const c=client(),starts=[];const fetcher=async()=>{starts.push(c.now());return ok({}, {'X-RateLimit-Remaining':'1'});};
 await c.request('/a',{fetcher,key:'test'});await c.request('/b',{fetcher,key:'test'});
 assert.ok(starts[1]-starts[0]>=1100);
});
test('invalid authentication is not retried and queue recovers',async()=>{
 const c=client();let calls=0;
 await assert.rejects(c.request('/workers',{key:'test',fetcher:async()=>{calls++;return new Response('{}',{status:401});}}),e=>e.status===401);
 assert.equal(calls,1);assert.deepEqual(await c.request('/workers',{key:'test',fetcher:async()=>ok([])}),[]);
});
test('provider error does not echo key',async()=>{
 const c=client();await assert.rejects(c.request('/workers',{key:'test-secret',fetcher:async()=>new Response(JSON.stringify({message:'bad test-secret'}),{status:400})}),e=>!e.message.includes('test-secret')&&e.message.includes('[redacted]'));
});
test('pagination retains known data on 429 without claiming completeness',async()=>{
 let calls=0;const result=await readPages({from:'1'},async()=>{if(++calls===1)return {tasks:[{id:'known'}],lastId:'next'};const e=new Error('Rate limited');e.status=429;e.retryAfterMs=15000;throw e;});
 assert.equal(result.tasks.length,1);assert.equal(result.complete,false);assert.equal(result.retryAfterMs,15000);
});
test('completed scan failure cannot erase active deliveries',async()=>{
 const now=Date.parse('2026-09-11T13:00:00Z');
 const result=await getOnfleet('2026-09-11',{now,useCache:false,request:async path=>{
  if(path==='/workers')return [];
  if(new URL('https://test'+path).searchParams.get('state')==='3'){const e=new Error('Rate limited');e.status=429;throw e;}
  return {tasks:[{id:'active',state:2}]};
 }});
 assert.equal(result.tasks[0].id,'active');assert.equal(result.complete,false);
});
test('Today/Tomorrow/Today concurrent scans reuse same-date work',async()=>{
 const now=Date.parse('2026-09-11T13:00:00Z');let workers=0;
 const request=async path=>{await Promise.resolve();if(path==='/workers'){workers++;return [];}return {tasks:[]};};
 const [a,b,c]=await Promise.all([getOnfleet('2026-09-11',{now,request}),getOnfleet('2026-09-12',{now,request}),getOnfleet('2026-09-11',{now,request})]);
 assert.equal(workers,2);assert.strictEqual(a,c);assert.notStrictEqual(a,b);
});
