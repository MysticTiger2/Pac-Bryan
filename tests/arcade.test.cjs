const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),key='tigerArcade.quarters.v1';
let server,browser,base;
before(async()=>{
  server=http.createServer((req,res)=>{
    let route=new URL(req.url,'http://localhost').pathname;
    if(!route.startsWith('/Pac-Bryan/')){res.writeHead(404);return res.end()}
    route=route.slice('/Pac-Bryan/'.length)||'index';
    if(!path.extname(route))route+='.html';
    const target=path.resolve(root,route);
    if(!target.startsWith(root+path.sep)){res.writeHead(403);return res.end()}
    fs.readFile(target,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':route.endsWith('.js')?'text/javascript':route.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(error?'Not found':data)});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}/Pac-Bryan/`;
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:process.platform==='win32'?{channel:'msedge'}:{})});
  fs.mkdirSync(path.join(root,'.test-artifacts'),{recursive:true});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve))});
async function withPage(fn,options={}){
  const context=await browser.newContext({viewport:{width:1280,height:950},...options}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{await page.goto(base);await fn(page,context);assert.deepEqual(errors,[])}finally{await context.close()}
}
const balance=page=>page.evaluate(()=>Arcade.balance());
const idle=page=>page.waitForFunction(()=>!Arcade.busy);
const seed=(page,value)=>page.evaluate(({key,value})=>localStorage.setItem(key,String(value)),{key,value});
const clickerKey='tigerArcade.quartersPlease.v1';
const clickerState=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),clickerKey);
const seedClicker=(page,values)=>page.evaluate(({key,values})=>{
  localStorage.setItem(key,JSON.stringify({temperature:0,updatedAt:Date.now(),brokenAt:null,alloy:0,ac:0,ear:0,...values}));
  dispatchEvent(new StorageEvent('storage',{key}));
},{key:clickerKey,values});
async function earn(page){
  const before=await balance(page);
  await page.locator('#quarter').click();
  await page.waitForFunction(before=>Arcade.balance()>before,before);
}
async function start(page){await page.locator('#play').click();await idle(page)}

test('direct-file home links open index.html and game cards resolve to real files',async()=>withPage(async page=>{
  const home=pathToFileURL(path.join(root,'index.html')).href;
  for(const game of ['ghost-pop','dad-dug','eviction','quarters-please']){
    await page.goto(pathToFileURL(path.join(root,game+'.html')).href);
    const homeLink=page.getByRole('link',{name:game==='quarters-please'?'Back to home':'Other Games',exact:true});
    assert.equal(await homeLink.getAttribute('href'),home);
    await homeLink.click();assert.equal(page.url(),home);
    assert.equal(await page.title(),'Tiger’s Arcade');
    const name=game==='ghost-pop'?'Play Ghost Pop':game==='dad-dug'?'Play Dad Dug':game==='eviction'?'Play Eviction':'Open Quarters Please';
    const destination=pathToFileURL(path.join(root,game+'.html')).href;
    assert.equal(await page.getByRole('link',{name,exact:true}).evaluate(el=>el.href),destination);
    await page.getByRole('link',{name,exact:true}).click();assert.equal(page.url(),destination);
  }
  await page.goto(home+'?preview=1#quarters-please');
  assert.equal(page.url(),home+'?preview=1#quarters-please','direct files retain their real path so refreshing works');
  await page.reload();assert.equal(await page.locator('.card').count(),6);
}));

test('shared credits start at 5 and persist across every playable arcade game and the project root',async()=>withPage(async page=>{
  assert.equal(await balance(page),5);
  assert.equal(await page.locator('[data-arcade-wallet]').textContent(),'5 quarters');
  assert.deepEqual(await page.locator('.genre').allTextContents(),['ARCADE / BUBBLE SHOOTER','ARCADE / DIGGING','ARCADE / TERRITORY','ARCADE / MAZE CHASE','ARCADE / META / CLICKER','IDLER / TOWER DEFENSE']);
  for(const [i,game] of ['ghost-pop','dad-dug','eviction'].entries()){
    await page.goto(base+game);
    assert.equal(await page.getByRole('link',{name:'Other Games',exact:true}).evaluate(el=>el.href),base);
    await page.locator('#play').click();
    await page.locator('.arcade-insert').waitFor({state:'visible'});
    await idle(page);
    assert.equal(await balance(page),4-i);
    await page.getByRole('link',{name:'Other Games',exact:true}).click();
    assert.equal(page.url(),base);
    assert.equal(await balance(page),4-i);
  }
  await page.reload();assert.equal(await balance(page),2);
}));

