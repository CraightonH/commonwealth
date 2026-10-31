import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSave, decodeSave } from '../dist/platform/save-format.js';
import { BrowserStorage } from '../dist/platform/storage/browser-storage.js';
import { SaveService, SaveConflictError } from '../dist/platform/save-service.js';
import { GoogleDriveStorage, DRIVE_APPDATA, DRIVE_FILE } from '../dist/platform/storage/google-drive.js';
import { GoogleAuth } from '../dist/platform/auth/google-auth.js';
import { installSaveMenu } from '../dist/platform/save-menu.js';

const state = () => ({v:1,res:{food:140,timber:100,ore:30},levels:{fish:1,wood:1,ore:0},tools:0,active:0,exp:null,last:Date.now(),log:[]});
function browser() {
  const entries = new Map();
  const storage = { getItem: k => entries.get(k) ?? null, setItem: (k,v) => entries.set(k,v) };
  return { storage, local: new BrowserStorage(storage) };
}
test('legacy browser saves migrate without losing progress; exports round-trip', () => {
  const {storage, local} = browser(), old = state(); old.tools = 4;
  storage.setItem('hearthwater-v1', JSON.stringify(old));
  const service = new SaveService({local});
  assert.deepEqual(service.load(state()), old);
  service.save(old);
  assert.equal(JSON.parse(storage.getItem('hearthwater-v1')).schemaVersion, 1);
  assert.deepEqual(decodeSave(service.export()), old);
});
test('invalid imports are rejected before replacing the working save', () => {
  const {local} = browser(), service = new SaveService({local});
  const before = service.load(state()); service.save(before);
  for (const value of [null, {}, {...before, tools:-1}, {...before, levels:{fish:1.5,wood:1,ore:0}},
    {...before, exp:{end:'tomorrow',ready:false}}, {...before, log:[{text:3,time:0}]}]) {
    assert.throws(() => service.import(JSON.stringify(value)));
    assert.deepEqual(local.readLocal(), before);
  }
  assert.throws(() => decodeSave(JSON.stringify({format:'commonwealth-save',schemaVersion:99,state:before})));
});
test('cloud saves require an explicit choice and work with a non-Google provider', async () => {
  const {local} = browser(), service = new SaveService({local});
  service.load(state());
  const remoteState = state(); remoteState.tools=7;
  let received;
  const otherProvider = {id:'example',label:'Another storage',async write(s,options){ received={s,options};return{revision:'next'}; }};
  assert.equal(service.remote,null);
  const chosen = service.attach(otherProvider,{state:remoteState,revision:'first'},{useCloud:true});
  assert.equal(chosen.tools,7); await service.sync();
  assert.equal(received.s.tools,7);
  assert.equal(received.options.expectedRevision,'first');
  assert.equal(service.revision,'next');
});
test('sync serializes writes, preserves newer local progress, and ignores disconnected completions', async () => {
  const {local} = browser(), service = new SaveService({local}); service.load(state());
  let finish, writes=0;
  const provider={label:'Delayed',write:()=>{writes++;return new Promise(resolve=>{finish=resolve;});}};
  service.attach(provider,null);
  const first=service.sync(); assert.equal(service.sync(),first);assert.equal(writes,1);
  const newer=state();newer.tools=2;service.save(newer);
  finish({revision:'r1'});await first;
  assert.equal(local.readLocal().tools,2);
  const second=service.sync();service.disconnect();finish({revision:'r2'});await second;
  assert.equal(service.remote,null);assert.equal(service.revision,null);
});
test('cloud errors block retries while local saves keep working', async () => {
  const {local}=browser(),service=new SaveService({local});service.load(state());
  let writes=0;service.attach({label:'Offline',async write(){writes++;throw new SaveConflictError();}},null);
  await assert.rejects(service.sync(),SaveConflictError);
  const newer=state();newer.tools=3;service.save(newer);await service.sync();
  assert.equal(local.readLocal().tools,3);assert.equal(writes,1);assert.equal(service.blocked,true);
});
test('unavailable device storage does not prevent playing or exporting', () => {
  const local={readLocal(){throw Error('denied');},writeLocal(){throw Error('quota');}};
  const service=new SaveService({local});service.load(state());service.save(state());
  assert.equal(service.localOK,false);assert.equal(decodeSave(service.export()).v,1);
});
test('Drive detects revisions before overwriting and never uploads on conflict', async () => {
  let calls=0;
  const drive=new GoogleDriveStorage({authorization:{getAccessToken(scopes){assert.deepEqual(scopes,[DRIVE_APPDATA]);return 'test';}},
    fetcher:async()=>{calls++;return Response.json({files:[{id:'save',version:'2'}]});}});
  await assert.rejects(drive.write(state(),{expectedRevision:'save:1'}),SaveConflictError);
  assert.equal(calls,1);
});
test('Drive hidden save uses appDataFolder; visible export requests only file access', async () => {
  const requests=[];
  const drive=new GoogleDriveStorage({authorization:{getAccessToken(scopes){requests.push({scopes});return 'test';}},
    fetcher:async(url,options)=>{requests.at(-1).url=url;requests.at(-1).options=options;
      return url.includes('uploadType=') ? Response.json({id:'save',version:'1'}) : Response.json({files:[]});}});
  await drive.write(state());
  assert.ok(requests[1].options.body.includes('appDataFolder'));
  await drive.exportVisible(encodeSave(state()));
  assert.deepEqual(requests[2].scopes,[DRIVE_FILE]);
  assert.ok(!requests[2].options.body.includes('appDataFolder'));
});
test('Google identity and authorization stay in memory, expire, and reject account changes', async () => {
  let subject='account-a', seenScopes;
  const auth=new GoogleAuth({clientId:'test-client',loadSDK:async()=>({initTokenClient(options){seenScopes=options.scope;return{requestAccessToken(){options.callback({access_token:'test-token',scope:options.scope,expires_in:3600});}};}}),
    fetcher:async()=>Response.json({sub:subject,name:'Player'})});
  const identity=await auth.signIn({scopes:[DRIVE_APPDATA]});
  assert.equal(identity.subject,'account-a');assert.ok(!('token' in identity));
  assert.equal(auth.getAccessToken([DRIVE_APPDATA]),'test-token');
  subject='account-b';await assert.rejects(auth.authorize([DRIVE_FILE]),/different Google account/);
  assert.equal(auth.getSession().subject,'account-a');
  assert.ok(seenScopes.includes(DRIVE_APPDATA));
  auth.expiresAt=0;assert.throws(()=>auth.getAccessToken(),/expired/);
  await auth.signOut();assert.equal(auth.getSession(),null);assert.equal(auth.token,null);
});

