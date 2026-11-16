'use strict';
const fs=require('node:fs'),{Module}=require('node:module'),boundary=require('./load-boundary.cjs');
// These are actual hooked public entry calls, not manually incremented counters.
function run(){
 const before=boundary.snapshot();
 if(before.violationCount!==0)throw Error('R_PRE_CONTROL_BOUNDARY_VIOLATION');
 const specs=[
  {rule:'RAW_FD_READ',category:'codeReads',code:'R_RAW_FD_READ_DENIED',subject:'FD',call:()=>fs.readFileSync(0)},
  {rule:'UNAPPROVED_READ',category:'codeReads',code:'R_UNAPPROVED_CODE_READ',subject:'/tmp/boundary-control',call:()=>fs.readFileSync('/tmp/boundary-control')},
  {rule:'UNAPPROVED_READ',category:'codeReads',code:'R_UNAPPROVED_CODE_READ',subject:'/denied/sentinel.cjs',call:()=>fs.readFileSync('/denied/sentinel.cjs')},
  {rule:'NON_STRING_PATH',category:'loads',code:'R_NON_PATH',subject:'NON_STRING_PATH',call:()=>fs.readFileSync({})},
  {rule:'INVALID_FILE_URL',category:'loads',code:'R_NON_PATH',subject:'file://not-local.invalid/a',call:()=>fs.readFileSync(new URL('file://not-local.invalid/a'))},
  {rule:'READ_REALPATH_UNREADABLE',category:'codeReads',code:'R_SOURCE_CODE_READ_DENIED',subject:'/source/__missing_resolver_control__/package.json',call:()=>fs.readFileSync('/source/__missing_resolver_control__/package.json')},
  {rule:'COMPILE_CONTENT_MISMATCH',category:'compile',code:'R_COMPILE_CONTENT_IDENTITY',subject:'/control/load-boundary.cjs',call:()=>new Module('/control/load-boundary.cjs')._compile("throw Error('R_WRONG_CONTENT_EXECUTED')",'/control/load-boundary.cjs')}
 ];
 for(const item of specs){
  let caught;try{item.call();}catch(e){caught=e.code;}
  if(caught!==item.code)throw Error('R_READ_COMPILE_CONTROL');
 }
 const after=boundary.snapshot();
 if(after.violationCount!==specs.length||after.events.length!==specs.length||after.events.some((row,i)=>['rule','category','code','subject'].some(key=>row[key]!==specs[i][key])))throw Error('R_READ_COMPILE_LEDGER');
 return {before,after,expectedEvents:specs.map(({call,...rest})=>rest)};
}
module.exports={run};
