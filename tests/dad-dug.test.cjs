// Run with Node.js and Playwright, using Edge on Windows (see README).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dad-dug.html'), 'utf8');
const expose = `globalThis.dadTest={start,update,draw,pause,center,openCell,carveLine,entity,addScore,ghostPath,drawGhost,
  pump,updateRocks,updateGhosts,hurt,pollGamepad,STEP,
  state:()=>({state,time,best,world,input:[...input]}),
  fixture:s=>{if(s.world)Object.assign(world,s.world);if(s.player)world.player=entity(s.player.c,s.player.r,s.player);
    if(s.ghosts)world.ghosts=s.ghosts.map((g,i)=>entity(g.c,g.r,{kind:i%2?'inky':'blinky',id:i,inflation:0,lastPump:-99,phase:0,phaseIn:99,breath:99,warning:0,dead:false,...g}));
    if(s.rocks)world.rocks=s.rocks.map((a,i)=>({id:i,...center(a.c,a.r),state:'rest',timer:0,kills:0,...a}));
    if('state' in s)state=s.state;if('time' in s)time=s.time;
    if(s.clear)world.dirt=Array.from({length:ROWS},()=>Array(COLS).fill(false));
    if(s.input){input.clear();s.input.forEach((v,i)=>input.set('fixture:'+i,v))}},
  advance:n=>{for(let i=0;i<Math.round(n/STEP);i++)update(STEP)},
  pixel:(x,y)=>{draw();return [...ctx.getImageData(x,y,1,1).data]}
};\n`;
const instrumented = html.replace("world={round:1,score:0,lives:3,nextLife:10000};loadRound();world.player", expose + "world={round:1,score:0,lives:3,nextLife:10000};loadRound();world.player")
  .replaceAll('requestAnimationFrame(frame)', 'void 0');
let server, browser, origin;
before(async () => {
  assert(instrumented.includes('globalThis.dadTest='));
  server = http.createServer((req,res) => {
    const asset = req.url.slice(1);
    if (['arcade.js','arcade.css'].includes(asset)) { res.setHeader('Content-Type', asset.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(fs.readFileSync(path.join(root,asset))); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(['/','/index','/index.html'].includes(req.url) ? fs.readFileSync(path.join(root,'index.html')) : req.url === '/actual' ? html : instrumented);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : process.platform === 'win32' ? { channel:'msedge' } : {}) });
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve))});
async function withPage(fn, options={}) {
  const context=await browser.newContext({viewport:{width:1365,height:1000},...options});
  const page=await context.newPage(),errors=[];
  await context.addInitScript(()=>{try{if(localStorage.getItem('tigerArcade.quarters.v1')===null)localStorage.setItem('tigerArcade.quarters.v1','1000')}catch{}});
  page.on('pageerror',e=>errors.push(e.message));
  try {await page.goto(origin+'/fixture');await fn(page,context);assert.deepEqual(errors,[])}finally{await context.close()}
}
const start=async page=>{await page.locator('#play').click();await page.waitForFunction(()=>!Arcade.busy)};
const state=async page=>{await page.waitForFunction(()=>!Arcade.busy);return page.evaluate(()=>dadTest.state())};
const fixture=(page,s)=>page.evaluate(s=>dadTest.fixture(s),s);
const advance=(page,n)=>page.evaluate(n=>dadTest.advance(n),n);

