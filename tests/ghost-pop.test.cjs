// Run with: node --test tests/ghost-pop.test.cjs
// Requires Playwright and a Chromium installation (Edge on Windows by default).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const html = fs.readFileSync(path.join(__dirname, '..', 'ghost-pop.html'), 'utf8');
// Expose fixtures only in the test response; the shipped file has no test API.
const expose = `
globalThis.gameTest = {
  start, selectMode, settle, snap, finish, scoreValue, createPalette, validPalette,
  traceStep, position, draw, CLASSIC, MODES, AIM_INPUT, REACTION_INTERVAL, records, update, fire, shotSpeed, displayColor, drawNextPreview,pollGamepads,
  state:()=>({rules, grid:[...grid.values()], parity, loaded, next, points, shots, misses,
    ended, projectile, aim, popText, W,H,R,DANGER,SHOOT,screen,palette,highScores,settings,assistTime,reaction,activeMode}),
  fixture:s=>{if(s.grid)grid=new Map(s.grid.map(g=>[key(g.r,g.c),g]));
    if(s.rules)rules={...rules,...s.rules};
    if('misses' in s)misses=s.misses;if('next' in s)next=s.next;
    if('points' in s)points=s.points;if('shots' in s)shots=s.shots;
    if('ended' in s)ended=s.ended;if('parity' in s)parity=s.parity;
    if(s.settings)settings={...settings,...s.settings};
    if('loaded' in s)loaded=s.loaded;if('assistTime' in s)assistTime=s.assistTime;
    projectile=s.projectile||null;reaction=null;popText=[];}
};
`;
const instrumented = html.replace('buildFields();selectMode', expose + 'buildFields();selectMode')
  .replaceAll('requestAnimationFrame(frame)', 'void 0');
let server, browser, origin;
before(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(req.url === '/actual' ? html : instrumented);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function withPage(fn, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, ...options });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try { await page.goto(origin); await fn(page, context); assert.deepEqual(errors, []); }
  finally { await context.close(); }
}
const start = page => page.locator('#play').click();
const fixture = (page, data) => page.evaluate(data => gameTest.fixture(data), data);
const state = page => page.evaluate(() => gameTest.state());

test('Classic opens from menu with the expanded board and expected rules', async () => withPage(async page => {
  assert.equal(await page.locator('#gameScreen').isVisible(), false);
  await start(page);
  const s = await state(page);
  assert.deepEqual(s.rules, { colors:6,columns:18,maxRows:20,initialRows:7,rowEvery:5,
    rowsAdded:2,maxBounces:1,aimDistance:340,collisionFactor:.89,matchSize:3,
    popPoints:100,chainBonus:.35,dropPoints:175,winMultiplier:100,shotExponent:1.5 });
  assert.equal(s.W, 774); assert.equal(s.H, 828);
  assert(s.grid.every(g => g.r < 7 && g.c < 18));
  assert.equal(s.palette[4], '#19864b');
  assert.equal(await page.locator('a').getAttribute('href'), 'index.html');
}));

test('pointer hold and drag aim without shooting; release fires once; cancel never fires', async () => withPage(async (page, context) => {
  await start(page);
  const rect = await page.locator('#canvas').boundingBox();
  const x = rect.x + rect.width * .4, y = rect.y + rect.height * .7;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x,y}] });
  await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:x+50,y:y-80}] });
  assert.equal((await state(page)).shots, 0);
  assert.notEqual((await state(page)).aim, -Math.PI/2);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  assert.equal((await state(page)).shots, 1);
  await page.locator('#restart').click();
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x,y}] });
  await cdp.send('Input.dispatchTouchEvent', { type:'touchCancel', touchPoints:[] });
  assert.equal((await state(page)).shots, 0);
}, { hasTouch:true }));