test('last quarter permits a game, retries at zero are blocked, and get more quarters opens the free Quarters Please page',async()=>withPage(async page=>{
  await seed(page,1);await page.goto(base+'ghost-pop');
  await start(page);assert.equal(await balance(page),0);
  assert.equal(await page.locator('#gameScreen').isVisible(),true);
  await page.locator('#restart').click();
  await page.getByRole('dialog',{name:'Out of quarters'}).waitFor();
  assert.equal(await balance(page),0);
  await page.getByRole('link',{name:'get more quarters',exact:true}).click();
  assert.equal(page.url(),base+'quarters-please.html');
  assert.equal(await balance(page),0);
  assert.equal(await page.locator('#quarter').isEnabled(),true);
  for(const game of ['dad-dug','eviction','ghost-pop']){
    await page.goto(base+game);await start(page);
    assert.equal(await page.getByRole('dialog',{name:'Out of quarters'}).isVisible(),true);
    assert.equal(await page.locator('#overlay').isVisible(),game!=='ghost-pop');
    assert.equal(await balance(page),0);
  }
  await page.screenshot({path:path.join(root,'.test-artifacts','arcade-out-of-quarters.png')});
}));

test('restarts spend once, rapid duplicate starts do not double charge, and pause/resume is free',async()=>withPage(async page=>{
  await seed(page,6);
  for(const game of ['ghost-pop','dad-dug','eviction']){
    await page.goto(base+game);const before=await balance(page);
    await page.evaluate(()=>{document.querySelector('#play').click();document.querySelector('#play').click()});
    await idle(page);assert.equal(await balance(page),before-1);
    if(game==='ghost-pop')await page.locator('#restart').click();
    else{await page.locator('#pause').click();await start(page);assert.equal(await balance(page),before-1);await page.locator('#pause').click();await page.locator('#restart').click()}
    await idle(page);assert.equal(await balance(page),before-2);
  }
}));

test('tabs compete safely for the last quarter and update the displayed balance',async()=>withPage(async(page,context)=>{
  await seed(page,1);await page.goto(base+'dad-dug');const other=await context.newPage();await other.goto(base+'eviction');
  await Promise.all([page.locator('#play').click(),other.locator('#play').click()]);
  await Promise.all([idle(page),idle(other)]);
  assert.equal(await balance(page),0);assert.equal(await balance(other),0);
  const dialogs=await Promise.all([page.getByRole('dialog',{name:'Out of quarters'}).isVisible(),other.getByRole('dialog',{name:'Out of quarters'}).isVisible()]);
  assert.equal(dialogs.filter(Boolean).length,1);
  assert.equal(await page.locator('[data-arcade-wallet]').textContent(),'0 quarters');
  assert.equal(await other.locator('[data-arcade-wallet]').textContent(),'0 quarters');
}));

test('invalid custom rules do not spend credits; invalid saved balances fail closed',async()=>withPage(async page=>{
  await page.goto(base+'ghost-pop');await page.locator('[data-mode=custom]').click();
  await page.locator('#rule-colors').fill('0');await start(page);assert.equal(await balance(page),5);
  await seed(page,-1);await page.reload();await start(page);
  assert.equal(await page.getByRole('dialog',{name:'Out of quarters'}).isVisible(),true);assert.equal(await balance(page),0);
}));

test('unavailable browser storage keeps a page-local balance and usable game controls',async()=>withPage(async(page,context)=>{
  await context.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('blocked')};Storage.prototype.setItem=()=>{throw new Error('blocked')}});
  await page.goto(base+'dad-dug');assert.equal(await balance(page),5);await start(page);assert.equal(await balance(page),4);
  await page.locator('#pause').click();await page.locator('#restart').click();await idle(page);assert.equal(await balance(page),3);
}));

