'use strict';
// Export only fixed codes/counts. Never serialize samples, original errors,
// arbitrary exception.message/name/code, URLs, headers or body contents.
const allowedSources=new Set(['telephony-dial','telephony-dtmf','telephony-hangup']);
module.exports=function receiptFailure(ledger){
 const row=ledger.drainFailure();
 if(row===undefined)return {name:'HttpBodyCustodyDrainError',code:'NO_BODY_CLEANUP_FAILURE',count:0,overflow:false,sampleCount:0,sources:[]};
 if(!Number.isSafeInteger(row.failureCount)||row.failureCount<0||typeof row.countOverflow!=='boolean'||!Array.isArray(row.samples)||row.samples.length>8)throw Error('INVALID_BODY_LEDGER');
 const sources=row.samples.map(item=>item.source);if(!sources.every(source=>allowedSources.has(source)))throw Error('INVALID_BODY_SOURCE');
 return {name:'HttpBodyCustodyDrainError',code:'BODY_CLEANUP_UNVERIFIED',count:row.failureCount,overflow:row.countOverflow,sampleCount:row.samples.length,sources};
};