test('Custom defaults match Classic; valid settings persist; invalid settings prevent Play', async () => withPage(async page => {
  await page.locator('[data-mode=custom]').click();
  assert.equal(await page.locator('#showScores').isVisible(), false);
  const defaults = await page.locator('#customForm input').evaluateAll(inputs => Object.fromEntries(inputs.map(i=>[i.name,Number(i.value)])));
  assert.deepEqual(defaults, await page.evaluate(()=>gameTest.CLASSIC));
  await page.locator('#rule-initialRows').fill('20');
  await page.locator('#play').click();
  assert.equal((await state(page)).screen, 'menu');
  await page.locator('#rule-initialRows').fill('5');
  await page.locator('#rule-colors').fill('24');
  await page.locator('#rule-columns').fill('12');
  await page.locator('#rule-maxBounces').fill('50');
  await page.reload();
  await page.locator('[data-mode=custom]').click();
  assert.equal(await page.locator('#rule-colors').inputValue(), '24');
  await start(page);
  const s = await state(page);
  assert.equal(s.rules.colors, 24); assert.equal(s.rules.columns, 12); assert.equal(s.rules.maxBounces, 50);
  await fixture(page,{points:10000,shots:4});
  await page.evaluate(()=>gameTest.finish(true));
  assert.equal(await page.evaluate(()=>localStorage.getItem('pacGhostPop.scores.v1')), null);
  assert.match(await page.locator('#endSaved').textContent(), /no high score/);
}));

test('only misses count down, last chance has no next color, and a wave adds two rows from surviving colors', async () => withPage(async page => {
  await start(page);
  await fixture(page,{grid:[{r:0,c:0,color:1},{r:1,c:0,color:1}],misses:3,next:1});
  await page.evaluate(()=>gameTest.settle(false));
  let s = await state(page);
  assert.equal(s.misses,4); assert.equal(s.next,null);
  assert.equal(await page.locator('#nextCanvas').isVisible(),false);
  assert.match(await page.locator('#nextLabel').textContent(),/NEW ROWS/);
  await page.evaluate(()=>gameTest.settle(true));
  assert.equal((await state(page)).misses,4); assert.equal((await state(page)).next,null);
  await fixture(page,{next:5}); // An extinct queued color cannot return in new rows.
  await page.evaluate(()=>gameTest.settle(false));
  s = await state(page);
  assert.equal(s.misses,0); assert.equal(s.grid.length,38);
  assert(s.grid.every(g=>g.color===1));
  assert.equal(s.grid.filter(g=>g.r===0).length,18);
  assert.equal(s.grid.filter(g=>g.r===1).length,18);
  assert(s.grid.some(g=>g.r===3));
  for(const count of [1,3]){
    await fixture(page,{grid:[{r:0,c:3,color:1}],rules:{rowsAdded:count},misses:4,parity:0,next:null});
    const before = await page.evaluate(()=>gameTest.position(0,3));
    await page.evaluate(()=>gameTest.settle(false));
    const after = await page.evaluate(count=>gameTest.position(count,3),count);
    assert.equal(after.x,before.x); assert.equal(after.y,before.y+count*36);
  }
}));

test('matched and falling ghosts score together, show count, and preserve last chance', async () => withPage(async page => {
  await start(page);
  await fixture(page,{grid:[{r:0,c:0,color:0},{r:0,c:1,color:0},{r:0,c:2,color:0},
    {r:1,c:0,color:1},{r:0,c:10,color:2}],misses:4,next:null});
  await page.evaluate(()=>{const p=gameTest.position(0,3);gameTest.snap(p.x,p.y,0,{r:0,c:2,color:0})});
  assert((await state(page)).reaction);
  await page.evaluate(()=>gameTest.update(1));
  const s = await state(page);
  assert.equal(s.points,715); assert.equal(s.misses,4);
  assert.equal(s.grid.length,1); assert.equal(s.loaded,2); assert.equal(s.next,null);
  assert.equal(s.popText[0].text,'5x +715');
}));

