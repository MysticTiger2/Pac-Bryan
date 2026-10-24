// Node.js + Playwright; Edge on Windows, Chromium elsewhere. See README.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'eviction.html'), 'utf8');
// Fixtures are injected in the test response, never into the shipped game.
const expose = `globalThis.evictionTest={start,update,draw,pause,capture,hurt,freeze,moveGhosts,canOccupy,greenPosition,turfDirection,chipTerritory,checkDanger,lineGeometry,updateBurns,igniteLine,pollGamepad,nextLevel,rebuildBoundary,targetPercent,awardScore,persist,STEP,
  state:()=>({state,time,best,buffered,input:[...input],world:{...world,grid:[...world.grid]}}),
  fixture:s=>{clearInput();if(s.world)Object.assign(world,s.world);if(s.grid)world.grid=Uint8Array.from(s.grid);
    if(s.safe)for(const [c,r] of s.safe)world.grid[index(c,r)]=SAFE;
    if(s.trail){world.burns=[];world.trail=s.trail.map(([c,r])=>index(c,r));for(const i of world.trail)world.grid[i]=TRAIL}
    if(s.player){const p=s.player;world.player={c:p.c,r:p.r,x:p.c+.5,y:p.r+.5,fromX:p.c+.5,fromY:p.r+.5,target:null,dir:'right',anchor:{c:0,r:14},...p}}
    if(s.ghosts)world.ghosts=s.ghosts.map((g,i)=>({kind:'roamer',vx:0,vy:0,id:i,color:g.kind==='edge'?'#ffad6b':g.kind==='turf'?'#63dce8':g.kind==='breaker'?'#f16657':g.kind==='charger'?'#bc94ed':g.kind==='plow'?'#75d58a':'#ed8ead',...(g.kind==='turf'?{c:Math.floor(g.x),r:Math.floor(g.y),target:null,dir:'left',speed:3.6}:{}),...(g.kind==='charger'?{speed:4.35,attackIn:99,warning:0,dash:0}:{}),...(g.kind==='plow'?{speed:3.3,turnIn:99}:{}),...g}));
    if(s.input)for(const [i,dir] of s.input.entries())setDirection('fixture:'+i,dir);if(s.state)state=s.state;rebuildBoundary();terrainDirty=true;sync()},
  advance:n=>{for(let i=0;i<Math.round(n/STEP);i++)update(STEP)},
  padRelease:()=>{padNeedsRelease=false;focused=true},
};\n`;
const marker = 'world={level:1,score:0,lives:3};loadLevel();status';
const instrumented = html.replace(marker, expose + marker).replaceAll('requestAnimationFrame(frame)', 'void 0');
let server, browser, origin;
before(async () => {
  assert(instrumented.includes('globalThis.evictionTest='));
  server = http.createServer((req,res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if(req.url==='/index.html')res.end(fs.readFileSync(path.join(root,'index.html')));
    else if(req.url==='/actual')res.end(html);
    else res.end(instrumented);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:process.platform==='win32'?{channel:'msedge'}:{})});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve))});
async function withPage(fn,options={}){const context=await browser.newContext({viewport:{width:1440,height:1000},...options}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));try{await page.goto(origin);await fn(page,context);assert.deepEqual(errors,[])}finally{await context.close()}}
const start=page=>page.locator('#play').click();
const state=page=>page.evaluate(()=>evictionTest.state());
const fixture=(page,s)=>page.evaluate(s=>evictionTest.fixture(s),s);
const advance=(page,n)=>page.evaluate(n=>evictionTest.advance(n),n);
async function move(page,key,seconds){await page.keyboard.down(key);await advance(page,seconds);await page.keyboard.up(key);await advance(page,.22)}
const interior=38*26;
const rowTrail=r=>Array.from({length:38},(_,i)=>[i+1,r]);
function onFrontier(g,grid){
  const safe=(c,r)=>c>=0&&c<40&&r>=0&&r<28?grid[r*40+c]===1:null;
  const different=(a,b)=>a!==null&&b!==null&&a!==b;
  if(Math.abs(g.x-Math.round(g.x))<1e-8){const c=Math.round(g.x);for(const r of [Math.floor(g.y),Math.ceil(g.y)-1])if(different(safe(c-1,r),safe(c,r)))return true}
  if(Math.abs(g.y-Math.round(g.y))<1e-8){const r=Math.round(g.y);for(const c of [Math.floor(g.x),Math.ceil(g.x)-1])if(different(safe(c,r-1),safe(c,r)))return true}
  return false;
}

test('arcade filters show three playable games and launch Eviction',async()=>withPage(async page=>{
  await page.goto(origin+'/index.html');assert.equal(await page.locator('#game-count').textContent(),'4 games · 3 ready');
  await page.getByRole('button',{name:'Ready to play'}).click();assert.equal(await page.locator('[data-status=ready]:visible').count(),3);
  await page.getByRole('button',{name:'Coming soon'}).click();assert.equal(await page.locator('[data-status=soon]:visible').count(),1);assert.equal(await page.locator('#game-count').textContent(),'1 game coming soon');
  await page.getByRole('button',{name:'Ready to play'}).click();await page.getByRole('link',{name:'Play Eviction'}).click();assert.equal(await page.title(),'Eviction · Tiger’s Arcade');
  await start(page);const s=await state(page);assert.equal(s.state,'playing');assert.deepEqual(s.world.ghosts.map(g=>g.kind),['roamer']);assert.equal(s.world.ghosts[0].color,'#ed8ead');assert.equal(s.world.lives,3);assert.equal(s.world.claimed,0);assert.equal(s.world.charges,0);assert.equal(s.world.nextFreeze,30);
  assert.equal(s.world.grid.filter(v=>v===1).length,40*28-interior);
}));

test('keyboard holds, buffered turns, release and boundaries stay aligned to cell centers',async()=>withPage(async page=>{
  await start(page);await fixture(page,{ghosts:[]});await move(page,'ArrowLeft',.3);assert.equal((await state(page)).world.player.c,0);
  await page.keyboard.down('ArrowRight');await advance(page,.12);await page.keyboard.down('ArrowUp');await advance(page,.15);await page.keyboard.up('ArrowUp');await page.keyboard.up('ArrowRight');await advance(page,.2);
  let s=await state(page);assert(s.world.player.c>=1);assert(s.world.player.r<14);assert.equal(s.world.player.target,null);assert.equal(s.world.player.x,s.world.player.c+.5);assert.equal(s.world.player.y,s.world.player.r+.5);
  const pos=[s.world.player.c,s.world.player.r];await advance(page,.5);s=await state(page);assert.deepEqual([s.world.player.c,s.world.player.r],pos);
  await page.locator('#sound').click();await move(page,'KeyD',.2);assert.equal((await state(page)).world.player.dir,'right');assert.equal(await page.locator('#sound').getAttribute('aria-pressed'),'true');
}));

test('a real keyboard crossing closes the line and captures the ghost-free side',async()=>withPage(async page=>{
  await start(page);await fixture(page,{ghosts:[{x:30.5,y:21.5}]});await move(page,'ArrowRight',7.4);const s=await state(page);
  assert.equal(s.state,'playing');assert.equal(s.world.claimed,38*14);assert.equal(s.world.score,38*14*10);assert.equal(s.world.trail.length,0);assert.equal(s.world.player.c,39);
  assert.equal(s.world.grid[7*40+20],1);assert.equal(s.world.grid[21*40+20],0);assert.equal(s.world.charges,1);assert.equal(s.best,s.world.score);
}));

test('ghosts on both sides protect both regions; only the dividing line is claimed',async()=>withPage(async page=>{
  await start(page);await fixture(page,{trail:rowTrail(14),player:{c:39,r:14},ghosts:[{x:30.5,y:6.5},{x:30.5,y:21.5}]});await page.evaluate(()=>evictionTest.capture());const s=await state(page);
  assert.equal(s.world.claimed,38);assert.equal(s.world.score,380);assert.equal(s.world.grid.filter(v=>v===0).length,interior-38);assert.equal(s.world.grid[6*40+20],0);assert.equal(s.world.grid[21*40+20],0);
}));

