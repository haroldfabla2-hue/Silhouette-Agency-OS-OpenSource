'use strict';
// SOURCE REVIEW ONLY. Genuine native/browser prerequisites, NOT product UI test.
const fs=require('node:fs');
(async()=>{
 const result={status:'PREREQUISITES_ONLY_NOT_PRODUCT_PASS',checks:[],failures:[]};
 async function check(name,fn){try{result.checks.push({name,ok:true,value:await fn()});}catch(e){result.failures.push(name);result.checks.push({name,ok:false,type:e.name,message:e.message});}}
 await check('node-abi127',()=>{if(process.versions.modules!=='127')throw Error('WRONG_ABI');return process.versions.modules;});
 await check('reviewed-sqlite-load-close',()=>{const DB=require('/app/node_modules/better-sqlite3');const db=new DB(':memory:');try{if(db.prepare('select 1 as v').get().v!==1)throw Error('SQLITE_NOT_REAL');return 'real_native_memory_query';}finally{db.close();}});
 await check('reviewed-lance-native-load',()=>{require('/app/node_modules/@lancedb/lancedb');return 'official_module_loaded_no_database_created';});
 await check('reviewed-browser-local-page-close',async()=>{const {chromium}=require('/app/node_modules/playwright');let browser;try{browser=await chromium.launch({executablePath:'/browser-assets/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check']});const page=await browser.newPage();await page.setContent('<!doctype html><title>Environment qualification only</title><p id="probe">local prerequisite</p>');if(await page.locator('#probe').textContent()!=='local prerequisite')throw Error('LOCAL_PAGE_NOT_RENDERED');return{version:browser.version(),externalPagesOpened:false,productUI:false};}finally{if(browser)await browser.close();}});
 fs.writeFileSync('/evidence/prerequisites.json',JSON.stringify(result,null,2)+'\n');if(result.failures.length)process.exitCode=1;
})().catch(e=>{fs.writeFileSync('/evidence/prerequisites-failure.json',JSON.stringify({type:e.name,message:e.message})+'\n');process.exitCode=1;});