test('Classic win/loss formulas, top ten sorting, no duplicate finish, and persistence', async () => withPage(async page => {
  await start(page);
  assert.equal(await page.evaluate(()=>gameTest.scoreValue(10000,4,true,gameTest.CLASSIC)),125000);
  assert.equal(await page.evaluate(()=>gameTest.scoreValue(10000,4,false,gameTest.CLASSIC)),1250);
  for(let i=1;i<=12;i++){
    await fixture(page,{points:i*1000,shots:4,ended:false});
    await page.evaluate(()=>gameTest.finish(false));
  }
  await page.evaluate(()=>gameTest.finish(false));
  const scores = await page.evaluate(()=>gameTest.records('classic'));
  assert.equal(scores.length,10); assert.equal(scores[0].score,1500); assert.equal(scores[9].score,375);
  await page.reload();
  await page.locator('#showScores').click();
  assert.equal(await page.locator('#scoreRows tr').count(),10);
}));

test('random colors are sampled independently without hue spacing and survive reload', async () => withPage(async page => {
  assert.equal(await page.evaluate(()=>{
    for(let count=1;count<=36;count++)for(let n=0;n<50;n++)if(!gameTest.validPalette(gameTest.createPalette(count),count))return false;
    return true;
  }),true);
  await page.evaluate(()=>{window.savedRandom=Math.random;Math.random=()=>.125});
  await page.locator('#randomize').click();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pacGhostPop.palettes.v1'))[6]),Array(6).fill('#200000'));
  await page.evaluate(()=>{Math.random=window.savedRandom});
  const colors = await page.locator('.swatch').evaluateAll(els=>els.map(el=>el.style.background));
  await page.reload();
  assert.deepEqual(await page.locator('.swatch').evaluateAll(els=>els.map(el=>el.style.background)),colors);
}));

test('actual shots bounce freely, guide stops at its limit, and collision tolerance permits near misses', async () => withPage(async page => {
  await start(page);
  await fixture(page,{grid:[]});
  const result = await page.evaluate(()=>{
    const {R,W}=gameTest.state();
    const p={x:R+.5,y:500,vx:-1,vy:0,bounces:0};
    const first=gameTest.traceStep(p,1);
    p.x=W-R-.5;p.vx=1;
    const second=gameTest.traceStep(p,1);
    const guide={x:W-R-.5,y:500,vx:1,vy:0,bounces:1};
    const limit=gameTest.traceStep(guide,1,1);
    return {first,second,p,guide,limit,R,W};
  });
  assert.equal(result.first,null);assert.equal(result.p.bounces,2);
  assert.equal(result.second,null);assert(result.p.x<result.W-result.R);
  assert.equal(result.limit.type,'limit');assert.equal(result.guide.x,result.W-result.R);
  await fixture(page,{grid:[{r:2,c:2,color:0}]});
  const lower = await page.evaluate(()=>{
    const q=gameTest.position(2,2);
    return [36.5,34].map(d=>gameTest.traceStep({x:q.x+d,y:q.y,vx:0,vy:0,bounces:0},0));
  });
  assert.equal(lower[0],null);assert.equal(lower[1].type,'ghost');
}));

test('keyboard works immediately after Play and from the page; settings controls keep their input', async () => withPage(async page => {
  await start(page);
  await page.waitForFunction(()=>document.activeElement.id==='canvas');
  const before=(await state(page)).aim;
  await page.keyboard.press('ArrowLeft');
  assert((await state(page)).aim<before);
  await page.keyboard.press('ArrowRight');
  assert.equal((await state(page)).aim,before);
  await page.keyboard.press('Space');
  assert.equal((await state(page)).shots,1);
  await page.locator('#restart').click();
  await page.evaluate(()=>document.activeElement.blur());
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  assert.equal((await state(page)).shots,1);
  await page.locator('#restart').click();
  await page.locator('#gameSettings').click();
  await page.locator('#colorblind').focus();
  await page.keyboard.press('Space');
  assert.equal((await state(page)).shots,0);
  assert.equal((await state(page)).settings.colorblind,true);
  await page.locator('#closeSettings').click();
  await page.keyboard.press('Space');
  assert.equal((await state(page)).shots,1);
  assert.match(await page.locator('#gameHint').textContent(),/Shots that pop ghosts delay the row counter\.$/);
}));