test('wallets and the narrower coin artwork fit phone and landscape layouts',async()=>withPage(async page=>{
  for(const viewport of [{width:360,height:800},{width:844,height:390}]){
    await page.setViewportSize(viewport);
    for(const route of ['', 'ghost-pop','dad-dug','eviction']){
      await page.goto(base+route);
      const bounds=await page.locator('[data-arcade-wallet]').boundingBox();assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=viewport.width);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
  }
  await page.setViewportSize({width:1280,height:950});await page.goto(base+'#quarters-please');
  await page.screenshot({path:path.join(root,'.test-artifacts','arcade-quarter-art.png')});
}));

test('Quarters Please is free, exposes the clicker and upgrades, and retains saved balances',async()=>withPage(async page=>{
  await seed(page,42);
  await page.getByRole('link',{name:'Open Quarters Please',exact:true}).click();
  assert.equal(page.url(),base+'quarters-please.html');
  assert.equal(await balance(page),42);
  assert.equal(await page.locator('#quarter').isEnabled(),true);
  assert.equal(await page.locator('[data-upgrade]').count(),4);
  assert.equal(await page.locator('[data-arcade-wallet]').textContent(),'42 quarters');
  assert.equal(await page.locator('.arcade-insert').isVisible(),false);
  assert.equal(await page.locator('#play,#restart').count(),0);
  await page.getByRole('link',{name:'Back to home'}).click();
  assert.equal(page.url(),base);assert.equal(await balance(page),42);
}));