test('arcade lists three ready games and opens Dad Dug',async()=>withPage(async page=>{
  await page.goto(origin+'/index');
  assert.equal(await page.locator('.card').count(),6);
  assert.equal(await page.getByRole('heading',{name:'Quarters Please',exact:true}).count(),1);
  assert.equal(await page.getByRole('heading',{name:'Power Struggle',exact:true}).count(),1);
  assert.deepEqual(await page.locator('.card-link').evaluateAll(links=>links.map(link=>link.getAttribute('href'))),['ghost-pop','dad-dug','eviction','quarters-please.html']);
  await page.getByRole('button',{name:'Ready to play'}).click();
  assert.equal(await page.locator('[data-status=ready]:visible').count(),3);
  assert.equal(await page.locator('[data-status=soon]:visible').count(),0);
  assert.equal(await page.locator('#game-count').textContent(),'3 games ready');
  await page.getByRole('link',{name:'Play Dad Dug'}).click();
  assert.equal(new URL(page.url()).pathname,'/dad-dug');
  assert.equal(await page.title(),'Dad Dug · Tiger’s Arcade');
  await start(page);const s=await state(page);
  assert.equal(s.state,'playing');assert.equal(s.world.ghosts.length,4);assert.equal(s.world.rocks.length,5);
  assert.deepEqual([...new Set(s.world.ghosts.map(g=>g.kind))],['blinky','inky']);
  await page.getByRole('link',{name:'Other Games',exact:true}).click();
  assert.equal(new URL(page.url()).pathname,'/');
  assert.equal(await page.locator('.card').count(),6);
}));

test('keyboard digs new tunnels, turns, respects bounds and rocks, and keyup stops movement',async()=>withPage(async page=>{
  await start(page);
  await page.keyboard.down('ArrowRight');await advance(page,.75);await page.keyboard.up('ArrowRight');await advance(page,.3);
  let s=await state(page);assert(s.world.player.c>=13);assert.equal(s.world.dirt[3][12],false);
  const c=s.world.player.c;await advance(page,.5);assert.equal((await state(page)).world.player.c,c);
  await fixture(page,{player:{c:0,r:3,invulnerable:99},input:['left']});await advance(page,.2);assert.equal((await state(page)).world.player.c,0);
  await fixture(page,{player:{c:3,r:4,invulnerable:99},input:['right']});await advance(page,.3);assert.equal((await state(page)).world.player.c,3);
  await fixture(page,{player:{c:10,r:3,invulnerable:99}});await page.keyboard.down('s');await advance(page,.3);await page.keyboard.up('s');
  assert.equal((await state(page)).world.player.dir,'down');
  await page.locator('#sound').click();await page.keyboard.down('ArrowUp');await advance(page,.3);await page.keyboard.up('ArrowUp');
  assert.equal((await state(page)).world.player.dir,'up');
}));

test('pump flashes actual ghost pixels blue/white, freezes the target, pops and scores at depth',async()=>withPage(async page=>{
  await start(page);await fixture(page,{clear:true,rocks:[],player:{c:5,r:8,dir:'right',invulnerable:99},ghosts:[{c:7,r:8},{c:17,r:19}]});
  await page.keyboard.down('Space');await advance(page,.32);let s=await state(page);
  assert.equal(s.world.ghosts[0].inflation,1);const g=s.world.ghosts[0];
  const blue=await page.evaluate(({x,y})=>dadTest.pixel(x,y-12),g);assert.deepEqual(blue,[23,73,221,255]);
  await fixture(page,{time:.13});const white=await page.evaluate(({x,y})=>dadTest.pixel(x,y-12),g);assert.deepEqual(white,[255,255,255,255]);
  await advance(page,.55);s=await state(page);assert.equal(s.world.ghosts[0].x,g.x);assert(s.world.ghosts[0].inflation>=3);
  await advance(page,.3);await page.keyboard.up('Space');s=await state(page);
  assert.equal(s.world.ghosts[0].dead,true);assert.equal(s.world.score,300);assert.equal(s.best,300);
}));