test('settings default off/fast, persist, and gate large centered numbers on every shot display', async () => withPage(async page => {
  await start(page);
  assert.deepEqual((await state(page)).settings,{colorblind:false,colorAssist:false,speed:'fast',playerName:''});
  const capture=()=>page.evaluate(()=>{
    const result=[],prototype=CanvasRenderingContext2D.prototype,original=prototype.fillText;
    prototype.fillText=function(text,x,y){result.push({text:String(text),x,y,font:this.font,canvas:this.canvas.id});return original.apply(this,arguments)};
    try{gameTest.draw();gameTest.drawNextPreview()}finally{prototype.fillText=original}
    return result;
  });
  assert.equal((await capture()).filter(r=>/^\d+$/.test(r.text)).length,0);
  assert.equal(await page.locator('#nextInfo').textContent(),'Upcoming shot');
  await page.locator('#gameSettings').click();
  await page.locator('#colorblind').check();
  await page.locator('#colorAssist').check();
  await page.locator('#gameSpeed').selectOption('slow');
  await page.locator('#closeSettings').click();
  const numbers=(await capture()).filter(r=>/^\d+$/.test(r.text));
  assert(numbers.length>50);assert(numbers.some(r=>r.canvas==='nextCanvas'));
  assert(numbers.filter(r=>r.x===0&&r.y===0).every(r=>parseFloat(r.font.match(/([\d.]+)px/)[1])>20));
  const s=await state(page);
  assert(numbers.some(r=>r.x===s.SHOOT.x&&r.y===s.SHOOT.y));
  assert.match(await page.locator('#nextInfo').textContent(),/Ghost color/);
  await page.reload();await page.locator('#openSettings').click();
  assert.equal(await page.locator('#colorblind').isChecked(),true);
  assert.equal(await page.locator('#colorAssist').isChecked(),true);
  assert.equal(await page.locator('#gameSpeed').inputValue(),'slow');
}));

test('Fast and Slow use the requested travel and mouth-animation rates', async () => withPage(async page => {
  await start(page);
  for(const [speed,distance,age] of [['fast',84.5,.1],['slow',45.5,.05]]){
    await fixture(page,{grid:[],loaded:0,shots:0,settings:{speed}});
    const before=(await state(page)).SHOOT.y;
    await page.evaluate(()=>{gameTest.fire();gameTest.update(.1)});
    const s=await state(page);
    assert(Math.abs(before-s.projectile.y-distance)<.000001);
    assert(Math.abs(s.projectile.age-age)<.000001);
  }
}));

test('color assist has a 0.7/0.3 pulse, cyan next, orange others, and respects last chance', async () => withPage(async page => {
  await start(page);
  await fixture(page,{loaded:0,next:1,misses:0,assistTime:0,settings:{colorAssist:true}});
  const colors=()=>page.evaluate(()=>[0,1,2].map(gameTest.displayColor));
  assert.deepEqual(await colors(),['#153d99','#00d9ff','#ff9c38']);
  await fixture(page,{assistTime:.699});assert.equal((await colors())[0],'#153d99');
  await fixture(page,{assistTime:.7});assert.equal((await colors())[0],'#ffffff');
  await fixture(page,{assistTime:.999});assert.equal((await colors())[0],'#ffffff');
  await fixture(page,{assistTime:1});assert.equal((await colors())[0],'#153d99');
  await fixture(page,{misses:4});assert.equal((await colors())[1],'#ff9c38');
  await fixture(page,{next:0,misses:0,assistTime:.8});assert.equal((await colors())[0],'#ffffff');
  await fixture(page,{loaded:null,next:1,assistTime:.2,projectile:{color:0}});
  assert.deepEqual(await colors(),['#153d99','#00d9ff','#ff9c38']);
}));

