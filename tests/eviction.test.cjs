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
const expose = `globalThis.evictionTest={start,update,draw,pause,capture,hurt,freeze,moveGhosts,canOccupy,pollGamepad,nextLevel,rebuildBoundary,targetPercent,STEP,
  state:()=>({state,time,best,buffered,input:[...input],world:{...world,grid:[...world.grid]}}),
  fixture:s=>{clearInput();if(s.world)Object.assign(world,s.world);if(s.grid)world.grid=Uint8Array.from(s.grid);
    if(s.safe)for(const [c,r] of s.safe)world.grid[index(c,r)]=SAFE;
    if(s.trail){world.trail=s.trail.map(([c,r])=>index(c,r));for(const i of world.trail)world.grid[i]=TRAIL}
    if(s.player){const p=s.player;world.player={c:p.c,r:p.r,x:p.c+.5,y:p.r+.5,fromX:p.c+.5,fromY:p.r+.5,target:null,dir:'right',anchor:{c:0,r:14},...p}}
    if(s.ghosts)world.ghosts=s.ghosts.map((g,i)=>({kind:'roamer',vx:0,vy:0,id:i,color:'#ed8ead',...g}));
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
  await start(page);const s=await state(page);assert.equal(s.state,'playing');assert.equal(s.world.ghosts.filter(g=>g.kind==='roamer').length,2);assert.equal(s.world.ghosts.filter(g=>g.kind==='edge').length,1);assert.equal(s.world.lives,3);assert.equal(s.world.claimed,0);assert.equal(s.world.charges,1);
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
  assert.equal(s.world.grid[7*40+20],1);assert.equal(s.world.grid[21*40+20],0);assert(s.world.charges>1);assert.equal(s.best,s.world.score);
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
  assert(await page.evaluate(()=>evictionTest.state().world.ghosts.every(g=>evictionTest.canOccupy(g.x,g.y))));
}));

test('30 varied captures have exact area and preserve ghost collision clearance',async()=>withPage(async page=>{
  for(let i=0;i<30;i++){
    await page.evaluate(()=>evictionTest.start());const vertical=i%2===0,cut=3+(i%(vertical?32:20));
    const trail=vertical?Array.from({length:26},(_,r)=>[cut,r+1]):rowTrail(cut);
    const ghosts=vertical?[{x:cut+2.4,y:8.3},{x:cut+1.4,y:20.6}]:[{x:8.4,y:cut+2.4},{x:30.6,y:cut+1.4}];
    await fixture(page,{trail,player:vertical?{c:cut,r:27}:{c:39,r:cut},ghosts});await page.evaluate(()=>evictionTest.capture());const s=await state(page);
    assert.equal(s.world.claimed,vertical?cut*26:cut*38,'capture '+i);
    for(const g of s.world.ghosts)assert.equal(s.world.grid[Math.floor(g.y)*40+Math.floor(g.x)],0);
    assert(await page.evaluate(()=>evictionTest.state().world.ghosts.every(g=>evictionTest.canOccupy(g.x,g.y))));
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

test('swept ghost collision catches a line even with an abnormally fast ghost',async()=>withPage(async page=>{
  await start(page);await fixture(page,{trail:Array.from({length:20},(_,i)=>[15,i+4]),player:{c:15,r:23},ghosts:[{x:10.5,y:14.5,vx:30,vy:0}]});
  await page.evaluate(()=>evictionTest.moveGhosts(.4));const s=await state(page);assert.equal(s.state,'dying');assert.equal(s.world.lives,2);assert.equal(s.world.grid.filter(v=>v===2).length,0);
}));

test('ghosts bounce off captured walls and corners without clipping or escaping',async()=>withPage(async page=>{
  await start(page);await fixture(page,{safe:Array.from({length:26},(_,i)=>[20,i+1]),ghosts:[{x:19.5,y:8.5,vx:22,vy:18},{x:30.5,y:20.5,vx:-19,vy:23}]});
  const result=await page.evaluate(()=>{for(let i=0;i<1200;i++){evictionTest.moveGhosts(1/120);if(!evictionTest.state().world.ghosts.every(g=>evictionTest.canOccupy(g.x,g.y)))return false}return true});assert.equal(result,true);const s=await state(page);assert(s.world.ghosts[0].x<20);assert(s.world.ghosts[1].x>21);assert.equal(s.world.lives,3);
}));

test('contact is harmless on green but costs one life in the open; claimed turf survives',async()=>withPage(async page=>{
  await start(page);await fixture(page,{ghosts:[{x:1.35,y:14.5}]});await advance(page,.1);assert.equal((await state(page)).world.lives,3);
  await fixture(page,{safe:[[3,3]],world:{claimed:1},player:{c:2,r:14},trail:[[1,14],[2,14]],ghosts:[{x:2.5,y:14.5}]});await advance(page,.1);assert.equal((await state(page)).world.lives,2);await advance(page,1);const s=await state(page);assert.equal(s.world.grid[3*40+3],1);assert.equal(s.world.claimed,1);assert.equal(s.world.player.c,0);
}));

test('Freeze is limited, lasts 2.5 simulation seconds, and recharges on capture',async()=>withPage(async page=>{
  await start(page);await page.keyboard.press('Space');let s=await state(page);assert.equal(s.world.charges,0);const pos=s.world.ghosts.map(g=>[g.x,g.y]);await page.keyboard.press('Space');await advance(page,2);s=await state(page);assert.deepEqual(s.world.ghosts.map(g=>[g.x,g.y]),pos);assert(s.world.freeze>.49);
  await advance(page,.65);s=await state(page);assert.equal(s.world.freeze,0);assert.notDeepEqual(s.world.ghosts.map(g=>[g.x,g.y]),pos);
  await fixture(page,{trail:rowTrail(10),player:{c:39,r:10},ghosts:[{x:25.5,y:22.5}]});await page.evaluate(()=>evictionTest.capture());assert.equal((await state(page)).world.charges,2);
  await page.locator('#freeze').click();assert.equal((await state(page)).world.charges,1);
}));

test('pause preserves timers and position, clears inputs, and resumes safely after blur',async()=>withPage(async page=>{
  await start(page);await page.keyboard.press('Space');await page.keyboard.down('ArrowRight');await advance(page,.3);await page.keyboard.press('KeyP');const before=await state(page);assert.equal(before.state,'paused');assert.equal(before.input.length,0);await advance(page,5);let s=await state(page);assert.deepEqual(s.world,before.world);
  await start(page);assert.equal((await state(page)).state,'playing');await page.keyboard.up('ArrowRight');await advance(page,.3);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));s=await state(page);assert.equal(s.state,'paused');assert.equal(s.input.length,0);await page.locator('#restart').click();assert.equal((await state(page)).world.score,0);
}));

test('level completion awards one bonus and Next starts a harder level',async()=>withPage(async page=>{
  await start(page);await fixture(page,{trail:rowTrail(23),player:{c:39,r:23},ghosts:[{x:30.5,y:25.5}]});await page.evaluate(()=>evictionTest.capture());const s=await state(page);assert.equal(s.state,'cleared');assert.equal(s.world.claimed,38*23);assert.equal(s.world.score,38*23*10+800);assert.equal(await page.locator('#overlay').isVisible(),true);
  await advance(page,2);assert.equal((await state(page)).world.score,s.world.score);await start(page);const next=await state(page);assert.equal(next.state,'playing');assert.equal(next.world.level,2);assert.equal(next.world.score,s.world.score);assert.equal(next.world.lives,3);assert.equal(next.world.ghosts.filter(g=>g.kind==='roamer').length,3);assert.equal(next.world.ghosts.filter(g=>g.kind==='edge').length,1);assert.equal(next.world.claimed,0);assert.equal(await page.locator('#goal').textContent(),'/ 81% TO WIN');
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
  await page.evaluate(()=>{pad.buttons[13]={pressed:false,value:0};pad.buttons[0]={pressed:true,value:1};evictionTest.pollGamepad();evictionTest.pollGamepad()});assert.equal((await state(page)).world.charges,0);
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
  await start(page);const cdp=await context.newCDPSession(page);const rb=await page.locator('[data-control=right]').boundingBox(),fb=await page.locator('#freeze').boundingBox();const right={id:1,x:rb.x+rb.width/2,y:rb.y+rb.height/2},freeze={id:2,x:fb.x+fb.width/2,y:fb.y+fb.height/2};
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

test('Freeze and pause stop the edge ghost; edge ghosts do not protect open capture regions',async()=>withPage(async page=>{
  await start(page);await page.keyboard.press('Space');let before=(await state(page)).world.ghosts.find(g=>g.kind==='edge');await advance(page,1);let edge=(await state(page)).world.ghosts.find(g=>g.kind==='edge');assert.equal(edge.distance,before.distance);
  await page.keyboard.press('KeyP');await advance(page,4);assert.equal((await state(page)).world.ghosts.find(g=>g.kind==='edge').distance,before.distance);await start(page);await advance(page,2);edge=(await state(page)).world.ghosts.find(g=>g.kind==='edge');assert.notEqual(edge.distance,before.distance);
  await fixture(page,{trail:rowTrail(14),player:{c:39,r:14},ghosts:[{x:30.5,y:21.5},{kind:'edge',x:20,y:1,speed:4}]});await page.evaluate(()=>evictionTest.capture());const s=await state(page);assert.equal(s.world.claimed,38*14);assert.equal(s.world.ghosts.filter(g=>g.kind==='edge').length,1);assert.equal(s.world.grid[7*40+20],1);const moved=s.world.ghosts.find(g=>g.kind==='edge');assert.equal(moved.y,15);assert.equal(moved.x,20);assert.equal(moved.active,true);
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

test('capture moves the ghost onto the new interior frontier, where it can kill on green',async()=>withPage(async page=>{
  await start(page);await fixture(page,{trail:rowTrail(14),player:{c:39,r:14},ghosts:[{x:30.5,y:21.5},{kind:'edge',x:20,y:1,speed:4}]});await page.evaluate(()=>evictionTest.capture());let s=await state(page),g=s.world.ghosts.find(g=>g.kind==='edge');assert(onFrontier(g,s.world.grid));assert.equal(g.y,15);assert(g.grace>0);
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

test('level completion uses the increasing target and keeps the 95% cap at later levels',async()=>withPage(async page=>{
  for(const [level,cut,vertical,cleared] of [[1,21,false,true],[2,21,false,false],[16,36,true,false],[16,37,true,true],[30,36,true,false],[30,37,true,true]]){
    await page.evaluate(()=>evictionTest.start());await fixture(page,{world:{level},trail:vertical?Array.from({length:26},(_,r)=>[cut,r+1]):rowTrail(cut),player:vertical?{c:cut,r:27}:{c:39,r:cut},ghosts:vertical?[{x:38.5,y:20.5}]:[{x:30.5,y:25.5}]});await page.evaluate(()=>evictionTest.capture());assert.equal((await state(page)).state,cleared?'cleared':'playing','level '+level+', cut '+cut);
  }
}));

test('live rendering fits desktop, portrait and landscape; direct-file play and reduced motion work',async()=>withPage(async page=>{
  fs.mkdirSync(path.join(root,'.test-artifacts'),{recursive:true});
  for(const [name,width,height] of [['desktop',1440,1000],['portrait',390,844],['small-phone',320,568],['landscape',844,390]]){
    await page.setViewportSize({width,height});await page.goto(origin+'/actual');await page.screenshot({path:path.join(root,'.test-artifacts','eviction-'+name+'-menu.png'),fullPage:true});await start(page);await page.keyboard.down('ArrowRight');await page.waitForTimeout(550);await page.keyboard.up('ArrowRight');
    const board=await page.locator('#canvas').boundingBox(),freeze=await page.locator('#freeze').boundingBox(),cabinet=await page.locator('.cabinet').boundingBox();assert(board.width>150,name+' board is usable');assert(cabinet.y+cabinet.height<=height+1,name+' entire cabinet fits');assert(board.y+board.height<=height+1,name+' board fits');assert(freeze.y+freeze.height<=height+1,name+' controls fit');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' has no horizontal overflow');
    await page.screenshot({path:path.join(root,'.test-artifacts','eviction-'+name+'.png'),fullPage:true});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(pathToFileURL(path.join(root,'eviction.html')).href);await start(page);assert.equal(await page.locator('#overlay').isVisible(),false);await page.keyboard.press('KeyP');assert.equal(await page.locator('#panelTitle').textContent(),'On the fence?');
}));