test('flood fill handles several disconnected regions and keeps every ghost inside open cells',async()=>withPage(async page=>{
  await start(page);const safe=[...rowTrail(9),...rowTrail(18)];const trail=Array.from({length:26},(_,i)=>[20,i+1]).filter(([,r])=>r!==9&&r!==18);
  await fixture(page,{safe,trail,player:{c:20,r:27},ghosts:[{x:8.5,y:4.5},{x:30.5,y:13.5},{x:8.5,y:23.5}]});await page.evaluate(()=>evictionTest.capture());const s=await state(page);
  for(const [c,r] of [[30,4],[8,13],[30,23]])assert.equal(s.world.grid[r*40+c],1);
  for(const [c,r] of [[8,4],[30,13],[8,23]])assert.equal(s.world.grid[r*40+c],0);
  assert(await page.evaluate(()=>evictionTest.state().world.ghosts.every(g=>g.kind==='turf'?evictionTest.greenPosition(g.x,g.y):evictionTest.canOccupy(g.x,g.y))));
}));

test('30 varied captures have exact area and preserve ghost collision clearance',async()=>withPage(async page=>{
  for(let i=0;i<30;i++){
    await page.evaluate(()=>evictionTest.start());const vertical=i%2===0,cut=3+(i%(vertical?32:20));
    const trail=vertical?Array.from({length:26},(_,r)=>[cut,r+1]):rowTrail(cut);
    const ghosts=vertical?[{x:cut+2.4,y:8.3},{x:cut+1.4,y:20.6}]:[{x:8.4,y:cut+2.4},{x:30.6,y:cut+1.4}];
    await fixture(page,{trail,player:vertical?{c:cut,r:27}:{c:39,r:cut},ghosts});await page.evaluate(()=>evictionTest.capture());const s=await state(page);
    assert.equal(s.world.claimed,vertical?cut*26:cut*38,'capture '+i);
    for(const g of s.world.ghosts)assert.equal(s.world.grid[Math.floor(g.y)*40+Math.floor(g.x)],g.kind==='turf'?1:0);
    assert(await page.evaluate(()=>evictionTest.state().world.ghosts.every(g=>g.kind==='turf'?evictionTest.greenPosition(g.x,g.y):evictionTest.canOccupy(g.x,g.y))));
  }
}));

test('backtracking unwinds a trail without scoring or losing a life',async()=>withPage(async page=>{
  await start(page);await fixture(page,{ghosts:[{x:30.5,y:21.5}]});await move(page,'ArrowRight',1);const before=await state(page);assert(before.world.trail.length>=5);
  await move(page,'ArrowLeft',1.4);const s=await state(page);assert.equal(s.world.player.c,0);assert.equal(s.world.trail.length,0);assert.equal(s.world.claimed,0);assert.equal(s.world.score,0);assert.equal(s.world.lives,3);assert.equal(s.world.grid.filter(v=>v===2).length,0);
}));

test('crossing your own line loses exactly one life and removes unfinished trail',async()=>withPage(async page=>{
  await start(page);const trail=[[1,10],[2,10],[3,10],[4,10],[5,10],[5,11],[5,12],[6,12],[6,11],[6,10]];
  await fixture(page,{trail,player:{c:6,r:10,anchor:{c:0,r:10}},ghosts:[{x:30.5,y:21.5}]});await move(page,'ArrowLeft',.15);const s=await state(page);
  assert.equal(s.state,'dying');assert.equal(s.world.lives,2);assert.equal(s.world.trail.length,0);await advance(page,1);const after=await state(page);assert.equal(after.state,'playing');assert.equal(after.world.player.c,0);assert.equal(after.world.player.r,10);assert.equal(after.world.lives,2);
}));

test('swept ghost contact ignites the line without instant death, then the surge catches the player',async()=>withPage(async page=>{
  await start(page);await fixture(page,{safe:[[15,3]],trail:Array.from({length:20},(_,i)=>[15,i+4]),player:{c:15,r:23,anchor:{c:15,r:3}},ghosts:[{x:10.5,y:14.5,vx:30,vy:0}]});
  await page.evaluate(()=>evictionTest.moveGhosts(.4));let s=await state(page);assert.equal(s.state,'playing');assert.equal(s.world.lives,3);assert(s.world.burns.length>0);assert.equal(s.world.trail.length,20);
  await fixture(page,{world:{freeze:10}});await advance(page,1);s=await state(page);assert.equal(s.state,'dying');assert.equal(s.world.lives,2);assert.equal(s.world.grid.filter(v=>v===2).length,0);
}));

test('ghosts bounce off captured walls and corners without clipping or escaping',async()=>withPage(async page=>{
  await start(page);await fixture(page,{safe:Array.from({length:26},(_,i)=>[20,i+1]),ghosts:[{x:19.5,y:8.5,vx:22,vy:18},{x:30.5,y:20.5,vx:-19,vy:23}]});
  const result=await page.evaluate(()=>{for(let i=0;i<1200;i++){evictionTest.moveGhosts(1/120);if(!evictionTest.state().world.ghosts.every(g=>evictionTest.canOccupy(g.x,g.y)))return false}return true});assert.equal(result,true);const s=await state(page);assert(s.world.ghosts[0].x<20);assert(s.world.ghosts[1].x>21);assert.equal(s.world.lives,3);
}));

test('contact is harmless on green but costs one life in the open; claimed turf survives',async()=>withPage(async page=>{
  await start(page);await fixture(page,{ghosts:[{x:1.35,y:14.5}]});await advance(page,.1);assert.equal((await state(page)).world.lives,3);
  await fixture(page,{safe:[[3,3]],world:{claimed:1},player:{c:2,r:14},trail:[[1,14],[2,14]],ghosts:[{x:2.5,y:14.5}]});await advance(page,.2);assert.equal((await state(page)).world.lives,2);await advance(page,1);const s=await state(page);assert.equal(s.world.grid[3*40+3],1);assert.equal(s.world.claimed,1);assert.equal(s.world.player.c,0);
}));

test('Freeze is limited, lasts 2.5 simulation seconds, and recharges on capture',async()=>withPage(async page=>{
  await start(page);await fixture(page,{world:{charges:1}});await page.keyboard.press('Space');let s=await state(page);assert.equal(s.world.charges,0);const pos=s.world.ghosts.map(g=>[g.x,g.y]);await page.keyboard.press('Space');await advance(page,2);s=await state(page);assert.deepEqual(s.world.ghosts.map(g=>[g.x,g.y]),pos);assert(s.world.freeze>.49);
  await advance(page,.65);s=await state(page);assert.equal(s.world.freeze,0);assert.notDeepEqual(s.world.ghosts.map(g=>[g.x,g.y]),pos);
  await fixture(page,{trail:rowTrail(10),player:{c:39,r:10},ghosts:[{x:25.5,y:22.5}]});await page.evaluate(()=>evictionTest.capture());assert.equal((await state(page)).world.charges,1);
  await page.locator('#freeze').click();assert.equal((await state(page)).world.charges,0);
}));

test('pause preserves timers and position, clears inputs, and resumes safely after blur',async()=>withPage(async page=>{
  await start(page);await fixture(page,{world:{charges:1}});await page.keyboard.press('Space');await page.keyboard.down('ArrowRight');await advance(page,.3);await page.keyboard.press('KeyP');const before=await state(page);assert.equal(before.state,'paused');assert.equal(before.input.length,0);await advance(page,5);let s=await state(page);assert.deepEqual(s.world,before.world);
  await start(page);assert.equal((await state(page)).state,'playing');await page.keyboard.up('ArrowRight');await advance(page,.3);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));s=await state(page);assert.equal(s.state,'paused');assert.equal(s.input.length,0);await page.locator('#restart').click();assert.equal((await state(page)).world.score,0);
}));

test('level completion awards one bonus and Next starts a harder level',async()=>withPage(async page=>{
  await start(page);await fixture(page,{trail:rowTrail(23),player:{c:39,r:23},ghosts:[{x:30.5,y:25.5}]});await page.evaluate(()=>evictionTest.capture());const s=await state(page);assert.equal(s.state,'cleared');assert.equal(s.world.claimed,38*23);assert.equal(s.world.score,38*23*10+800);assert.equal(await page.locator('#overlay').isVisible(),true);
  await advance(page,2);assert.equal((await state(page)).world.score,s.world.score);await start(page);const next=await state(page);assert.equal(next.state,'playing');assert.equal(next.world.level,2);assert.equal(next.world.score,s.world.score);assert.equal(next.world.lives,3);assert.deepEqual(next.world.ghosts.map(g=>g.kind),['roamer','edge']);assert.equal(next.world.charges,0);assert.equal(next.world.claimed,0);assert.equal(await page.locator('#goal').textContent(),'/ 81% TO WIN');
}));

test('last life opens game over; restart resets the game and retains browser best',async()=>withPage(async page=>{
  await start(page);await fixture(page,{world:{lives:1,score:2000}});await page.evaluate(()=>evictionTest.hurt());await advance(page,1);let s=await state(page);assert.equal(s.state,'over');assert.equal(s.best,2000);assert.equal(await page.locator('#panelTitle').textContent(),'The neighbors won.');
  await start(page);s=await state(page);assert.equal(s.state,'playing');assert.equal(s.world.lives,3);assert.equal(s.world.score,0);assert.equal(s.best,2000);await page.reload();assert.equal((await state(page)).best,2000);
}));