test('qualifying scores accept a safe inline name, remember it, and show it after reload', async () => withPage(async page => {
  await start(page);await fixture(page,{points:10000,shots:4});
  await page.evaluate(()=>gameTest.finish(true));
  assert.equal(await page.locator('#nameForm').isVisible(),true);
  await page.locator('#playerName').fill('Alex <b>Ghost</b>');
  await page.locator('#nameForm button').click();
  assert.equal(await page.locator('#nameForm').isVisible(),false);
  assert.equal(await page.evaluate(()=>gameTest.records('classic')[0].name),'Alex <b>Ghost</b>');
  await page.reload();await page.locator('#showScores').click();
  assert.equal(await page.locator('#scoreRows td').nth(1).textContent(),'Alex <b>Ghost</b>');
  assert.equal(await page.locator('#scoreRows b').count(),0);
  await page.locator('#scoresBack').click();await start(page);
  await fixture(page,{points:10000,shots:4});await page.evaluate(()=>gameTest.finish(false));
  assert.equal(await page.locator('#playerName').inputValue(),'Alex <b>Ghost</b>');
  await fixture(page,{ended:false,points:0,shots:1});
  await page.evaluate(()=>{
    const s=gameTest.state();s.highScores.classic=Array.from({length:10},(_,i)=>({score:1000+i,points:1000+i,shots:1,win:false,date:new Date().toISOString()}));
    gameTest.finish(false);
  });
  assert.equal(await page.locator('#nameForm').isVisible(),false);
}));

test('arrow hold repeats after 100 ms with finer press and repeat angles, and stops on release or blur', async () => withPage(async page => {
  await start(page);
  const initial=(await state(page)).aim;
  await page.keyboard.down('ArrowLeft');
  assert(Math.abs((await state(page)).aim-(initial-.025))<1e-9);
  await page.evaluate(()=>gameTest.update(.099));
  assert(Math.abs((await state(page)).aim-(initial-.025))<1e-9);
  await page.evaluate(()=>gameTest.update(.001));
  assert(Math.abs((await state(page)).aim-(initial-.025-.015))<1e-9);
  await page.evaluate(()=>gameTest.update(.05));
  assert(Math.abs((await state(page)).aim-(initial-.025-3*.015))<1e-9);
  // An OS repeat must not add an extra turn on top of the game's repeat clock.
  await page.keyboard.down('ArrowLeft');
  const held=(await state(page)).aim;
  await page.keyboard.up('ArrowLeft');
  await page.evaluate(()=>gameTest.update(.5));
  assert.equal((await state(page)).aim,held);
  await page.keyboard.down('ArrowRight');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  const blurred=(await state(page)).aim;
  await page.evaluate(()=>gameTest.update(.5));
  assert.equal((await state(page)).aim,blurred);
  await page.keyboard.up('ArrowRight');
}));

test('right and middle clicks do not shoot, while a left click still shoots', async () => withPage(async page => {
  await start(page);
  await page.locator('#canvas').click({button:'right',position:{x:100,y:150}});
  assert.equal((await state(page)).shots,0);
  await page.locator('#canvas').click({button:'middle',position:{x:100,y:150}});
  assert.equal((await state(page)).shots,0);
  await page.locator('#canvas').click({button:'left',position:{x:100,y:150}});
  assert.equal((await state(page)).shots,1);
}));

test('chain reaction follows connections in timed waves before dropping loose ghosts and scoring', async () => withPage(async page => {
  await start(page);
  await fixture(page,{grid:[{r:2,c:3,color:0},{r:2,c:4,color:0},{r:3,c:4,color:0},
    {r:4,c:4,color:0},{r:4,c:3,color:0},{r:4,c:2,color:0},
    {r:4,c:1,color:1},{r:0,c:10,color:2}],loaded:0,next:null,misses:4,shots:1});
  await page.evaluate(()=>{const p=gameTest.position(2,2);gameTest.snap(p.x,p.y,0,{r:2,c:3,color:0})});
  let s=await state(page);
  assert.equal(s.reaction.index,1);
  assert(!s.grid.some(g=>g.r===2&&g.c===2)); // The shot itself pops first.
  assert(s.grid.some(g=>g.r===2&&g.c===3));
  assert.equal(s.points,0);assert.equal(s.misses,4);
  await page.evaluate(()=>gameTest.fire());assert.equal((await state(page)).shots,1);
  await page.evaluate(()=>gameTest.update(.084));
  assert.equal((await state(page)).reaction.index,1);
  await page.evaluate(()=>gameTest.update(.001));
  s=await state(page);
  assert.equal(s.reaction.index,2);assert(!s.grid.some(g=>g.r===2&&g.c===3));
  await page.evaluate(()=>gameTest.update(.085));
  s=await state(page);
  assert(!s.grid.some(g=>g.r===2&&g.c===4)); // Farther in space, earlier in the connection path.
  assert(s.grid.some(g=>g.r===4&&g.c===2));
  assert(s.grid.some(g=>g.r===4&&g.c===1)); // Loose ghosts wait until the matching wave finishes.
  await page.evaluate(()=>gameTest.update(.425));
  s=await state(page);
  assert.equal(s.reaction,null);assert.equal(s.misses,4);
  assert.equal(s.grid.length,1);assert.equal(s.grid[0].color,2);
  assert.equal(s.points,1855);assert.equal(s.popText[0].text,'8x +1,855');
  assert.equal(s.loaded,2);assert.equal(s.next,null);
}));

