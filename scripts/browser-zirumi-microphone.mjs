import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(path.join(process.env.TEMP,'echo-browser-verification/runner.cjs'));
const{chromium}=require('playwright');
const base=process.env.ECHO_TEST_URL || 'http://127.0.0.1:5173';
const fixtureChat = process.argv.includes('--fixture-chat');
const fixtureServices = process.argv.includes('--fixture-services');
const file=path.join(process.env.TEMP,'zirumi-microphone-sample.wav');
const browser=await chromium.launch({executablePath:path.join(process.env.LOCALAPPDATA,'ms-playwright/chromium-1243/chrome-win64/chrome.exe'),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${file}`]});
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['microphone']});
const page=await context.newPage();
const calls=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
await mkdir('verification/zirumi',{recursive:true});
await page.addInitScript(()=>{
 window.__streams=[];
 const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
 navigator.mediaDevices.getUserMedia=(...args)=>capture(...args).then(stream=>{window.__streams.push(stream);return stream;});
});
await page.route('**/api/transcribe',async route=>{
 calls.push({endpoint:'transcribe',bytes:route.request().postDataBuffer().length,type:route.request().headers()['content-type']});
 if (fixtureServices) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({transcript:'Hello Aira. My name is Aster. Please remember my name.'})});
 await route.continue();
});
await page.route('**/api/chat',async route=>{
 const released=await page.evaluate(()=>window.__streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
 assert.equal(released,true,'Microphone tracks must end before AI generation or playback');
 calls.push({endpoint:'chat',request:route.request().postDataJSON(),microphoneReleased:released});
 if (fixtureChat || fixtureServices) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({reply:'Hello Aster. I am Aira. It is lovely to meet you.'})});
 await route.continue();
});
try{
 await page.goto(base);await page.getByText(/Avatar ready/).waitFor({timeout:60000});
 await page.getByRole('button',{name:'Disable voice replies',exact:true}).click();
 await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.getByLabel('Speech recognition',{exact:true}).selectOption('server');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('button',{name:'Start speaking',exact:true}).click();await page.locator('.stage-status').filter({hasText:'Listening'}).waitFor({timeout:15000});
 await page.screenshot({path:'verification/zirumi/microphone-listening.png'});
 await page.waitForTimeout(3500);
 await page.getByRole('button',{name:'Stop listening',exact:true}).press('Enter');
 await page.waitForFunction(()=>document.querySelectorAll('.message-assistant').length===1 || document.querySelector('.error-message'),null,{timeout:60000});
 if (await page.locator('.error-message').count()) throw Error(await page.locator('.error-message').innerText());
 const transcript=await page.locator('.message-user p').innerText();const reply=await page.locator('.message-assistant p').innerText();
 assert.match(transcript,/my name|remember/i);assert.ok(reply.length>0);
 assert.equal(calls.filter(c=>c.endpoint==='transcribe').length,1);assert.equal(calls.filter(c=>c.endpoint==='chat').length,1);
 assert.ok(calls[0].bytes>1000);assert.ok(await page.evaluate(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
 await page.getByRole('button',{name:'Play Aira response',exact:true}).click();await page.locator('.stage-status').filter({hasText:'Speaking'}).waitFor({timeout:15000});
 assert.equal(await page.getByRole('button',{name:'Start speaking',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Stop Speaking',exact:true}).click();assert.equal(await page.evaluate(()=>speechSynthesis.speaking),false);
 await page.screenshot({path:'verification/zirumi/microphone-completed.png'});
 // Chromium permission denial is real; the microphone itself is a virtual fixture.
 await context.grantPermissions([],{origin:base});
 await page.getByRole('button',{name:'Start speaking',exact:true}).click();
 await page.getByRole('alert').filter({hasText:/denied|permission/i}).waitFor({timeout:15000});
 assert.equal(await page.evaluate(()=>window.__streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length),0);
 await page.screenshot({path:'verification/zirumi/microphone-denied.png'});
 // Retry must honor Recorded speech instead of silently switching to native.
 await context.grantPermissions(['microphone'],{origin:base});
 await page.getByRole('button',{name:'Try again',exact:false}).click();
 await page.locator('.stage-status').filter({hasText:'Listening'}).waitFor({timeout:15000});
 await page.waitForTimeout(3500);await page.getByRole('button',{name:'Stop listening',exact:true}).press('Enter');
 await page.waitForFunction(()=>document.querySelectorAll('.message-assistant').length===2 || document.querySelector('.error-message'),null,{timeout:60000});
 if (await page.locator('.error-message').count()) throw Error(await page.locator('.error-message').innerText());
 assert.equal(calls.filter(call=>call.endpoint==='transcribe').length,2);assert.equal(calls.filter(call=>call.endpoint==='chat').length,2);
 assert.equal(await page.locator('.message-user').count(),2);
 assert.ok(calls.filter(call=>call.endpoint==='chat').every(call=>call.microphoneReleased));
 assert.ok(await page.evaluate(()=>window.__streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))));
 assert.deepEqual(errors,[]);
 const result={url:base,input:'Windows synthesized spoken WAV supplied to Chromium virtual microphone',physicalMicrophoneVerified:false,realGetUserMedia:true,realMediaRecorder:true,liveGroqTranscription:!fixtureServices,liveGroqReply:!fixtureServices&&!fixtureChat,permissionDenialVerified:true,permissionRetryHonorsSelectedMode:true,repeatedRecordingsWithoutDuplicateTurns:true,microphoneReleasedBeforeChat:true,transcript,reply,calls,errors};
  await writeFile('verification/zirumi/microphone-results.json',JSON.stringify(result,null,2));console.log('PASS real capture/recording, mic release before playback, native playback/stop and denied permission',JSON.stringify({liveTranscription:result.liveGroqTranscription,liveReply:result.liveGroqReply,transcript,reply}));
}finally{await page.screenshot({path:'verification/zirumi/microphone-last-state.png'}).catch(()=>{});await browser.close();}
