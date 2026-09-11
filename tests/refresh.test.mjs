import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const full=await readFile(new URL('../app.js',import.meta.url),'utf8');
// No browser/server/network dependency: execute the real controller with DOM doubles.
const source=full.slice(0,full.lastIndexOf('try{const session='));
function screen(fetcher){
 let now=Date.parse('2026-09-11T13:00:00Z');const elements=new Map(),timers=new Map();let timerId=0;
 class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const element=id=>{if(!elements.has(id)){const classes=new Set();elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,dataset:{},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,b){if(b)classes.add(c);else classes.delete(c);}},addEventListener(){}});}return elements.get(id);};
 const context=vm.createContext({Date:Clock,Intl,URLSearchParams,URL,AbortController,console,fetch:fetcher,navigator:{},window:{},location:{search:''},document:{hidden:false,getElementById:element,querySelectorAll:()=>[],addEventListener(){}},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),setInterval(){},atob,Uint8Array});
 vm.runInContext(source,context);
 return {run:s=>vm.runInContext(s,context),element,advance:ms=>{now+=ms;},timers};
}
const snapshot=()=>({version:'1.2.0',complete:true,checkedAt:Date.parse('2026-09-11T13:00:00Z'),sources:{onfleet:{checkedAt:Date.parse('2026-09-11T12:59:00Z')}},summary:{movingOnTime:1},drivers:[],tasks:[],issues:[],warnings:[],sheet:{connected:false,rows:[]}});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('same-date force Refresh cannot overlap requests or bypass cooldown',async()=>{
 let resolve,calls=0;const ui=screen(()=>{calls++;return new Promise(r=>{resolve=r;});});
 const first=ui.run('load({force:true})');await ui.run('load({force:true})');assert.equal(calls,1);
 resolve(response(snapshot()));await first;
 await ui.run('load({force:true})');assert.equal(calls,1);assert.equal(ui.element('refreshBtn').disabled,true);
});
test('switching day during a request loads final selected day immediately after completion',async()=>{
 const pending=[],paths=[];const ui=screen(path=>{paths.push(path);return new Promise(r=>pending.push(r));});
 const first=ui.run('load({force:true})');ui.run("setDate('2026-09-12')");
 pending[0](response(snapshot()));await first;await tick();
 assert.equal(paths.length,2);assert.match(paths[1],/date=2026-09-12/);
 pending[1](response(snapshot()));await tick();assert.equal(ui.run('selected'),'2026-09-12');
});
test('429 metadata stops manual and automatic retries until cooldown expires',async()=>{
 let calls=0;const ui=screen(async()=>{calls++;return calls===1?response({error:'Rate limited',retryAfterSeconds:20},429):response(snapshot());});
 await ui.run('load({force:true})');ui.advance(19000);await ui.run('load({force:true})');assert.equal(calls,1);
 ui.advance(1100);await ui.run('load({force:true})');assert.equal(calls,2);
});
test('failed refresh retains data but clearly labels its actual observation as old, not live',async()=>{
 let calls=0;const ui=screen(async()=>++calls===1?response(snapshot()):response({error:'Rate limited',retryAfterSeconds:20},429));
 await ui.run('load({force:true})');ui.advance(16000);await ui.run('load({force:true})');
 assert.equal(ui.run('data.summary.movingOnTime'),1);
 assert.match(ui.element('checkedAt').textContent,/OLD SNAPSHOT.*NOT LIVE/);
 assert.match(ui.element('globalError').textContent,/current on-time status is not verified/);
});