test('win waits for the reaction and restarting cancels a pending chain', async () => withPage(async page => {
  await start(page);
  const setup=async()=>{
    await fixture(page,{grid:[{r:0,c:0,color:0},{r:0,c:1,color:0}],loaded:0,next:0,shots:1});
    await page.evaluate(()=>{const p=gameTest.position(0,2);gameTest.snap(p.x,p.y,0,{r:0,c:1,color:0})});
  };
  await setup();assert.equal((await state(page)).ended,false);
  await page.evaluate(()=>gameTest.update(.17));
  assert.equal((await state(page)).grid.length,0);assert.equal((await state(page)).ended,false);
  await page.evaluate(()=>gameTest.update(.085));
  assert.equal((await state(page)).ended,true);
  assert.equal((await state(page)).points,300);
  await page.locator('#again').click();await setup();
  await page.locator('#restart').click();
  await page.evaluate(()=>gameTest.update(2));
  const s=await state(page);assert.equal(s.reaction,null);assert.equal(s.points,0);assert.equal(s.misses,0);
}));

test('Easy and Super-Easy inherit Classic with requested colors/rows and separate saved leaderboards', async () => withPage(async page => {
  for(const [mode,name,colors,rowsAdded] of [['easy','Easy',5,2],['super-easy','Super-Easy',4,1]]){
    await page.locator(`[data-mode="${mode}"]`).click();
    assert.equal(await page.locator('#play').textContent(),'Play '+name);
    assert.equal(await page.locator('.swatch').count(),colors);
    await start(page);
    const s=await state(page);
    assert.deepEqual(s.rules,{...await page.evaluate(()=>gameTest.CLASSIC),colors,rowsAdded,rowEvery:7});
    assert(s.grid.every(g=>g.color<colors));
    await fixture(page,{grid:[{r:0,c:0,color:0}],misses:5,next:0});
    await page.evaluate(()=>gameTest.settle(false));
    assert.equal((await state(page)).misses,6);assert.equal((await state(page)).next,null);
    await page.evaluate(()=>gameTest.settle(false));
    assert.equal((await state(page)).misses,0);
    assert.equal((await state(page)).grid.length,1+18*rowsAdded);
    await fixture(page,{points:10000,shots:4});await page.evaluate(()=>gameTest.finish(false));
    await page.locator('#endMenu').click();await page.locator('#showScores').click();
    assert.equal(await page.locator('#scoresTitle').textContent(),name+' · Top 10');
    assert.equal(await page.locator('#scoreRows tr').count(),1);
    await page.locator('#scoresBack').click();
  }
  const scores=await page.evaluate(()=>JSON.parse(localStorage.getItem('pacGhostPop.scores.v1')));
  assert.equal(scores.easy.length,1);assert.equal(scores['super-easy'].length,1);assert.equal(scores.classic,undefined);
  await page.reload();await page.locator('[data-mode=easy]').click();await page.locator('#showScores').click();
  assert.equal(await page.locator('#scoreRows tr').count(),1);
}));

async function connectFakePad(page) {
  await page.evaluate(()=>{
    window.testPad={index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
    window.testPads=[window.testPad];
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.testPads});
    gameTest.pollGamepads(.016);
  });
}
async function padButton(page,index,pressed,value=pressed?1:0) {
  await page.evaluate(({index,pressed,value})=>{
    window.testPad.buttons[index]={pressed,value};gameTest.pollGamepads(.016);
  },{index,pressed,value});
}