test('pump extends slowly and only its advancing tip can catch a ghost',async()=>withPage(async page=>{
  await start(page);await fixture(page,{clear:true,rocks:[],player:{c:5,r:8,dir:'right',invulnerable:99},ghosts:[{c:7,r:8,warning:5}],input:['pump']});
  await advance(page,.1);let s=await state(page);
  assert.equal(s.world.ghosts[0].inflation,0,'a ghost in range is not hit immediately');assert.equal(s.world.hose.phase,'extending');
  assert(Math.abs(s.world.hose.length-11)<1e-7,'hose advances at 120 units per second');
  await advance(page,.2);assert.equal((await state(page)).world.ghosts[0].inflation,0);
  await advance(page,.2);s=await state(page);assert.equal(s.world.hose.phase,'attached');assert.equal(s.world.ghosts[0].inflation,1);
  await fixture(page,{world:{hose:null,pumpTimer:0},ghosts:[{c:17,r:19}],input:['pump']});
  await advance(page,.65);assert((await state(page)).world.hose.length>70);
  await fixture(page,{ghosts:[{c:6,r:8,warning:5}]});await advance(page,.1);
  assert.equal((await state(page)).world.ghosts[0].inflation,0,'walking into the hose behind its tip does not attach');
  await fixture(page,{input:[]});await advance(page,.01);assert.equal((await state(page)).world.hose,null,'release cancels extension');
}));

test('missed pump attempts retract and cannot catch ghosts until the next attempt',async()=>withPage(async page=>{
  await start(page);await fixture(page,{clear:true,rocks:[],player:{c:5,r:8,dir:'right',invulnerable:99},ghosts:[{c:17,r:19}],input:['pump']});
  await advance(page,.9);let s=await state(page);assert.equal(s.world.hose.phase,'retracting');assert.equal(s.world.hose.hit,false);
  const initialLife=s.world.hose.life;
  await fixture(page,{ghosts:[{c:7,r:8}]});await advance(page,.05);s=await state(page);
  assert.equal(s.world.ghosts[0].inflation,0,'entering a retracting hose does not attach it');
  assert.equal(s.world.hose.hit,false);assert(s.world.hose.life<initialLife);
  const oldTip=await page.evaluate(()=>{const h=dadTest.state().world.hose;return dadTest.pixel(h.x+104,h.y)});
  assert.deepEqual(oldTip,[25,32,30,255],'the missed nozzle has visibly retracted from the original tip');
  await advance(page,.12);s=await state(page);assert.equal(s.world.hose,null);assert.equal(s.world.ghosts[0].inflation,0);
  await advance(page,.4);s=await state(page);assert.equal(s.world.hose.hit,true);assert.equal(s.world.ghosts[0].inflation,1,'holding pump makes a fresh attempt');
  await fixture(page,{input:[]});await advance(page,.01);assert.equal((await state(page)).world.hose,null,'release removes an attached hose');
}));

test('both ghosts move 20 percent faster in tunnels and while phasing at every round speed',async()=>withPage(async page=>{
  await start(page);
  for(const round of [1,6,12,30])for(const kind of ['blinky','inky'])for(const phase of [0,2]){
    await fixture(page,{clear:true,rocks:[],world:{round},input:[],player:{c:15,r:10,invulnerable:99},ghosts:[{c:3,r:10,kind,phase}]});
    const before=(await state(page)).world.ghosts[0].x;
    await advance(page,.1);const g=(await state(page)).world.ghosts[0];
    const expected=((phase?47:52)+Math.min(32,(round-1)*3))*1.2*.1;
    assert(Math.abs(g.x-before-expected)<1e-7,kind+' speed in round '+round+' with phase '+phase);
  }
}));

test('dirt and rocks block pumping; ghosts recover when pumping stops; all four directions work',async()=>withPage(async page=>{
  await start(page);await fixture(page,{player:{c:10,r:3,dir:'right',invulnerable:99},ghosts:[{c:12,r:3}],input:['pump'],rocks:[]});
  await advance(page,.1);assert.equal((await state(page)).world.ghosts[0].inflation,0);
  await fixture(page,{clear:true,rocks:[{c:11,r:3}]});await advance(page,.3);assert.equal((await state(page)).world.ghosts[0].inflation,0);
  for(const [dir,dc,dr] of [['right',2,0],['left',-2,0],['up',0,-2],['down',0,2]]){
    await fixture(page,{clear:true,rocks:[],player:{c:10,r:10,dir,invulnerable:99},ghosts:[{c:10+dc,r:10+dr}],world:{pumpTimer:0,hose:null},input:['pump']});
    await advance(page,.32);assert.equal((await state(page)).world.ghosts[0].inflation,1,dir);
  }
  await fixture(page,{input:[]});await advance(page,1.7);assert.equal((await state(page)).world.ghosts[0].inflation,0);
}));