test('reset uses a custom confirmation and caps quarters at five without ever adding any',async()=>withPage(async page=>{
  const nativeDialogs=[];
  page.on('dialog',dialog=>{nativeDialogs.push(dialog.type());dialog.dismiss()});
  await seed(page,42);await page.goto(base+'quarters-please.html');
  const reset=page.locator('main #reset'),dialog=page.getByRole('dialog',{name:'Are you sure?'});
  await reset.click();assert.equal(await balance(page),42);
  assert.equal(await page.locator('#cancel-reset').evaluate(el=>el===document.activeElement),true);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await balance(page),42);assert.equal(await dialog.isVisible(),false);
  await reset.click();await page.keyboard.press('Escape');assert.equal(await balance(page),42);
  for(const current of [42,5,3,0]){
    await seed(page,current);await reset.click();
    await dialog.getByRole('button',{name:'reset',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal(await balance(page),Math.min(5,current));
    await page.reload();assert.equal(await balance(page),Math.min(5,current));
  }
  // Confirmation must use the latest balance, including changes made while it was open.
  await seed(page,42);await reset.click();await seed(page,2);
  await dialog.getByRole('button',{name:'reset',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(await balance(page),2);assert.deepEqual(nativeDialogs,[]);
  await page.setViewportSize({width:360,height:800});await reset.click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(root,'.test-artifacts','quarters-please-confirm.png')});
}));

test('clicks earn shared quarters, heat by 20 degrees, and cool at the correct elapsed-time rate',async()=>withPage(async page=>{
  const now=new Date('2026-10-24T12:00:00Z');
  await page.clock.setFixedTime(now);
  await page.goto(base+'quarters-please.html');
  await earn(page);assert.equal(await balance(page),6);
  assert.equal((await clickerState(page)).temperature,20);
  assert.equal(await page.locator('#temperature').textContent(),'20° / 50°');
  await page.clock.setFixedTime(new Date(+now+10000));
  await page.waitForFunction(()=>document.querySelector('#temperature').textContent==='10° / 50°');
  await earn(page);assert.equal((await clickerState(page)).temperature,30);
  await page.goto(base);assert.equal(await page.locator('[data-arcade-wallet]').textContent(),'7 quarters');
  await page.clock.setFixedTime(new Date(+now+25000));
  await page.goto(base+'quarters-please.html');assert.equal(await page.locator('#temperature').textContent(),'15° / 50°');
  await seedClicker(page,{temperature:40,ac:2});
  await page.clock.setFixedTime(new Date(+now+30000));
  await page.waitForFunction(()=>document.querySelector('#temperature').textContent==='15° / 50°');
  await page.clock.setFixedTime(new Date(+now+60000));
  await page.waitForFunction(()=>document.querySelector('#temperature').textContent==='0° / 50°');
}));

test('exceeding (not reaching) the heat limit shatters the coin; repair survives reloads and time away',async()=>withPage(async(page,context)=>{
  const now=new Date('2026-10-24T12:00:00Z');await page.clock.setFixedTime(now);
  await page.goto(base+'quarters-please.html');await seedClicker(page,{temperature:30});
  await earn(page);assert.equal(await page.locator('#quarter').isEnabled(),true);assert.equal((await clickerState(page)).temperature,50);
  await earn(page);const broken=await clickerState(page);assert.equal(broken.brokenAt,+now);assert.equal(await balance(page),7);
  assert.equal(await page.locator('#quarter').isDisabled(),true);assert.equal(await page.locator('.shard').count(),32);
  await page.evaluate(()=>document.querySelector('#quarter').click());assert.equal(await balance(page),7);
  await page.clock.setFixedTime(new Date(+now+30000));await page.reload();
  assert.equal(await page.locator('#quarter').isDisabled(),true);assert.equal(await page.locator('#repair-countdown').textContent(),'30s');
  assert.equal(await page.locator('#temperature').textContent(),'40° / 50°','shards cool while their repair timer continues');
  const scatter=await page.locator('#coin-stage').evaluate(el=>Number(el.style.getPropertyValue('--scatter')));assert(scatter>0&&scatter<1);
  await page.screenshot({path:path.join(root,'.test-artifacts','quarters-please-repair.png'),fullPage:true});
  const other=await context.newPage();await other.clock.setFixedTime(new Date(+now+59000));await other.goto(base+'quarters-please.html');
  assert.equal(await other.locator('#quarter').isDisabled(),true);assert.equal(await other.locator('#repair-countdown').textContent(),'1s');
  await page.goto(base);await page.clock.setFixedTime(new Date(+now+60000));await page.goto(base+'quarters-please.html');
  assert.equal(await page.locator('#quarter').isEnabled(),true);assert.equal(await page.locator('#temperature').textContent(),'0° / 50°');
  await earn(page);assert.equal(await balance(page),8);assert.equal((await clickerState(page)).brokenAt,null);
}));

test('upgrades spend shared quarters at successive rounded prices and persist',async()=>withPage(async page=>{
  await seed(page,1000);await page.goto(base+'quarters-please.html');
  for(const [name,spent,next] of [['alloy',10,20],['alloy',20,40],['ac',10,20],['ear',25,45],['ear',45,81],['ear',81,146]]){
    const before=await balance(page);await page.locator('#buy-'+name).click();
    await page.waitForFunction(expected=>Arcade.balance()===expected,before-spent);
    assert.equal(await page.locator('#buy-'+name).textContent(),`Buy · ${next} quarters`);
  }
  assert.equal(await balance(page),809);await page.reload();
  const state=await clickerState(page);assert.equal(state.alloy,2);assert.equal(state.ac,1);assert.equal(state.ear,3);
  assert.equal(await page.locator('#temperature').textContent(),'0° / 100°');assert.equal(await page.locator('#cooling').textContent(),'−3°');
  await earn(page);assert.equal(await balance(page),813);
  await page.goto(base+'dad-dug');await start(page);assert.equal(await balance(page),812);
}));

test('alloy and AC stop at their caps; ear keeps granting earnings past the 10-coin visual cap',async()=>withPage(async page=>{
  await seed(page,100000000);await page.goto(base+'quarters-please.html');
  await seedClicker(page,{alloy:9,ac:19,ear:9});
  await page.locator('#buy-alloy').click();await page.waitForFunction(()=>document.querySelector('#buy-alloy').textContent==='Fully upgraded');
  await page.locator('#buy-ac').click();await page.waitForFunction(()=>document.querySelector('#buy-ac').textContent==='Fully upgraded');
  assert.equal(await page.locator('#buy-alloy').isDisabled(),true);assert.equal(await page.locator('#buy-ac').isDisabled(),true);
  assert.equal(await page.locator('#cooling').textContent(),'−41°');assert.equal(await page.locator('#temperature').textContent(),'0° / 300°');
  await page.locator('#buy-ear').click();await page.waitForFunction(()=>document.querySelector('#per-click').textContent==='+11');
  const before=await balance(page);await earn(page);assert.equal(await balance(page),before+11);
  assert.equal(await page.locator('.flying-quarter').count(),10);assert.equal((await clickerState(page)).ear,10);
  await page.locator('#buy-ear').click();await page.waitForFunction(()=>document.querySelector('#per-click').textContent==='+12');
  await page.screenshot({path:path.join(root,'.test-artifacts','quarters-please-upgraded.png'),fullPage:true});
}));

test('coin finish, relative heat color, and AC wind change with upgrade levels',async()=>withPage(async page=>{
  await page.clock.setFixedTime(new Date('2026-10-24T12:00:00Z'));await page.goto(base+'quarters-please.html');
  const face=()=>page.locator('#coin-stage').evaluate(el=>el.style.getPropertyValue('--coin-face'));
  const silver=await face();await seedClicker(page,{alloy:5});assert.notEqual(await face(),silver);
  await seedClicker(page,{temperature:25});const halfHot=await face();
  await seedClicker(page,{temperature:50,alloy:2});
  // Both quarters are at 50% of their own limit. The same heat amount is mixed into each finish.
  const upgraded=await face();assert.notEqual(upgraded,halfHot);
  await seedClicker(page,{temperature:100,alloy:2});assert.equal(await face(),'rgb(255 65 32)');
  await seedClicker(page,{ac:1});assert.equal(await page.locator('.wind-streak').count(),3);
  const low=await page.locator('.wind-streak').first().evaluate(el=>({speed:parseFloat(el.style.getPropertyValue('--speed')),length:parseFloat(el.style.getPropertyValue('--length'))}));
  await seedClicker(page,{ac:20});assert.equal(await page.locator('.wind-streak').count(),60);
  const high=await page.locator('.wind-streak').first().evaluate(el=>({speed:parseFloat(el.style.getPropertyValue('--speed')),length:parseFloat(el.style.getPropertyValue('--length'))}));
  assert(high.speed<low.speed);assert(high.length>low.length);
}));

test('simultaneous clicker tabs and paid games serialize earnings, heat and upgrade purchases',async()=>withPage(async(page,context)=>{
  await seed(page,10);await page.goto(base+'quarters-please.html');const other=await context.newPage();await other.goto(base+'quarters-please.html');
  await Promise.all([page.locator('#buy-alloy').click(),other.locator('#buy-ac').click()]);
  await page.waitForFunction(()=>Arcade.balance()===0);const state=await clickerState(page);assert.equal(state.alloy+state.ac,1);
  await Promise.all([earn(page),earn(other)]);assert.equal(await balance(page),2);assert((await clickerState(page)).temperature>39);
  await other.goto(base+'dad-dug');
  await Promise.all([page.locator('#quarter').click(),start(other)]);assert.equal(await balance(page),2);
  await page.reload();assert.equal(await balance(page),2);
}));

test('unaffordable upgrades and malformed clicker data are safe; blocked storage stays playable',async()=>withPage(async(page,context)=>{
  await seed(page,0);await page.goto(base+'quarters-please.html');assert.equal(await page.locator('[data-upgrade]:disabled').count(),4);
  await page.evaluate(()=>localStorage.setItem('tigerArcade.quartersPlease.v1','{bad json'));await page.reload();
  await earn(page);assert.equal(await balance(page),1);
  await context.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('blocked')};Storage.prototype.setItem=()=>{throw new Error('blocked')}});
  await page.reload();await earn(page);assert.equal(await balance(page),6);assert.equal(await page.locator('#save-notice').isVisible(),true);
}));