test('both gamepad sticks aim with a deadzone; south and either analog trigger fire once per press', async () => withPage(async page => {
  await start(page);await connectFakePad(page);
  const initial=(await state(page)).aim;
  await page.evaluate(()=>{testPad.axes=[.1,.1,0,0];gameTest.pollGamepads(.016)});
  assert.equal((await state(page)).aim,initial);
  await page.evaluate(()=>{testPad.axes=[-.7,-.7,0,0];gameTest.pollGamepads(.016)});
  assert(Math.abs((await state(page)).aim+Math.PI*.75)<1e-9);
  await page.evaluate(()=>{testPad.axes=[0,0,.7,-.7];gameTest.pollGamepads(.016)});
  assert(Math.abs((await state(page)).aim+Math.PI*.25)<1e-9);
  await page.evaluate(()=>{testPad.axes=[0,0,1,0];gameTest.pollGamepads(.016)});
  assert.equal((await state(page)).aim,-.13);
  await page.evaluate(()=>{testPad.axes=[0,0,-1,0];gameTest.pollGamepads(.016)});
  assert.equal((await state(page)).aim,-Math.PI+.13);
  await padButton(page,0,true);assert.equal((await state(page)).shots,1);
  await fixture(page,{loaded:0}); // Settle flight; continuing to hold cannot auto-fire.
  await page.evaluate(()=>gameTest.pollGamepads(.5));assert.equal((await state(page)).shots,1);
  await padButton(page,0,false);
  await padButton(page,0,true);assert.equal((await state(page)).shots,2);
  await padButton(page,0,false);
  for(const button of [6,7]){
    await fixture(page,{loaded:0,shots:0});
    await padButton(page,button,false,.4);assert.equal((await state(page)).shots,0);
    await padButton(page,button,true,.8);assert.equal((await state(page)).shots,1);
    await fixture(page,{loaded:0});
    await page.evaluate(()=>gameTest.pollGamepads(.1));assert.equal((await state(page)).shots,1);
    await padButton(page,button,false,0);
  }
}));

test('gamepad navigates modes, launches Play without an extra shot, and opens/closes settings', async () => withPage(async page => {
  await connectFakePad(page);
  await padButton(page,15,true);await padButton(page,15,false);
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.mode),'classic');
  await padButton(page,15,true);await padButton(page,15,false);
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.mode),'easy');
  await padButton(page,0,true);await padButton(page,0,false);
  assert.equal(await page.locator('#play').textContent(),'Play Easy');
  await page.locator('#play').focus();
  await padButton(page,0,true);
  assert.equal((await state(page)).activeMode,'easy');assert.equal((await state(page)).shots,0);
  await page.evaluate(()=>gameTest.pollGamepads(.2));assert.equal((await state(page)).shots,0);
  await padButton(page,0,false);
  await padButton(page,9,true);await padButton(page,9,false);
  assert.equal(await page.locator('#settingsDialog').evaluate(el=>el.open),true);
  await page.locator('#gameSpeed').focus();
  await padButton(page,15,true);await padButton(page,15,false);
  assert.equal((await state(page)).settings.speed,'slow');
  await padButton(page,1,true);await padButton(page,1,false);
  assert.equal(await page.locator('#settingsDialog').evaluate(el=>el.open),false);
  assert.equal((await state(page)).shots,0);
  await padButton(page,0,true);assert.equal((await state(page)).shots,1);
}));