test('storage failure never blocks play or scoring',async()=>withPage(async page=>{
  await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('blocked')};Storage.prototype.setItem=()=>{throw Error('blocked')}});await page.reload();assert(await page.locator('#storageNote').isVisible());await start(page);
  await fixture(page,{trail:rowTrail(14),player:{c:39,r:14},ghosts:[{x:30.5,y:20.5}]});await page.evaluate(()=>evictionTest.capture());const s=await state(page);assert(s.best>0);assert.equal(s.state,'playing');
}));

test('controller select, stick, D-pad, Freeze and pause require release after changing screens',async()=>withPage(async page=>{
  await page.evaluate(()=>{globalThis.pad={connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});evictionTest.padRelease();pad.buttons[0]={pressed:true,value:1};evictionTest.pollGamepad()});assert.equal((await state(page)).state,'playing');
  await page.evaluate(()=>{pad.axes[0]=1;evictionTest.pollGamepad()});assert.equal((await state(page)).input.length,0);
  await page.evaluate(()=>{pad.buttons[0]={pressed:false,value:0};pad.axes[0]=0;evictionTest.pollGamepad();pad.axes[0]=1;evictionTest.pollGamepad()});await advance(page,.6);assert((await state(page)).world.player.c>=3);
  await page.evaluate(()=>{pad.axes[0]=0;pad.buttons[13]={pressed:true,value:1};evictionTest.pollGamepad()});await advance(page,.4);assert.equal((await state(page)).world.player.dir,'down');
  await fixture(page,{world:{charges:1}});await page.evaluate(()=>{pad.buttons[13]={pressed:false,value:0};pad.buttons[0]={pressed:true,value:1};evictionTest.pollGamepad();evictionTest.pollGamepad()});assert.equal((await state(page)).world.charges,0);
  await page.evaluate(()=>{pad.buttons[0]={pressed:false,value:0};pad.buttons[9]={pressed:true,value:1};evictionTest.pollGamepad()});assert.equal((await state(page)).state,'paused');
  await page.evaluate(()=>{pad.buttons[9]={pressed:false,value:0};evictionTest.pollGamepad();pad.buttons[0]={pressed:true,value:1};evictionTest.pollGamepad()});assert.equal((await state(page)).state,'playing');
  await page.evaluate(()=>window.dispatchEvent(new Event('gamepaddisconnected')));assert.equal((await state(page)).input.length,0);
}));

test('touch directions, pointer cancellation and board dragging release without stuck movement',async()=>withPage(async page=>{
  await start(page);await fixture(page,{ghosts:[{x:30.5,y:21.5}]});
  const send=(selector,type,id,extra={})=>page.evaluate(({selector,type,id,extra})=>{const b=document.querySelector(selector);b.setPointerCapture=()=>{};b.dispatchEvent(new PointerEvent(type,{pointerId:id,button:0,bubbles:true,...extra}))},{selector,type,id,extra});
  await send('[data-control=right]','pointerdown',1);await advance(page,.8);assert((await state(page)).world.player.c>=4);
  await send('[data-control=right]','pointercancel',1);await advance(page,.2);const p=(await state(page)).world.player;await advance(page,.4);assert.equal((await state(page)).world.player.c,p.c);assert.equal(await page.locator('.touch.active').count(),0);
  await send('#canvas','pointerdown',2,{clientX:100,clientY:100});await send('#canvas','pointermove',2,{clientX:130,clientY:100});await advance(page,.2);assert.equal((await state(page)).world.player.dir,'right');await send('#canvas','lostpointercapture',2);assert.equal((await state(page)).input.length,0);
}));

test('native multitouch can steer and trigger Freeze; cancel stops held direction',async()=>withPage(async(page,context)=>{
  await start(page);await fixture(page,{world:{charges:1}});const cdp=await context.newCDPSession(page);const rb=await page.locator('[data-control=right]').boundingBox(),fb=await page.locator('#freeze').boundingBox();const right={id:1,x:rb.x+rb.width/2,y:rb.y+rb.height/2},freeze={id:2,x:fb.x+fb.width/2,y:fb.y+fb.height/2};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[right]});await advance(page,.4);assert((await state(page)).world.player.c>=2);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[right,freeze]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[right]});assert.equal((await state(page)).world.charges,0);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal((await state(page)).input.length,0);
},{viewport:{width:390,height:844},isMobile:true,hasTouch:true}));

test('player moves at half the original speed in both green and open cells',async()=>withPage(async page=>{
  for(const player of [{c:0,r:14},{c:4,r:0}]){
    await page.evaluate(()=>evictionTest.start());await fixture(page,{player,ghosts:[]});await page.keyboard.down('ArrowRight');await advance(page,.1);await page.keyboard.up('ArrowRight');const p=(await state(page)).world.player;
    assert(Math.abs(p.x-(player.c+.5)-.55)<1e-8,'5.5 cells/second');assert.equal(p.y,player.r+.5);
  }
}));

test('edge ghost rides the green/empty interface and turns every corner continuously',async()=>withPage(async page=>{
  await start(page);await fixture(page,{player:{c:20,r:14},safe:[[20,14]],ghosts:[{kind:'edge',x:1,y:1,vx:4,vy:0,speed:4,color:'#ffad6b'}]});
  const result=await page.evaluate(()=>{const samples=[];for(let i=0;i<1280;i++){evictionTest.moveGhosts(.025);const g=evictionTest.state().world.ghosts[0];if(!(g.x===1||g.x===39||g.y===1||g.y===27))throw Error('left the green/empty interface');if(i%10===9)samples.push({...g})}return {samples,last:evictionTest.state().world.ghosts[0]}});
  assert(result.samples.some(g=>g.x===39&&g.y>1));assert(result.samples.some(g=>g.y===27&&g.x<39));assert(result.samples.some(g=>g.x===1&&g.y<27));assert(Math.abs(result.last.x-1)<1e-7);assert(Math.abs(result.last.y-1)<1e-7);
}));

test('edge ghost kills on green and swept collision catches it between endpoints',async()=>withPage(async page=>{
  await start(page);await fixture(page,{player:{c:0,r:14},ghosts:[{kind:'edge',x:1,y:17,vx:0,vy:-40,speed:40}]});await page.evaluate(()=>evictionTest.moveGhosts(.4));let s=await state(page);
  assert.equal(s.state,'dying');assert.equal(s.world.lives,2);assert.equal(s.world.grid[14*40],1);assert.match(await page.locator('#status').textContent(),/edge ghost caught/);
  await advance(page,1);s=await state(page);assert.equal(s.state,'playing');assert(s.world.player.invulnerable>0);assert.equal(s.world.lives,2);
  await fixture(page,{ghosts:[{kind:'edge',x:1,y:14.5,speed:0}]});await advance(page,.5);assert.equal((await state(page)).world.lives,2);await advance(page,1.5);assert.equal((await state(page)).world.lives,1);
}));

test('Freeze and pause stop the edge ghost; its empty half protects its capture region',async()=>withPage(async page=>{
  await start(page);await page.evaluate(()=>evictionTest.nextLevel());await fixture(page,{world:{charges:1}});await page.keyboard.press('Space');let before=(await state(page)).world.ghosts.find(g=>g.kind==='edge');await advance(page,1);let edge=(await state(page)).world.ghosts.find(g=>g.kind==='edge');assert.equal(edge.distance,before.distance);
  await page.keyboard.press('KeyP');await advance(page,4);assert.equal((await state(page)).world.ghosts.find(g=>g.kind==='edge').distance,before.distance);await start(page);await advance(page,2);edge=(await state(page)).world.ghosts.find(g=>g.kind==='edge');assert.notEqual(edge.distance,before.distance);
  await fixture(page,{trail:rowTrail(14),player:{c:39,r:14},ghosts:[{x:30.5,y:21.5},{kind:'edge',x:20,y:1,speed:4}]});await page.evaluate(()=>evictionTest.capture());const s=await state(page);assert.equal(s.world.claimed,38);assert.equal(s.world.ghosts.filter(g=>g.kind==='edge').length,1);assert.equal(s.world.grid[7*40+20],0);const moved=s.world.ghosts.find(g=>g.kind==='edge');assert.equal(moved.y,1);assert.equal(moved.x,20);assert.equal(moved.active,true);
}));

