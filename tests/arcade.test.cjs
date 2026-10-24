const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
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
async function start(page){await page.locator('#play').click();await idle(page)}

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
  assert.equal(await page.locator('main').innerText(),'Back to home\nreset');
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

test('Quarters Please is free, exposes only home/reset controls, and retains saved balances',async()=>withPage(async page=>{
  await seed(page,42);
  await page.getByRole('link',{name:'Open Quarters Please',exact:true}).click();
  assert.equal(page.url(),base+'quarters-please.html');
  assert.equal(await balance(page),42);
  assert.equal(await page.locator('body').innerText(),'Back to home\nreset');
  assert.equal(await page.locator('[data-arcade-wallet]').count(),0);
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