test('gamepad ignores busy reactions, focus loss, disconnects, and unavailable APIs safely', async () => withPage(async page => {
  await start(page);await connectFakePad(page);
  await fixture(page,{grid:[{r:0,c:0,color:0},{r:0,c:1,color:0},{r:0,c:12,color:1}],loaded:0,next:1,shots:1});
  await page.evaluate(()=>{const p=gameTest.position(0,2);gameTest.snap(p.x,p.y,0,{r:0,c:1,color:0})});
  await padButton(page,0,true);assert.equal((await state(page)).shots,1);
  await page.evaluate(()=>{gameTest.update(1);gameTest.pollGamepads(.016)});
  assert.equal((await state(page)).shots,1);
  await padButton(page,0,false);await padButton(page,0,true);
  assert.equal((await state(page)).shots,2);
  await fixture(page,{loaded:1,shots:0});
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.evaluate(()=>gameTest.pollGamepads(.1));assert.equal((await state(page)).shots,0);
  await padButton(page,0,false);await padButton(page,0,true);assert.equal((await state(page)).shots,1);
  await page.evaluate(()=>{testPads=[];gameTest.pollGamepads(.016)});
  await page.evaluate(()=>{Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>{throw new DOMException('Unavailable','SecurityError')}});gameTest.pollGamepads(.016)});
  await page.evaluate(()=>{Object.defineProperty(navigator,'getGamepads',{configurable:true,value:undefined});gameTest.pollGamepads(.016)});
}));

test('combo popup and bonus follow Custom match minimums above and below three', async () => withPage(async page => {
  await start(page);
  for(const [minimum,matched,loose,expected,text] of [
    [2,2,0,200,'+200'],[2,3,0,405,'3x +405'],
    [4,4,0,400,'+400'],[4,5,0,675,'5x +675'],
    [5,5,0,500,'+500'],[5,6,0,810,'6x +810'],
    [5,5,1,675,'6x +675'],[5,4,0,0,null]
  ]){
    const grid=Array.from({length:matched-1},(_,c)=>({r:0,c,color:0}));
    grid.push({r:0,c:14,color:1});if(loose)grid.push({r:1,c:0,color:2});
    await fixture(page,{grid,loaded:0,next:1,points:0,shots:1,rules:{matchSize:minimum}});
    await page.evaluate(matched=>{const p=gameTest.position(0,matched-1);gameTest.snap(p.x,p.y,0,{r:0,c:matched-2,color:0});gameTest.update(2)},matched);
    const s=await state(page);assert.equal(s.points,expected,`minimum=${minimum}, matched=${matched}, loose=${loose}`);
    assert.equal(s.popText[0]?.text??null,text);
  }
}));

test('actual game runs and fits desktop, portrait and live landscape rotation', async () => withPage(async page => {
  await page.goto(origin+'/actual');
  await start(page);
  const outputs = path.join(__dirname,'..','.test-artifacts');
  fs.mkdirSync(outputs,{recursive:true});
  for(const [name,width,height] of [['desktop',1365,900],['portrait',390,844],['landscape',844,390]]){
    await page.setViewportSize({width,height});
    await page.waitForTimeout(100);
    const box = await page.locator('#canvas').boundingBox();
    const sizes = await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));
    assert(box.width>150 && box.height>150,`${name}: usable canvas`);
    assert(box.y+box.height<=height,`${name}: canvas within viewport`);
    assert(sizes.w<=width,`${name}: no horizontal overflow`);
    assert(sizes.h<=height,`${name}: no vertical overflow (${sizes.h} > ${height})`);
    assert.equal(await page.locator('#shots').textContent(),'0');
    const queue=await page.locator('#shotQueue').boundingBox();
    const shooterX=box.x+box.width/2;
    assert(queue.x>shooterX,`${name}: next shot is right of launcher`);
    assert(queue.x+queue.width<=box.x+box.width,`${name}: preview fits inside board`);
    assert(queue.y>box.y+box.height*.8&&queue.y+queue.height<=box.y+box.height,`${name}: preview is beside launcher at bottom`);
    assert.doesNotMatch(await page.locator('#gameHint').textContent(),/bounce max/);
    await page.screenshot({path:path.join(outputs,name+'.png'),fullPage:true});
  }
  const box = await page.locator('#canvas').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.8);
  await page.mouse.down();
  assert.equal(await page.locator('#shots').textContent(),'0');
  await page.mouse.move(box.x+box.width*.6,box.y+box.height*.3);
  await page.mouse.up();
  assert.equal(await page.locator('#shots').textContent(),'1');
  await page.waitForTimeout(1400);
}));