test('rocks wobble before falling, crush multiple ghosts, and award a snack after two drops',async()=>withPage(async page=>{
  await start(page);await fixture(page,{clear:true,player:{c:15,r:2,invulnerable:99},ghosts:[{c:5,r:7,inflation:2,lastPump:99},{c:5,r:8,inflation:2,lastPump:99},{c:18,r:18}],rocks:[{c:5,r:5},{c:8,r:5}]});
  await advance(page,.5);let s=await state(page);assert.equal(s.world.rocks[0].state,'shaking');assert.equal(s.world.rocks[0].y,240);
  await advance(page,1);s=await state(page);assert.equal(s.world.ghosts[0].dead,true);assert.equal(s.world.ghosts[1].dead,true);
  assert.equal(s.world.score,3000);assert.equal(s.world.dropped,2);assert(s.world.bonus);
  await fixture(page,{player:{c:10,r:8,invulnerable:99}});await advance(page,.01);assert.equal((await state(page)).world.score,3500);assert.equal((await state(page)).world.bonus,null);
}));

test('ghosts chase tunnels, phase out of isolated pockets and cannot be pumped while phasing',async()=>withPage(async page=>{
  await start(page);await fixture(page,{rocks:[],player:{c:10,r:5,invulnerable:99},ghosts:[{c:7,r:5}]});
  await advance(page,.7);assert((await state(page)).world.ghosts[0].x>240);
  await fixture(page,{player:{c:10,r:3,dir:'right',invulnerable:99},ghosts:[{c:12,r:3,phaseIn:0}],input:['pump']});
  await advance(page,.5);const g=(await state(page)).world.ghosts[0];assert(g.phase>0);assert(g.x<400);assert.equal(g.inflation,0);
  await fixture(page,{input:[]});await advance(page,3);const emerged=(await state(page)).world.ghosts[0];
  assert(emerged.phase<=0);assert.equal((await state(page)).world.dirt[emerged.r][emerged.c],false);
}));

test('expired phasing ends at the next tunnel center while ghosts are still chasing',async()=>withPage(async page=>{
  await start(page);
  for(const round of [1,12])for(const kind of ['blinky','inky'])for(const [dir,dc,dr] of [['right',1,0],['left',-1,0],['down',0,1],['up',0,-1]]){
    const c=10,r=10,pos={x:c*32+16,y:64+r*32+16};
    await fixture(page,{state:'playing',clear:true,rocks:[],world:{round,pumpTimer:0},input:[],
      player:{c:c+dc*6,r:r+dr*6,invulnerable:99},
      ghosts:[{c,r,kind,dir,phase:.001,phaseIn:8,x:pos.x+dc*7,y:pos.y+dr*7,
        target:{c:c+dc,r:r+dr,x:pos.x+dc*32,y:pos.y+dr*32}}]});
    await advance(page,.1);assert((await state(page)).world.ghosts[0].phase>0,'stay immaterial until centered');
    await advance(page,.55);const g=(await state(page)).world.ghosts[0];
    assert(g.phase<=0,kind+' must materialize while pursuing '+dir+' in round '+round);
    assert(g.phaseIn>2,'materialization resets the phase cooldown');
    assert.equal(dc?g.y:g.x,dc?pos.y:pos.x,'movement stays on the tunnel center line');
    const opposite={right:'left',left:'right',up:'down',down:'up'}[dir];
    await fixture(page,{player:{c:g.c+dc*2,r:g.r+dr*2,dir:opposite,invulnerable:99},input:['pump']});
    await advance(page,1.3);assert.equal((await state(page)).world.ghosts[0].dead,true,'materialized ghost can be pumped and popped');
  }
}));