test('edge ghost follows concave territory corners without crossing green or empty interiors',async()=>withPage(async page=>{
  await start(page);const safe=[];for(let r=1;r<=8;r++)for(let c=1;c<=14;c++)safe.push([c,r]);for(let r=9;r<=16;r++)for(let c=11;c<=14;c++)safe.push([c,r]);for(let r=14;r<=20;r++)for(let c=1;c<=5;c++)safe.push([c,r]);for(let c=20;c<=38;c++)safe.push([c,18]);
  await fixture(page,{safe,player:{c:0,r:14,invulnerable:999},ghosts:[{kind:'edge',x:15,y:2,vx:0,vy:-4,speed:4}]});
  const result=await page.evaluate(()=>{const samples=[];for(let i=0;i<4800;i++){evictionTest.moveGhosts(.025);samples.push({...evictionTest.state().world.ghosts[0]})}return {samples,grid:evictionTest.state().world.grid}});
  for(const g of result.samples)assert(onFrontier(g,result.grid),'must straddle green/empty at '+g.x+','+g.y);
  assert(result.samples.some(g=>g.x===15&&g.y>10&&g.y<16));assert(result.samples.some(g=>g.x===11&&g.y>10&&g.y<16));assert(result.samples.some(g=>g.y===19&&g.x>20&&g.x<38));
}));

test('diagonally touching empty regions keep separate contour loops',async()=>withPage(async page=>{
  await start(page);const grid=Array(40*28).fill(1);for(const [c,r] of [[10,10],[11,10],[10,11],[11,11],[12,12],[13,12],[12,13],[13,13]])grid[r*40+c]=0;
  await fixture(page,{grid,player:{c:0,r:14,invulnerable:999},ghosts:[{kind:'edge',x:10,y:10,vx:4,vy:0,speed:4}]});
  const samples=await page.evaluate(()=>{const samples=[];for(let i=0;i<1600;i++){evictionTest.moveGhosts(.025);samples.push({...evictionTest.state().world.ghosts[0]})}return samples});
  for(const g of samples){assert(onFrontier(g,grid));assert(g.x>=10&&g.x<=12&&g.y>=10&&g.y<=12,'must stay on its original region at a diagonal meeting')}
}));