test('clicker, shards, wallet and upgrades fit desktop, phone and landscape with reduced motion',async()=>withPage(async page=>{
  await page.goto(base+'quarters-please.html');
  await page.screenshot({path:path.join(root,'.test-artifacts','quarters-please-desktop.png'),fullPage:true});
  for(const viewport of [{width:360,height:800},{width:844,height:390}]){
    await page.setViewportSize(viewport);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const coin=await page.locator('#quarter').boundingBox();assert(coin&&coin.x>=0&&coin.x+coin.width<=viewport.width);
  }
  await page.setViewportSize({width:360,height:800});await page.emulateMedia({reducedMotion:'reduce'});await seedClicker(page,{ac:20,alloy:10});
  assert.equal(await page.locator('.wind-streak').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await earn(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(root,'.test-artifacts','quarters-please-mobile.png'),fullPage:true});
}));

test('Quick Fix uses all five prices and repair durations, persists, and stops at level five',async()=>withPage(async page=>{
  let now=Date.parse('2026-10-24T12:00:00Z');await page.clock.setFixedTime(new Date(now));
  await seed(page,1000);await page.goto(base+'quarters-please.html');
  // Existing saves without a repair level retain the original 60-second duration.
  await seedClicker(page,{});assert((await page.locator('#limit-note').textContent()).includes('60 seconds'));
  const costs=[10,25,50,75,100],durations=[45,30,15,10,5];
  for(let i=0;i<costs.length;i++){
    assert.equal(await page.locator('#buy-repair').textContent(),`Buy · ${costs[i]} quarters`);
    const before=await balance(page);await page.locator('#buy-repair').click();
    await page.waitForFunction(expected=>Arcade.balance()===expected,before-costs[i]);
    await page.reload();assert.equal((await clickerState(page)).repair,i+1);
    assert((await page.locator('#limit-note').textContent()).includes(`${durations[i]} seconds`));
    await earn(page);await earn(page);await earn(page);assert.equal(await page.locator('#quarter').isDisabled(),true);
    assert.equal(await page.locator('#repair-countdown').textContent(),`${durations[i]}s`);
    assert.equal(await page.locator('#repair-progress').getAttribute('max'),String(durations[i]));
    now+=durations[i]*1000-1000;await page.clock.setFixedTime(new Date(now));await page.reload();
    assert.equal(await page.locator('#quarter').isDisabled(),true);assert.equal(await page.locator('#repair-countdown').textContent(),'1s');
    now+=1000;await page.clock.setFixedTime(new Date(now));
    await page.waitForFunction(()=>!document.querySelector('#quarter').disabled);
  }
  assert.equal(await page.locator('#buy-repair').textContent(),'Fully upgraded');assert.equal(await page.locator('#buy-repair').isDisabled(),true);
  assert.equal(await balance(page),755);
}));

test('Quick Fix shortens an active repair using its saved break time across tabs',async()=>withPage(async(page,context)=>{
  const now=Date.parse('2026-10-24T12:00:00Z');await page.clock.setFixedTime(new Date(now));
  await seed(page,100);await page.goto(base+'quarters-please.html');
  await earn(page);await earn(page);await earn(page);
  const other=await context.newPage();await other.clock.setFixedTime(new Date(now+20000));await other.goto(base+'quarters-please.html');
  await other.locator('#buy-repair').click();await other.waitForFunction(()=>Arcade.balance()===93);
  assert.equal((await clickerState(other)).brokenAt,now);
  assert.equal(await other.locator('#repair-countdown').textContent(),'25s');
  await page.clock.setFixedTime(new Date(now+44000));await page.reload();
  assert.equal(await page.locator('#quarter').isDisabled(),true);assert.equal(await page.locator('#repair-countdown').textContent(),'1s');
  // A second purchase reduces the total to 30s; the 44s already elapsed completes it immediately.
  await page.locator('#buy-repair').click();await page.waitForFunction(()=>Arcade.balance()===68);
  assert.equal(await page.locator('#quarter').isEnabled(),true);await page.reload();assert.equal(await page.locator('#quarter').isEnabled(),true);
}));