test('Inky warns before breathing, breath hits the player, and lives lead to game over',async()=>withPage(async page=>{
  await start(page);await fixture(page,{clear:true,rocks:[],player:{c:10,r:10,invulnerable:0},ghosts:[{c:7,r:10,kind:'inky',breath:0}],world:{lives:1}});
  await advance(page,.1);let s=await state(page);assert(s.world.ghosts[0].warning>0);assert.equal(s.world.flames.length,0);
  await advance(page,.8);s=await state(page);assert.equal(s.state,'dying');assert.equal(s.world.lives,0);
  await advance(page,1.4);s=await state(page);assert.equal(s.state,'over');assert.equal(await page.locator('#panelTitle').textContent(),'That’s a wrap.');
  await start(page);assert.equal((await state(page)).world.lives,3);
}));

test('contact costs one life, respawns safely, and clearing ghosts advances the round',async()=>withPage(async page=>{
  await start(page);await fixture(page,{clear:true,rocks:[],player:{c:10,r:10,invulnerable:0},ghosts:[{c:10,r:10},{c:10,r:10}]});
  await advance(page,.01);assert.equal((await state(page)).world.lives,2);await advance(page,1.4);let s=await state(page);
  assert.equal(s.state,'playing');assert(s.world.player.invulnerable>0);assert(s.world.ghosts.every(g=>Math.hypot(g.x-s.world.player.x,g.y-s.world.player.y)>100));
  await fixture(page,{ghosts:[{c:1,r:1,dead:true}]});await advance(page,.01);assert.equal((await state(page)).state,'clearing');
  await advance(page,2.1);s=await state(page);assert.equal(s.world.round,2);assert(s.world.score>=500);assert(s.world.ghosts.every(g=>!g.dead));
  assert.equal(await page.evaluate(()=>Arcade.balance()),999,'respawning and advancing a round do not spend another quarter');
}));

test('pause freezes simulation and clears keyboard/pointer input; focus loss auto pauses',async()=>withPage(async page=>{
  await start(page);await page.keyboard.down('ArrowRight');await advance(page,.2);await page.keyboard.press('p');const s=await state(page);
  assert.equal(s.state,'paused');assert.equal(s.input.length,0);await advance(page,10);assert.deepEqual((await state(page)).world,s.world);
  await page.locator('#play').click();await page.keyboard.up('ArrowRight');await advance(page,.4);assert.equal((await state(page)).input.length,0);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal((await state(page)).state,'paused');
  await page.locator('#restart').click();assert.equal((await state(page)).world.score,0);
}));

test('touch supports simultaneous movement and pump; cancellation and capture loss release controls',async()=>withPage(async page=>{
  await start(page);
  const send=async(selector,type,id)=>page.locator(selector).evaluate((b,{type,id})=>{
    // Synthetic pointer events do not establish native capture, so emulate it here.
    b.setPointerCapture=()=>{};b.dispatchEvent(new PointerEvent(type,{pointerId:id,button:0,bubbles:true}));
  },{type,id});
  await send('[data-control=right]','pointerdown',1);await send('[data-control=pump]','pointerdown',2);
  assert.deepEqual((await state(page)).input.map(a=>a[1]),['right','pump']);await advance(page,.1);
  assert.equal((await state(page)).world.player.dir,'right');assert((await state(page)).world.hose);
  await send('[data-control=right]','pointercancel',1);assert.deepEqual((await state(page)).input.map(a=>a[1]),['pump']);
  await send('[data-control=pump]','lostpointercapture',2);assert.equal((await state(page)).input.length,0);
  assert.equal(await page.locator('.touch.active').count(),0);
},{hasTouch:true}));