test('capture routes orange around its protected region, including new interior green edges',async()=>withPage(async page=>{
  await start(page);await fixture(page,{trail:rowTrail(14),player:{c:39,r:14},ghosts:[{x:30.5,y:21.5},{kind:'edge',x:39,y:20,speed:4}]});await page.evaluate(()=>evictionTest.capture());let s=await state(page),g=s.world.ghosts.find(g=>g.kind==='edge');assert(onFrontier(g,s.world.grid));assert.equal(s.world.claimed,38*14);assert.equal(g.x,39);assert.equal(g.y,20);
  await fixture(page,{player:{c:39,r:14,invulnerable:999},ghosts:[{x:30.5,y:21.5},{kind:'edge',x:20,y:15,speed:4}]});
  await page.evaluate(()=>evictionTest.draw());fs.mkdirSync(path.join(root,'.test-artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'.test-artifacts','eviction-territory-edge.png'),fullPage:true});
  await fixture(page,{player:{c:14,r:14,anchor:{c:14,r:14}},ghosts:[{x:30.5,y:21.5},{kind:'edge',x:10,y:15,vx:40,vy:0,speed:40}]});await page.evaluate(()=>evictionTest.moveGhosts(.4));s=await state(page);assert.equal(s.state,'dying');assert.equal(s.world.lives,2);assert.equal(s.world.claimed,38*14);assert.equal(s.world.grid[14*40+14],1);
}));

test('targets rise 1% each level through 95%, including the HUD and accessible progress',async()=>withPage(async page=>{
  await start(page);
  for(let level=1;level<=20;level++){
    await fixture(page,{world:{level,claimed:380}});const expected=Math.min(95,79+level);assert.equal(await page.evaluate(()=>evictionTest.targetPercent()),expected);assert.equal(await page.locator('#goal').textContent(),'/ '+expected+'% TO WIN');assert.equal(await page.locator('#guideGoal').textContent(),expected+'%');assert.equal(await page.locator('#progress').getAttribute('aria-valuemax'),String(expected));assert.match(await page.locator('#progress').getAttribute('aria-valuetext'),new RegExp(expected+'% to win'));
    const width=await page.locator('#progressFill').evaluate(el=>parseFloat(el.style.width));assert(Math.abs(width-(380/interior*100)/expected*100)<.001);
  }
}));

test('an orange ghost alone blocks its half-occupied region while the other side is captured',async()=>withPage(async page=>{
  await start(page);await fixture(page,{trail:rowTrail(14),player:{c:39,r:14},ghosts:[{kind:'edge',x:20,y:1,speed:4}]});await page.evaluate(()=>evictionTest.capture());const s=await state(page);
  assert.equal(s.state,'playing');assert.equal(s.world.claimed,38*13);assert.equal(s.world.grid[7*40+20],0);assert.equal(s.world.grid[21*40+20],1);assert.equal(s.world.grid[14*40+20],1);assert(onFrontier(s.world.ghosts[0],s.world.grid));
}));

test('an orange ghost at a diagonal meeting protects every empty region it overlaps',async()=>withPage(async page=>{
  await start(page);const grid=Array(40*28).fill(1);for(const [c,r] of [[10,10],[11,10],[10,11],[11,11],[12,12],[13,12],[12,13],[13,13]])grid[r*40+c]=0;
  await fixture(page,{grid,trail:[[20,24]],player:{c:0,r:14},ghosts:[{kind:'edge',x:12,y:12,speed:0}]});await page.evaluate(()=>evictionTest.capture());const s=await state(page);assert.equal(s.world.claimed,1);assert.equal(s.world.grid.filter(v=>v===0).length,8);
}));

test('orange contact ignites a distant trail even while frozen or in contact grace',async()=>withPage(async page=>{
  for(const grace of [0,.35]){await page.evaluate(()=>evictionTest.start());await fixture(page,{world:{freeze:10},trail:rowTrail(14),player:{c:38,r:14,invulnerable:99},ghosts:[{kind:'edge',x:1,y:14.5,speed:0,grace}]});await page.evaluate(()=>evictionTest.checkDanger());let s=await state(page);assert.equal(s.state,'playing');assert.equal(s.world.lives,3);assert(s.world.burns.length>0);await advance(page,2.4);s=await state(page);assert.equal(s.state,'dying');assert.equal(s.world.lives,2);assert.equal(s.world.claimed,0);assert.equal(s.world.score,0);assert.equal(s.world.grid.filter(v=>v===2).length,0)}
}));

test('red ghosts bounce and remove one claimed tile, updating percentage but keeping earned points',async()=>withPage(async page=>{
  await start(page);const safe=Array.from({length:18},(_,i)=>[20,i+5]);await fixture(page,{safe,world:{claimed:18,score:2000},ghosts:[{kind:'breaker',x:19.5,y:14.5,vx:4,vy:0}]});await advance(page,.1);const s=await state(page);
  assert.equal(s.world.grid[14*40+20],0);assert.equal(s.world.claimed,17);assert.equal(s.world.score,2000);assert(s.world.ghosts[0].vx<0);assert.equal(s.world.grid.filter(v=>v===1).length,40*28-interior+17);assert.equal(await page.locator('#percent').textContent(),(17/interior*100).toFixed(1)+'%');assert.equal(await page.locator('#progress').getAttribute('aria-valuenow'),(17/interior*100).toFixed(1));
}));

test('red cannot destroy the starting border or escape the board',async()=>withPage(async page=>{
  await start(page);await fixture(page,{player:{c:0,r:14,invulnerable:99},ghosts:[{kind:'breaker',x:38.5,y:10.5,vx:24,vy:19}]});const result=await page.evaluate(()=>{for(let i=0;i<1200;i++){evictionTest.update(1/120);const g=evictionTest.state().world.ghosts[0];if(!evictionTest.canOccupy(g.x,g.y))return false}return true});assert(result);const s=await state(page);assert.equal(s.world.claimed,0);assert.equal(s.world.grid.filter(v=>v===1).length,40*28-interior);
}));

test('blue joins at the start of wave four and percentage changes never spawn extra ghosts',async()=>withPage(async page=>{
  for(let level=1;level<=6;level++){await page.evaluate(()=>evictionTest.start());await fixture(page,{world:{level:level-1}});await page.evaluate(()=>evictionTest.nextLevel());let s=await state(page);assert.equal(s.world.ghosts.length,level);assert.equal(s.world.claimed,0);assert.equal(s.world.ghosts.filter(g=>g.kind==='turf').length,level>=4?1:0);for(const g of s.world.ghosts.filter(g=>g.kind==='turf'))assert.equal(s.world.grid[g.r*40+g.c],1);await fixture(page,{world:{claimed:120}});await advance(page,.02);s=await state(page);assert.equal(s.world.ghosts.length,level);assert.equal(s.world.ghosts.filter(g=>g.kind==='turf').length,level>=4?1:0)}
}));

test('blue does not block captures or duplicate when the percentage passes ten percent',async()=>withPage(async page=>{
  await start(page);await fixture(page,{world:{level:4},trail:rowTrail(3),player:{c:39,r:3},ghosts:[{x:30.5,y:21.5},{kind:'edge',x:39,y:20,speed:0},{kind:'breaker',x:25.5,y:22.5},{kind:'turf',x:.5,y:26.5,speed:0}]});await page.evaluate(()=>evictionTest.capture());let s=await state(page);assert.equal(s.world.claimed,114);assert.equal(s.world.ghosts.length,4);assert.equal(s.world.ghosts.filter(g=>g.kind==='turf').length,1);
  await fixture(page,{trail:rowTrail(6),player:{c:39,r:6}});await page.evaluate(()=>evictionTest.capture());s=await state(page);assert.equal(s.world.claimed,228);assert.equal(s.world.ghosts.length,4);
}));

test('cyan pursues over green without crossing empty cells, including on disconnected islands',async()=>withPage(async page=>{
  await start(page);const safe=[];for(let r=12;r<=15;r++)for(let c=1;c<=14;c++)safe.push([c,r]);await fixture(page,{safe,world:{cyanSpawned:true},player:{c:0,r:14,invulnerable:99},ghosts:[{kind:'turf',x:12.5,y:14.5,speed:3.6}]});
  let result=await page.evaluate(()=>{const originalRandom=Math.random;Math.random=()=>0;try{for(let i=0;i<360;i++){evictionTest.update(1/120);const g=evictionTest.state().world.ghosts[0];if(!evictionTest.greenPosition(g.x,g.y))return false}return true}finally{Math.random=originalRandom}});assert(result);assert((await state(page)).world.ghosts[0].x<4);
  await page.evaluate(()=>evictionTest.start());await fixture(page,{safe:[[10,10],[11,10],[10,11],[11,11]],world:{cyanSpawned:true},player:{c:0,r:14,invulnerable:99},ghosts:[{kind:'turf',x:10.5,y:10.5,speed:5}]});
  result=await page.evaluate(()=>{for(let i=0;i<1200;i++){evictionTest.update(1/120);const g=evictionTest.state().world.ghosts[0];if(!evictionTest.greenPosition(g.x,g.y)||g.x<10||g.x>12||g.y<10||g.y>12)return false}return true});assert(result);
}));

test('cyan contact on green costs exactly one life with swept movement',async()=>withPage(async page=>{
  await start(page);await fixture(page,{world:{cyanSpawned:true},player:{c:0,r:14},ghosts:[{kind:'turf',x:.5,y:12.5,speed:30}]});await page.evaluate(()=>{const originalRandom=Math.random;Math.random=()=>0;try{evictionTest.moveGhosts(.2)}finally{Math.random=originalRandom}});const s=await state(page);assert.equal(s.state,'dying');assert.equal(s.world.lives,2);assert.match(await page.locator('#status').textContent(),/cyan ghost/);
}));

test('blue patrols on 95% of decisions and chases on 5%, instead of steering at the player every cell',async()=>withPage(async page=>{
  await start(page);await fixture(page,{grid:Array(40*28).fill(1),player:{c:0,r:14,invulnerable:99},ghosts:[{kind:'turf',x:20.5,y:14.5,dir:'up'}]});
  const counts=await page.evaluate(()=>{const originalRandom=Math.random,result={up:0,left:0};try{for(let i=0;i<100;i++){let call=0;Math.random=()=>call++===0?i/100:0;const g=evictionTest.state().world.ghosts[0],direction=evictionTest.turfDirection(g);result[direction]=(result[direction]||0)+1}return result}finally{Math.random=originalRandom}});assert.deepEqual(counts,{up:95,left:5});
}));

test('red erosion repairs orange routes and displaces cyan onto surviving green',async()=>withPage(async page=>{
  await start(page);await fixture(page,{safe:[[20,14]],world:{claimed:1,cyanSpawned:true},player:{c:0,r:14,anchor:{c:20,r:14},invulnerable:99},ghosts:[{kind:'breaker',x:19.5,y:14.5,vx:4,vy:0},{kind:'edge',x:20,y:14.5,speed:0},{kind:'turf',x:20.5,y:14.5,speed:0}]});await advance(page,.1);let s=await state(page);assert.equal(s.world.claimed,0);assert.equal(s.world.grid[14*40+20],0);const orange=s.world.ghosts.find(g=>g.kind==='edge'),cyan=s.world.ghosts.find(g=>g.kind==='turf');assert(onFrontier(orange,s.world.grid));assert.equal(s.world.grid[cyan.r*40+cyan.c],1);assert(cyan.grace>0);
  await page.evaluate(()=>evictionTest.hurt());await advance(page,1);s=await state(page);assert.equal(s.state,'playing');assert.equal(s.world.grid[s.world.player.r*40+s.world.player.c],1);assert.equal(s.world.grid[s.world.player.anchor.r*40+s.world.player.anchor.c],1);
}));

test('Freeze and pause stop cyan travel and red erosion together',async()=>withPage(async page=>{
  await start(page);const safe=Array.from({length:18},(_,i)=>[20,i+5]);await fixture(page,{safe,world:{claimed:18,charges:1},player:{c:0,r:14,invulnerable:99},ghosts:[{kind:'breaker',x:19.5,y:14.5,vx:4,vy:0},{kind:'turf',x:.5,y:3.5,speed:3.6}]});await page.keyboard.press('Space');let before=await state(page);await advance(page,1);let s=await state(page);assert.deepEqual(s.world.grid,before.world.grid);assert.deepEqual(s.world.ghosts,before.world.ghosts);
  await page.keyboard.press('KeyP');before=await state(page);await advance(page,4);assert.deepEqual((await state(page)).world,before.world);await start(page);await advance(page,1.7);s=await state(page);assert(s.world.claimed<18);assert.notEqual(s.world.ghosts[1].y,before.world.ghosts[1].y);
}));

test('mixed enemies preserve terrain counts and stay in their domains during sustained erosion',async()=>withPage(async page=>{
  await start(page);const safe=[];for(let r=1;r<=26;r++)for(let c=1;c<=15;c++)safe.push([c,r]);await fixture(page,{safe,world:{claimed:390,cyanSpawned:true},player:{c:0,r:14,invulnerable:999},ghosts:[{kind:'breaker',x:25.5,y:14.5,vx:-8,vy:5},{kind:'edge',x:16,y:8,speed:4},{kind:'turf',x:6.5,y:12.5,speed:3.8}]});
  const result=await page.evaluate(()=>{for(let i=0;i<2400;i++){evictionTest.update(1/120);const s=evictionTest.state();if(s.state!=='playing')return 'unexpected damage';for(const g of s.world.ghosts){if(g.kind==='breaker'&&!evictionTest.canOccupy(g.x,g.y))return 'red clipped terrain';if(g.kind==='turf'&&!evictionTest.greenPosition(g.x,g.y))return 'cyan left green'}if(s.world.claimed!==s.world.grid.filter(v=>v===1).length-(40*28-38*26))return 'count drift'}return null});assert.equal(result,null);const s=await state(page);assert(s.world.claimed<390);assert.equal(s.world.score,0);assert(onFrontier(s.world.ghosts.find(g=>g.kind==='edge'),s.world.grid));
}));

test('level completion uses the increasing target and keeps the 95% cap at later levels',async()=>withPage(async page=>{
  for(const [level,cut,vertical,cleared] of [[1,21,false,true],[2,21,false,false],[16,36,true,false],[16,37,true,true],[30,36,true,false],[30,37,true,true]]){
    await page.evaluate(()=>evictionTest.start());await fixture(page,{world:{level},trail:vertical?Array.from({length:26},(_,r)=>[cut,r+1]):rowTrail(cut),player:vertical?{c:cut,r:27}:{c:39,r:cut},ghosts:vertical?[{x:38.5,y:20.5}]:[{x:30.5,y:25.5}]});await page.evaluate(()=>evictionTest.capture());assert.equal((await state(page)).state,cleared?'cleared':'playing','level '+level+', cut '+cut);
  }
}));

test('red, orange, and blue contacts each start a surge at the actual point without instant death',async()=>withPage(async page=>{
  for(const [ghost,at] of [[{kind:'breaker',x:5.5,y:14.5},5],[{kind:'edge',x:1,y:14.5,speed:0},.5],[{kind:'turf',x:.5,y:14.5,speed:0},0]]){
    await page.evaluate(()=>evictionTest.start());await fixture(page,{world:{cyanSpawned:true},trail:rowTrail(14).slice(0,20),player:{c:20,r:14},ghosts:[ghost]});await page.evaluate(()=>evictionTest.checkDanger());const s=await state(page);assert.equal(s.state,'playing');assert.equal(s.world.lives,3);assert.equal(s.world.burns.length,1);assert(Math.abs(s.world.burns[0].lo-at)<1e-8);assert.equal(s.world.burns[0].age,0);
    await page.evaluate(()=>evictionTest.updateBurns(.05));assert.equal((await state(page)).world.lives,3);
  }
}));

test('blue ignites the green anchor during the first partial cell of a new line',async()=>withPage(async page=>{
  await start(page);await fixture(page,{world:{cyanSpawned:true},player:{c:0,r:14,invulnerable:99},ghosts:[{kind:'turf',x:.5,y:14.5,speed:0}]});await page.keyboard.down('ArrowRight');await advance(page,.02);await page.keyboard.up('ArrowRight');const s=await state(page);assert.equal(s.state,'playing');assert.equal(s.world.trail.length,0);assert(s.world.player.target);assert(s.world.burns.length>0);assert.equal(s.world.burns[0].lo,0);assert.equal(s.world.lives,3);
}));

test('an accelerating red surge follows bends and renders only its reached portion',async()=>withPage(async page=>{
  await start(page);const trail=[...Array.from({length:10},(_,i)=>[i+1,14]),...Array.from({length:6},(_,i)=>[10,i+15]),...Array.from({length:10},(_,i)=>[i+11,20])];await fixture(page,{trail,player:{c:20,r:20},ghosts:[{kind:'breaker',x:5.5,y:14.5}]});await page.evaluate(()=>evictionTest.checkDanger());await fixture(page,{ghosts:[]});await page.evaluate(()=>evictionTest.updateBurns(.62));let s=await state(page);assert.equal(s.world.burns[0].lo,0);assert(Math.abs(s.world.burns[0].hi-10)<1e-8);
  await page.evaluate(()=>{evictionTest.updateBurns(.5);evictionTest.draw()});s=await state(page);assert(Math.abs(s.world.burns[0].hi-17)<1e-8);assert.equal(await page.evaluate(()=>evictionTest.lineGeometry().length),26);
  const pixels=await page.evaluate(()=>{const c=document.querySelector('#canvas').getContext('2d');return [[210,330],[350,410],[150,350]].map(([x,y])=>[...c.getImageData(x,y,1,1).data])});assert.deepEqual(pixels[0],[255,83,83,255]);assert.deepEqual(pixels[1],[212,245,120,255]);assert.notDeepEqual(pixels[2],[255,83,83,255]);
  fs.mkdirSync(path.join(root,'.test-artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'.test-artifacts','eviction-surge.png'),fullPage:true});
}));

test('repeated contact does not reset a surge; separate fronts retain independent acceleration clocks',async()=>withPage(async page=>{
  await start(page);await fixture(page,{trail:rowTrail(14).slice(0,30),player:{c:30,r:14,invulnerable:99},ghosts:[{kind:'breaker',x:5.5,y:14.5}]});await page.evaluate(()=>{evictionTest.checkDanger();evictionTest.updateBurns(.32);for(let i=0;i<40;i++)evictionTest.checkDanger()});let s=await state(page);assert.equal(s.world.burns.length,1);assert(Math.abs(s.world.burns[0].age-.32)<1e-8);assert(Math.abs(s.world.burns[0].hi-6.76)<1e-8);
  await page.evaluate(()=>evictionTest.updateBurns(.2));await fixture(page,{ghosts:[{kind:'breaker',x:15.5,y:14.5}]});await page.evaluate(()=>{evictionTest.checkDanger();evictionTest.updateBurns(.62)});s=await state(page);assert.equal(s.state,'playing');assert.equal(s.world.burns.length,2);assert(Math.abs(s.world.burns[0].hi-17.3216)<1e-8);assert(Math.abs(s.world.burns[1].hi-20)<1e-8);await page.evaluate(()=>evictionTest.updateBurns(.8));s=await state(page);assert.equal(s.state,'dying');assert.equal(s.world.lives,2);assert.equal(s.world.burns.length,0);
}));

test('finishing on green beats an approaching wave and clears it without burying the touching ghost',async()=>withPage(async page=>{
  await start(page);await fixture(page,{trail:rowTrail(14),player:{c:38,r:14},ghosts:[{kind:'breaker',x:36.5,y:14.5}]});await page.evaluate(()=>evictionTest.checkDanger());assert.equal((await state(page)).world.burns.length,1);await move(page,'ArrowRight',.2);let s=await state(page);assert.equal(s.state,'playing');assert.equal(s.world.player.c,39);assert.equal(s.world.lives,3);assert.equal(s.world.burns.length,0);assert.equal(s.world.trail.length,0);assert.equal(s.world.grid[14*40+36],0);assert(await page.evaluate(()=>evictionTest.canOccupy(evictionTest.state().world.ghosts[0].x,evictionTest.state().world.ghosts[0].y)));
  await advance(page,.6);s=await state(page);assert.equal(s.world.lives,3);assert.equal(s.world.burns.length,0);
}));

test('retreating to green extinguishes a tip ignition without leaving stale surge positions',async()=>withPage(async page=>{
  await start(page);await fixture(page,{trail:[[1,14]],player:{c:1,r:14},ghosts:[{kind:'breaker',x:1.5,y:14.5}]});await page.evaluate(()=>evictionTest.checkDanger());await fixture(page,{ghosts:[]});await move(page,'ArrowLeft',.2);let s=await state(page);assert.equal(s.world.lives,3);assert.equal(s.world.player.c,0);assert.equal(s.world.trail.length,0);assert.equal(s.world.burns.length,0);assert.equal(s.world.claimed,0);
  await move(page,'ArrowUp',.2);await move(page,'ArrowRight',.2);s=await state(page);assert.equal(s.world.burns.length,0);assert.equal(s.world.lives,3);
}));

test('pause holds surge clocks while Freeze stops ghosts but lets existing surges advance',async()=>withPage(async page=>{
  await start(page);await fixture(page,{world:{charges:1},trail:rowTrail(14).slice(0,20),player:{c:20,r:14},ghosts:[{kind:'breaker',x:5.5,y:14.5}]});await page.evaluate(()=>evictionTest.checkDanger());await fixture(page,{ghosts:[]});await page.keyboard.press('Space');await advance(page,.5);let s=await state(page);assert(s.world.freeze>1.9);assert(s.world.burns[0].hi>8);await page.keyboard.press('KeyP');const before=await state(page);await advance(page,3);assert.deepEqual((await state(page)).world,before.world);await start(page);await advance(page,.2);s=await state(page);assert(s.world.burns[0].hi>before.world.burns[0].hi);assert(s.world.freeze>0);
  await page.keyboard.press('KeyP');await page.locator('#restart').click();assert.equal((await state(page)).world.burns.length,0);
}));

test('a surge catches a moving player along a long unfinished line, costing only one life',async()=>withPage(async page=>{
  await start(page);await fixture(page,{trail:rowTrail(14).slice(0,8),player:{c:8,r:14,invulnerable:99},ghosts:[{kind:'breaker',x:1.5,y:14.5}]});await page.evaluate(()=>evictionTest.checkDanger());await fixture(page,{ghosts:[]});await page.keyboard.down('ArrowRight');await advance(page,1.6);await page.keyboard.up('ArrowRight');const s=await state(page);assert.equal(s.state,'dying');assert.equal(s.world.lives,2);assert.equal(s.world.trail.length,0);assert.equal(s.world.burns.length,0);assert.match(await page.locator('#status').textContent(),/red surge reached/);
}));

test('all six ghost types move five percent slower at every level',async()=>withPage(async page=>{
  for(const level of [4,6,8,20]){
    await page.evaluate(()=>evictionTest.start());await fixture(page,{world:{level:level-1}});await page.evaluate(()=>evictionTest.nextLevel());let s=await state(page);const red=s.world.ghosts.filter(g=>g.kind==='breaker'),orange=s.world.ghosts.find(g=>g.kind==='edge');for(const [i,g] of red.entries())assert(Math.abs(Math.hypot(g.vx,g.vy)-(2.65+Math.min(2.1,(level-1)*.23)+i*.12)*.95)<1e-8);assert(Math.abs(orange.speed-(3.8+Math.min(1.4,(level-1)*.09))*1.5*.95)<1e-8);for(const g of s.world.ghosts.filter(g=>['roamer','charger','plow'].includes(g.kind))){const base=g.kind==='plow'?2.2:g.kind==='charger'?2.9:2.4;assert(Math.abs(Math.hypot(g.vx,g.vy)-(base*1.5+Math.min(1.2,(level-1)*.08))*.95)<1e-8)}
    await advance(page,.05);let moved=await state(page),redAfter=moved.world.ghosts.find(g=>g.id===red[0].id);assert(Math.abs(moved.world.ghosts.find(g=>g.kind==='edge').distance-orange.distance-orange.speed*.05)<1e-8);assert(Math.abs(Math.hypot(redAfter.x-red[0].x,redAfter.y-red[0].y)-Math.hypot(red[0].vx,red[0].vy)*.05)<1e-8);
    s=await state(page);const blue=s.world.ghosts.find(g=>g.kind==='turf');assert(Math.abs(blue.speed-(3.6+Math.min(.8,(level-1)*.07))*1.5*.95)<1e-8);await advance(page,.05);moved=await state(page);const blueAfter=moved.world.ghosts.find(g=>g.kind==='turf');assert(Math.abs(Math.hypot(blueAfter.x-blue.x,blueAfter.y-blue.y)-blue.speed*.05)<1e-8);
  }
}));

test('each wave adds exactly one ghost, introducing all six kinds in the requested order',async()=>withPage(async page=>{
  const roster=['roamer','edge','breaker','turf','charger','plow'];
  for(let wave=1;wave<=12;wave++){await page.evaluate(()=>evictionTest.start());await fixture(page,{world:{level:wave-1}});await page.evaluate(()=>evictionTest.nextLevel());const s=await state(page);assert.equal(s.world.level,wave);assert.deepEqual(s.world.ghosts.map(g=>g.kind),Array.from({length:wave},(_,i)=>roster[i%6]));assert.equal(s.world.charges,0);assert.equal(s.world.nextFreeze,30);assert.equal(new Set(s.world.ghosts.map(g=>g.id)).size,wave)}
}));

test('pink is a casual bouncing ghost that cannot damage claimed blocks',async()=>withPage(async page=>{
  await start(page);await fixture(page,{safe:[[20,14]],world:{claimed:1},ghosts:[{kind:'roamer',x:19.5,y:14.5,vx:4,vy:0}]});await advance(page,.1);const s=await state(page);assert(s.world.ghosts[0].vx<0);assert.equal(s.world.claimed,1);assert.equal(s.world.grid[14*40+20],1);
}));

test('Freeze starts empty and awards charges at 30, 60, and 90 percent only',async()=>withPage(async page=>{
  await start(page);assert(await page.locator('#freeze').isDisabled());assert.equal(await page.locator('#freezeLabel').textContent(),'30% TO CHARGE');await page.keyboard.press('Space');assert.equal((await state(page)).world.freeze,0);
  for(const [cut,charges] of [[7,0],[8,1],[16,2],[24,3]]){await fixture(page,{world:{level:20},trail:rowTrail(cut),player:{c:39,r:cut},ghosts:[{x:30.5,y:25.5}]});await page.evaluate(()=>evictionTest.capture());const s=await state(page);assert.equal(s.state,'playing');assert.equal(s.world.charges,charges);assert.equal(s.world.nextFreeze,(charges+1)*30)}
  await page.evaluate(()=>evictionTest.nextLevel());assert.equal((await state(page)).world.charges,0);
}));

const testingKeys=['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowRight','ArrowLeft','ArrowRight','KeyB','KeyA'];
async function enterTestCode(page,keys=testingKeys){for(const key of keys)await page.keyboard.press(key)}

test('the exact keyboard sequence starts testing wave ten and keeps all scoring and best records clean',async()=>withPage(async page=>{
  await start(page);await fixture(page,{world:{score:1234}});await page.evaluate(()=>evictionTest.persist());await enterTestCode(page);let s=await state(page);assert.equal(s.state,'playing');assert.equal(s.world.level,10);assert.equal(s.world.ghosts.length,10);assert.equal(s.world.testing,true);assert.equal(s.world.score,0);assert.equal(s.world.charges,0);assert.equal(s.best,1234);assert.equal(await page.locator('#scoreLabel').textContent(),'SCORE · TEST');
  await fixture(page,{trail:rowTrail(24),player:{c:39,r:24},ghosts:[{x:30.5,y:25.5}]});await page.evaluate(()=>evictionTest.capture());s=await state(page);assert.equal(s.state,'cleared');assert.equal(s.world.score,0);assert.equal(s.best,1234);await start(page);s=await state(page);assert.equal(s.world.level,11);assert.equal(s.world.testing,true);await page.evaluate(()=>{evictionTest.awardScore(999999);evictionTest.persist()});assert.equal((await state(page)).world.score,0);assert.equal(await page.evaluate(()=>localStorage.getItem('eviction.best.v1')),'1234');
  await page.keyboard.press('KeyP');await page.locator('#restart').click();s=await state(page);assert.equal(s.world.level,1);assert.equal(s.world.testing,false);await page.evaluate(()=>evictionTest.awardScore(10));assert.equal((await state(page)).world.score,10);
}));

test('any intervening key breaks the testing sequence, which also works from the menu',async()=>withPage(async page=>{
  for(let split=1;split<testingKeys.length;split++){await page.evaluate(()=>evictionTest.start());await enterTestCode(page,[...testingKeys.slice(0,split),'KeyQ',...testingKeys.slice(split)]);assert.equal((await state(page)).world.testing,false,'interrupted after '+split);assert.equal((await state(page)).world.level,1)}
  await page.reload();await enterTestCode(page);assert.equal((await state(page)).world.level,10);assert.equal((await state(page)).world.testing,true);
}));

test('keyboard auto-repeat cannot supply two Up presses and modifiers interrupt the test code',async()=>withPage(async page=>{
  await start(page);await page.keyboard.down('ArrowUp');await page.keyboard.down('ArrowUp');await page.keyboard.up('ArrowUp');await enterTestCode(page,testingKeys.slice(2));assert.equal((await state(page)).world.testing,false);
  await page.evaluate(()=>evictionTest.start());await enterTestCode(page,testingKeys.slice(0,-1));await page.keyboard.press('Shift+KeyA');assert.equal((await state(page)).world.testing,false);
  await enterTestCode(page,['ArrowUp',...testingKeys]);assert.equal((await state(page)).world.testing,true);
}));

test('purple pauses with a visible exclamation warning, then charges along its telegraphed aim',async()=>withPage(async page=>{
  await start(page);await fixture(page,{player:{c:20,r:10,invulnerable:99},ghosts:[{kind:'charger',x:10.5,y:10.5,vx:4.35,vy:0,speed:4.35,attackIn:0}]});await advance(page,.02);let s=await state(page),g=s.world.ghosts[0];assert(g.warning>0);assert.equal(g.x,10.5);assert.equal(g.y,10.5);assert.equal(g.aim.x,1);assert.equal(g.aim.y,0);
  const warningPixels=await page.evaluate(()=>{evictionTest.draw();const data=document.querySelector('#canvas').getContext('2d').getImageData(199,164,23,30).data;let count=0;for(let i=0;i<data.length;i+=4)if(data[i]>240&&data[i+1]>190&&data[i+2]<190)count++;return count});assert(warningPixels>3);fs.mkdirSync(path.join(root,'.test-artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'.test-artifacts','eviction-purple-warning.png'),fullPage:true});
  await advance(page,.4);assert.equal((await state(page)).world.ghosts[0].x,10.5);await fixture(page,{player:{c:20,r:15,invulnerable:99}});await advance(page,.4);g=(await state(page)).world.ghosts[0];assert(g.dash>0);assert(g.x>10.5);assert.equal(g.y,10.5);assert(Math.abs(Math.hypot(g.vx,g.vy)-28.5)<1e-8);
}));

test('purple charges stop at green walls without damaging them and enter recovery',async()=>withPage(async page=>{
  await start(page);await fixture(page,{safe:Array.from({length:26},(_,i)=>[20,i+1]),world:{claimed:26},player:{c:30,r:14,invulnerable:99},ghosts:[{kind:'charger',x:19.5,y:14.5,vx:4.35,vy:0,speed:4.35,attackIn:0}]});await advance(page,.95);const s=await state(page),g=s.world.ghosts[0];assert.equal(g.dash,0);assert.equal(g.warning,0);assert(g.attackIn>4);assert(g.vx<0);assert.equal(s.world.grid[14*40+20],1);assert.equal(s.world.claimed,26);assert(await page.evaluate(()=>evictionTest.canOccupy(evictionTest.state().world.ghosts[0].x,evictionTest.state().world.ghosts[0].y)));
}));

test('high-speed purple charges cannot tunnel through the player',async()=>withPage(async page=>{
  await start(page);await fixture(page,{player:{c:15,r:14},ghosts:[{kind:'charger',x:10.5,y:14.5,vx:30,vy:0,speed:4.35,dash:1}]});await page.evaluate(()=>evictionTest.moveGhosts(.3));const s=await state(page);assert.equal(s.state,'dying');assert.equal(s.world.lives,2);
}));

test('green plows straight through multiple blocks without reflecting or changing speed',async()=>withPage(async page=>{
  await start(page);const safe=[];for(let r=9;r<=19;r++)for(let c=12;c<=20;c++)safe.push([c,r]);await fixture(page,{safe,world:{claimed:safe.length},player:{c:0,r:14,invulnerable:99},ghosts:[{kind:'plow',x:10.5,y:14.5,vx:8,vy:0,speed:8,turnIn:99}]});await advance(page,1.2);const s=await state(page),g=s.world.ghosts[0];assert(g.x>19.5);assert.equal(g.vx,8);assert.equal(g.vy,0);assert.equal(g.y,14.5);for(let c=12;c<=19;c++)assert.equal(s.world.grid[14*40+c],0);assert.equal(s.world.grid[13*40+12],1);assert(s.world.claimed<safe.length-7);assert.equal(s.world.score,0);
}));

test('green bounces only at the unbreakable border and occasionally turns naturally',async()=>withPage(async page=>{
  await start(page);await fixture(page,{player:{c:0,r:14,invulnerable:99},ghosts:[{kind:'plow',x:38.5,y:14.5,vx:20,vy:0,speed:20,turnIn:99}]});await advance(page,.2);let s=await state(page);assert(s.world.ghosts[0].vx<0);assert.equal(s.world.grid.filter(v=>v===1).length,40*28-interior);
  await page.evaluate(()=>{globalThis.originalRandom=Math.random;Math.random=()=>.75});await fixture(page,{ghosts:[{kind:'plow',x:20.5,y:14.5,vx:5,vy:0,speed:5,turnIn:.02}]});await advance(page,.03);s=await state(page);assert(s.world.ghosts[0].vy>0);assert(Math.abs(Math.hypot(s.world.ghosts[0].vx,s.world.ghosts[0].vy)-5)<1e-8);assert(s.world.ghosts[0].turnIn>2);await page.evaluate(()=>Math.random=originalRandom);
}));

test('Freeze and pause hold purple warnings and green direction timers',async()=>withPage(async page=>{
  await start(page);await fixture(page,{world:{charges:1},player:{c:0,r:14,invulnerable:99},ghosts:[{kind:'charger',x:20.5,y:14.5,vx:4,vy:0,warning:.5,aim:{x:1,y:0}},{kind:'plow',x:25.5,y:20.5,vx:4,vy:0,speed:4,turnIn:.02}]});await page.keyboard.press('Space');const before=await state(page);await advance(page,1);assert.deepEqual((await state(page)).world.ghosts,before.world.ghosts);await page.keyboard.press('KeyP');const paused=await state(page);await advance(page,4);assert.deepEqual((await state(page)).world,paused.world);await start(page);await advance(page,1.7);assert.notDeepEqual((await state(page)).world.ghosts,before.world.ghosts);
}));

test('surge acceleration adds one base speed per second with refresh-independent integration',async()=>withPage(async page=>{
  const trail=[...Array.from({length:38},(_,i)=>[i+1,2]),...Array.from({length:8},(_,i)=>[38,i+3]),...Array.from({length:37},(_,i)=>[37-i,10]),...Array.from({length:8},(_,i)=>[1,i+11]),...Array.from({length:37},(_,i)=>[i+2,18])];
  await start(page);await fixture(page,{trail,player:{c:38,r:18,anchor:{c:0,r:2}},ghosts:[]});await page.evaluate(()=>{evictionTest.igniteLine(0);evictionTest.updateBurns(1.12)});let s=await state(page);assert(Math.abs(s.world.burns[0].hi-12)<1e-8);await page.evaluate(()=>evictionTest.updateBurns(1));s=await state(page);assert(Math.abs(s.world.burns[0].hi-32)<1e-8);await page.evaluate(()=>evictionTest.updateBurns(1));s=await state(page);assert(Math.abs(s.world.burns[0].hi-60)<1e-8);
  await fixture(page,{trail,player:{c:38,r:18,anchor:{c:0,r:2}}});await page.evaluate(()=>{evictionTest.igniteLine(0);for(let i=0;i<312;i++)evictionTest.updateBurns(.01)});s=await state(page);assert.equal(s.state,'playing');assert(Math.abs(s.world.burns[0].hi-60)<1e-8);
}));

test('all six ghost kinds coexist safely while green erodes and purple charges',async()=>withPage(async page=>{
  await start(page);const safe=[];for(let r=1;r<=26;r++)for(let c=1;c<=15;c++)safe.push([c,r]);await fixture(page,{safe,world:{claimed:390},player:{c:0,r:14,invulnerable:999},ghosts:[{kind:'roamer',x:30.5,y:8.5,vx:-3,vy:2},{kind:'edge',x:16,y:8,speed:4},{kind:'breaker',x:27.5,y:20.5,vx:-4,vy:3},{kind:'turf',x:8.5,y:12.5,speed:4},{kind:'charger',x:22.5,y:7.5,vx:3,vy:2,speed:4,attackIn:.2},{kind:'plow',x:19.5,y:5.5,vx:-4,vy:1,speed:Math.hypot(4,1),turnIn:99}]});
  const result=await page.evaluate(()=>{for(let i=0;i<1800;i++){evictionTest.update(1/120);const s=evictionTest.state();if(s.state!=='playing')return 'unexpected death';for(const g of s.world.ghosts){if(['roamer','breaker','charger'].includes(g.kind)&&!evictionTest.canOccupy(g.x,g.y))return g.kind+' clipped green';if(g.kind==='turf'&&!evictionTest.greenPosition(g.x,g.y))return 'blue left green';if(g.x<0||g.x>40||g.y<0||g.y>28)return 'outside board'}if(s.world.claimed!==s.world.grid.filter(v=>v===1).length-(40*28-38*26))return 'count drift'}return null});assert.equal(result,null);const s=await state(page);assert(s.world.claimed<390);assert(onFrontier(s.world.ghosts.find(g=>g.kind==='edge'),s.world.grid));
}));

test('live rendering fits desktop, portrait and landscape; direct-file play and reduced motion work',async()=>withPage(async page=>{
  fs.mkdirSync(path.join(root,'.test-artifacts'),{recursive:true});
  for(const [name,width,height] of [['desktop',1440,1000],['portrait',390,844],['small-phone',320,568],['landscape',844,390]]){
    await page.setViewportSize({width,height});await page.goto(origin+'/actual');await page.screenshot({path:path.join(root,'.test-artifacts','eviction-'+name+'-menu.png'),fullPage:true});await start(page);await page.keyboard.down('ArrowRight');await page.waitForTimeout(550);await page.keyboard.up('ArrowRight');
    const board=await page.locator('#canvas').boundingBox(),freeze=await page.locator('#freeze').boundingBox(),cabinet=await page.locator('.cabinet').boundingBox();assert(board.width>150,name+' board is usable');assert(cabinet.y+cabinet.height<=height+1,name+' entire cabinet fits');assert(board.y+board.height<=height+1,name+' board fits');assert(freeze.y+freeze.height<=height+1,name+' controls fit');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' has no horizontal overflow');
    await page.screenshot({path:path.join(root,'.test-artifacts','eviction-'+name+'.png'),fullPage:true});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(pathToFileURL(path.join(root,'eviction.html')).href);await start(page);assert.equal(await page.locator('#overlay').isVisible(),false);await page.keyboard.press('KeyP');assert.equal(await page.locator('#panelTitle').textContent(),'On the fence?');
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/actual');await enterTestCode(page);await page.waitForTimeout(1000);assert.equal(await page.locator('#level').textContent(),'10');assert.equal(await page.locator('#score').textContent(),'000000');assert.equal(await page.locator('#scoreLabel').textContent(),'SCORE · TEST');assert.match(await page.locator('#boardLabel').textContent(),/TEST WAVE 10 \/ 10 UNINVITED/);await page.screenshot({path:path.join(root,'.test-artifacts','eviction-wave10.png'),fullPage:true});
}));