test('import UI previews progress, cancels safely, then restores only on confirmation', async () => {
  const previous = globalThis.document;
  const elements = new Map();
  const element = id => { const e={id,disabled:false,isConnected:true,textContent:''};elements.set('#'+id,e);return e; };
  element('save-menu');
  globalThis.document = {querySelector:selector=>elements.get(selector)};
  try {
    const {local} = browser(), saves = new SaveService({local});
    let current = saves.load(state()), notices=[];
    const target = state();target.tools=6;
    const platform={saves,configured:false,auth:{getSession:()=>null},guest:{getSession:()=>({provider:'guest',displayName:'Guest'})}};
    let lastHTML='';
    const openModal=html=>{lastHTML=html;for(const match of html.matchAll(/id="([^"]+)"/g))element(match[1]);};
    installSaveMenu({platform,readState:()=>current,replaceState:next=>{current=next;},openModal,notify:text=>notices.push(text)});
    elements.get('#save-menu').onclick();
    const importFile=async()=>{
      const input=elements.get('#import-save');
      await input.onchange({currentTarget:input,target:{files:[{size:100,text:async()=>encodeSave(target)}]}});
    };
    await importFile();assert.match(lastHTML,/tools tier 6/);assert.equal(current.tools,0);
    elements.get('#cancel-import').onclick();assert.equal(current.tools,0);
    await importFile();const confirm=elements.get('#confirm-import');await confirm.onclick({currentTarget:confirm});
    assert.equal(current.tools,6);assert.equal(local.readLocal().tools,6);assert.ok(notices.includes('Save imported.'));
  } finally { globalThis.document=previous; }
});
