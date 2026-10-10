import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(path.join(process.env.TEMP,'echo-browser-verification/runner.cjs'));
const {chromium}=require('playwright');
const base=process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const visual=process.argv.includes('--visual');
const uiOnly=process.argv.includes('--ui-only');
const live=process.argv.includes('--live');
const browser=await chromium.launch({executablePath:process.env.ECHO_CHROMIUM_PATH || path.join(process.env.LOCALAPPDATA,'ms-playwright/chromium-1243/chrome-win64/chrome.exe'),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage();
if(uiOnly)await page.addInitScript(()=>localStorage.setItem('echo_selected_avatar','ember'));
const errors=[],requests=[],rigs={},layouts=[];
page.on('pageerror',e=>errors.push(e.message));
await mkdir('verification/zirumi',{recursive:true});
const select=async name=>{
 await page.getByRole('button',{name:'Characters',exact:true}).click();
 const button=page.getByRole('button',{name:`Select ${name} avatar`,exact:true});
 if(await button.getAttribute('aria-pressed')!=='true')await button.click();
 await page.waitForFunction(n=>document.querySelector(`[aria-label="Select ${n} avatar"]`)?.getAttribute('aria-pressed')==='true',name,{timeout:60000});
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
};
try {
 await page.goto(base);
 await page.getByText(/Avatar ready/).waitFor({timeout:60000});
 assert.match(await page.title(),/^ZIRUMI/);
 assert.ok(!(await page.locator('body').innerText()).includes('ECHO'));
 for(const asset of ['/zirumi-icon.svg','/manifest.webmanifest','/fonts/Manrope-Variable.ttf','/fonts/Outfit-Variable.ttf','/models/ATTRIBUTION.md']) assert.equal((await page.request.get(base+asset)).status(),200,asset);
 await page.screenshot({path:'verification/zirumi/desktop.png'});
 if(!visual) {
  if(!uiOnly) {
  await page.getByRole('button',{name:'Hold pose',exact:true}).click();
  for(const[id,name]of[['default','Aira'],['sky','Luna'],['nova','Mira'],['ember','Zyra']]) {
   await select(name);
   await page.getByText(/Avatar ready/).waitFor();
   assert.equal(await page.locator('.stage-heading h2').innerText(),name);
   const result=await page.evaluate(async url=>(await import('/scripts/avatar-probe.js')).probe(url,true),id==='default'?'/AvatarSample_W.vrm':`/models/${id}.vrm`);
   await writeFile(`public/avatars/${id}.png`,Buffer.from(result.thumbnail,'base64')); delete result.thumbnail;
   assert.ok(result.maxBlink>.9);assert.ok(result.mouthSpeaking>.1);assert.ok(result.mouthStopped<.001);assert.ok(result.heldError<.001);
   for(const bone of Object.keys(result.before))assert.deepEqual(result.after[bone].local,result.before[bone].local,`${name} rest translation`);
   rigs[id]=result;
   const box=await page.locator('.avatar-canvas canvas').boundingBox();
   const point=await page.evaluate(async args=>(await import('/scripts/avatar-probe.js')).projectPoint(args.position,args.aspect),{position:result.after.rightHand.world,aspect:box.width/box.height});
   const x=box.x+(point[0]+1)*box.width/2,y=box.y+(1-point[1])*box.height/2;
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-220,y-210,{steps:12});
   await page.getByText('Reach Limit',{exact:true}).waitFor({timeout:10000});await page.mouse.up();
   await page.screenshot({path:`verification/zirumi/${id}-interaction.png`});
   await page.getByRole('button',{name:'Reset Pose',exact:true}).click();
   console.log('PASS actual model, rig, expressions and mouse hand drag',name);
  }
  }
  await page.reload();await page.getByText(/Avatar ready/).waitFor({timeout:60000});
  assert.equal(await page.locator('.stage-heading h2').innerText(),'Zyra');
  await page.getByRole('button',{name:'Disable voice replies',exact:true}).click();
  await page.route('**/api/chat',async route=>{
   const body=route.request().postDataJSON();requests.push(body);
   if(live)return route.continue();
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({reply:requests.length===1?'It is lovely to meet you, Aster.':'Your name is Aster.'})});
  });
  await page.getByLabel('Message ZIRUMI',{exact:true}).fill('My name is Aster.');await page.getByLabel('Message ZIRUMI',{exact:true}).press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('.message-assistant').length===1 || document.querySelector('.error-message'),null,{timeout:50000});
  if (await page.locator('.error-message').count()) throw Error(await page.locator('.error-message').innerText());
  assert.equal(requests[0].avatarId,'ember');
  await select('Mira');
  await page.getByLabel('Message ZIRUMI',{exact:true}).fill('What is my name?');await page.getByLabel('Message ZIRUMI',{exact:true}).press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('.message-assistant').length===2 || document.querySelector('.error-message'),null,{timeout:50000});
  if (await page.locator('.error-message').count()) throw Error(await page.locator('.error-message').innerText());
  assert.equal(requests[1].avatarId,'nova');assert.equal(requests[1].history.length,2);assert.equal(requests[1].history[0].content,'My name is Aster.');
  assert.match(await page.locator('.message-assistant p').last().innerText(),/Aster/i);
  assert.deepEqual(await page.locator('.message-assistant .sender').allTextContents(),['Zyra','Mira']);
  await page.getByRole('button',{name:'Copy response',exact:true}).last().click();
  const clipboard=await page.evaluate(()=>navigator.clipboard.readText());assert.match(clipboard,/Aster/);
  await page.screenshot({path:'verification/zirumi/conversation.png'});
  // Reject a corrupt replacement, retain Mira, then recover using Retry.
  await page.route('**/models/sky.vrm',route=>route.fulfill({status:200,body:'invalid-model'}));
  await page.getByRole('button',{name:'Characters',exact:true}).click();await page.getByRole('button',{name:'Select Luna avatar',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.model-error'));
  assert.equal(await page.getByRole('button',{name:'Select Mira avatar',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.unroute('**/models/sky.vrm');await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.stage-heading h2')?.textContent==='Luna',null,{timeout:60000});
  assert.equal(await page.locator('.message-assistant').count(),2);
  // A delayed older load cannot override the newest selection.
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/models/nova.vrm',async route=>{await gate;await route.continue();});
  await page.getByRole('button',{name:'Characters',exact:true}).click();await page.getByRole('button',{name:'Select Mira avatar',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Select Luna avatar',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Select Zyra avatar',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="Select Zyra avatar"]')?.getAttribute('aria-pressed')==='true',null,{timeout:60000});release();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.unroute('**/models/nova.vrm');
  assert.equal(await page.evaluate(()=>localStorage.getItem('echo_selected_avatar')),'ember');
  await page.getByRole('button',{name:'Voice settings',exact:true}).click();
  await page.locator('.preset-card').filter({hasText:'Gentle'}).click();
  await page.getByLabel('Zyra speaking rate',{exact:true}).press('ArrowLeft');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await select('Aira');await select('Zyra');
  await page.getByRole('button',{name:'Voice settings',exact:true}).click();assert.equal(await page.locator('.preset-card.active .pc-top').innerText(),'Gentle');
  await page.getByRole('button',{name:'Reset to Default Voice',exact:true}).click();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Clear conversation',exact:true}).click();assert.equal(await page.locator('.message').count(),0);
  console.log('PASS memory, character sender, real clipboard, corrupt/stale recovery, voice settings and clear');
 }
 for(const width of[320,390,768,1024,1440]) {
  await page.setViewportSize({width,height:width<800?844:1000});
  if(width<=800 && await page.locator('.conversation-toggle').getAttribute('aria-expanded')==='true')await page.locator('.conversation-toggle').click();
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
  const measure=await page.evaluate(()=>{
   const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
   return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,stage:box('.avatar-panel'),chat:box('.chat-panel'),mic:box('.mic-btn')};
  });
  assert.equal(measure.overflow,false);assert.ok(measure.mic.right<=width);assert.ok(measure.mic.bottom<=844 || width>=800);
  if(width>=1024)assert.ok(measure.stage.width/(measure.stage.width+measure.chat.width)>.6);
  await page.screenshot({path:`verification/zirumi/layout-${width}.png`});
  if(width<=800) {
   await page.locator('.conversation-toggle').click();await page.locator('.chat-panel.chat-expanded').waitFor();
   await page.screenshot({path:`verification/zirumi/conversation-${width}.png`});await page.locator('.conversation-toggle').click();
  }
  await page.getByRole('button',{name:'Characters',exact:true}).click();
  for(const name of['Aira','Luna','Mira','Zyra'])assert.ok(await page.getByRole('button',{name:`Select ${name} avatar`,exact:true}).count());
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.avatar-modal-overlay')).opacity==='1' && document.querySelector('.avatar-modal').getAnimations().every(animation=>animation.playState==='finished'));
  await page.screenshot({path:`verification/zirumi/characters-${width}.png`});
  await page.getByRole('button',{name:'Close dialog',exact:true}).press('Tab');
  assert.ok(await page.evaluate(()=>Boolean(document.activeElement.closest('[role="dialog"]'))));
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Characters');
  layouts.push(measure);console.log('PASS responsive layout and keyboard dialog',width);
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Open settings',exact:true}).click();
 await page.getByText('Your reduced-motion preference is active.').waitFor();
 assert.equal(await page.locator('.avatar-modal').evaluate(el=>getComputedStyle(el).animationName),'none');await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
 await writeFile(`verification/zirumi/browser-${uiOnly?'ui-only-': ''}${visual?'visual':live?'live':'fixture'}-results.json`,JSON.stringify({url:base,liveGroq:live,physicalMicrophoneVerified:false,liveElevenLabs:false,uiOnly,requests,rigs,layouts,errors},null,2));
 console.log('PASS ZIRUMI browser verification');
}finally{await page.screenshot({path:'verification/zirumi/last-state.png'}).catch(()=>{});await browser.close();}