test('standard gamepad moves, pumps, pauses, resumes and disconnects without stuck controls',async()=>withPage(async page=>{
  await start(page);await page.evaluate(()=>{globalThis.pad={connected:true,mapping:'standard',axes:[1,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad],configurable:true});dadTest.pollGamepad()});
  assert.equal((await state(page)).input[0][1],'right');await advance(page,.4);assert((await state(page)).world.player.c>10);
  await page.evaluate(()=>{pad.axes=[0,0];pad.buttons[0].pressed=true;dadTest.pollGamepad();dadTest.pollGamepad()});assert((await state(page)).input.some(a=>a[1]==='pump'));
  await page.evaluate(()=>{pad.buttons[9].pressed=true;dadTest.pollGamepad()});assert.equal((await state(page)).state,'paused');
  await page.evaluate(()=>{pad.buttons[9].pressed=false;dadTest.pollGamepad();pad.buttons[9].pressed=true;dadTest.pollGamepad()});assert.equal((await state(page)).state,'paused','release every held control before resuming');
  await page.evaluate(()=>{pad.buttons.forEach(b=>b.pressed=false);dadTest.pollGamepad();pad.buttons[9].pressed=true;dadTest.pollGamepad()});assert.equal((await state(page)).state,'playing');
  await page.evaluate(()=>{pad.buttons.forEach(b=>b.pressed=false);dadTest.pollGamepad();pad.buttons[0].pressed=true;window.dispatchEvent(new Event('blur'));dadTest.pollGamepad();window.dispatchEvent(new Event('focus'));dadTest.pollGamepad()});
  assert.equal((await state(page)).state,'paused','held select cannot resume after focus loss');
  await page.evaluate(()=>{pad.buttons[0].pressed=false;dadTest.pollGamepad();pad.buttons[0].pressed=true;dadTest.pollGamepad()});assert.equal((await state(page)).state,'playing');
  await page.evaluate(()=>dadTest.pollGamepad());assert.equal((await state(page)).input.length,0,'resuming does not pump until release');
  await page.evaluate(()=>{pad.connected=false;dadTest.pollGamepad()});assert.equal((await state(page)).input.length,0);
}));

test('native touch holds direction and pump together and cancels without stuck buttons',async()=>withPage(async(page,context)=>{
  await start(page);const a=await page.locator('[data-control=right]').boundingBox(),b=await page.locator('[data-control=pump]').boundingBox();
  const right={x:a.x+a.width/2,y:a.y+a.height/2,id:1},pump={x:b.x+b.width/2,y:b.y+b.height/2,id:2};
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[right]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[right,pump]});
  assert.deepEqual((await state(page)).input.map(a=>a[1]),['right','pump']);await advance(page,.1);assert((await state(page)).world.hose);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[right]});assert.deepEqual((await state(page)).input.map(a=>a[1]),['pump']);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal((await state(page)).input.length,0);
},{hasTouch:true,viewport:{width:390,height:844}}));

test('extra lives and best score persist across reloads; unavailable storage remains playable',async()=>withPage(async page=>{
  await start(page);await page.evaluate(()=>dadTest.addScore(25200,300,300));assert.equal((await state(page)).world.lives,5);
  await page.reload();assert.equal((await state(page)).best,25200);
  await page.addInitScript(()=>{Storage.prototype.setItem=()=>{throw new Error('blocked')}});await page.reload();await start(page);
  await page.evaluate(()=>dadTest.addScore(30000,300,300));assert.equal(await page.locator('#storageNote').isVisible(),true);assert.equal((await state(page)).state,'playing');
}));

test('live game runs without errors, fits desktop/portrait/landscape, and works from disk',async()=>withPage(async page=>{
  fs.mkdirSync(path.join(root,'.test-artifacts'),{recursive:true});
  for(const [name,width,height] of [['desktop',1365,1000],['portrait',390,844],['landscape',844,390]]){
    await page.setViewportSize({width,height});await page.goto(origin+'/actual');await start(page);await page.waitForTimeout(350);
    const box=await page.locator('#canvas').boundingBox();assert(box.width>150);assert(box.y+box.height<=height+1, name+' board fits');
    const pump=await page.locator('[data-control=pump]').boundingBox();assert(pump.y+pump.height<=height+1,name+' pump fits');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(root,'.test-artifacts','dad-dug-'+name+'.png'),fullPage:true});
  }
  await page.goto(require('node:url').pathToFileURL(path.join(root,'dad-dug.html')).href);await start(page);assert.equal(await page.locator('#overlay').isVisible(),false);
}));
