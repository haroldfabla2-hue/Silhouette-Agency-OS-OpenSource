/** SOURCE CANDIDATE ONLY. Future isolated composite trial child.
 * Real product singleton/middleware/router/SQLite/Redis/Neo4j, no mocks, no
 * process.exit, no second profile constructor, no private-field access.
 * Parent owns exactly one real Neo4j service boot, Redis process and secrets.
 * NOT wired to a runnable operational workflow yet.
 */
import assert from 'node:assert/strict';
import { readFileSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Database from '/tmp/work/node_modules/better-sqlite3/lib/index.js';
import neo4j from '/tmp/work/node_modules/neo4j-driver/lib/index.js';
import { createClient } from '/tmp/work/node_modules/redis/dist/index.js';
import { beginProviderAttemptAudit } from '/tmp/harness/provider_attempt_audit.mts';
import { installPreparationHost } from '/tmp/work/services/lifecycle/bootstrapAuthority.ts';

const mode = process.argv[2];
assert(['cold-redis','cold-graph','cold-graph-unsafe','router'].includes(mode));
assert.equal(process.env.SILHOUETTE_BOOT_MODE,'normal');
assert.equal(process.env.SILHOUETTE_PROVIDERS,'on');
assert.equal(process.env.SILHOUETTE_INFERENCE_MODE,'cloud-only');
// Fixed JSON from a reviewed inherited pipe; no credentials in argv/env/files.
const secretFD = Number(process.env.JOINT_FIXTURE_SECRET_FD);
assert(Number.isSafeInteger(secretFD) && secretFD >= 3);
const privatePayload = readFileSync(secretFD); closeSync(secretFD);
assert(privatePayload.length <= 1024);
const privateInputs = JSON.parse(privatePayload.toString('ascii'));privatePayload.fill(0);
assert.deepEqual(Object.keys(privateInputs).sort(),['api','login','neo4j']);
for(const value of Object.values(privateInputs))assert(typeof value==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(value));
process.env.NEO4J_PASSWORD=privateInputs.neo4j;
process.env.SILHOUETTE_API_TOKEN=privateInputs.api;
const syntheticLoginPassword:string=privateInputs.login;
delete privateInputs.neo4j;delete privateInputs.api;delete privateInputs.login;
delete process.env.JOINT_FIXTURE_SECRET_FD;
assert.equal(process.env.REDIS_URL,undefined);assert.notEqual(process.env.USE_REDIS,'true');
const dbPath = process.env.SILHOUETTE_DB_PATH!;
assert(dbPath.startsWith('/tmp/product-runtime/') && !dbPath.includes('..'));
const result: any = {schema:'REAL_PRODUCT_SERVICE_AC_CHILD_V1',mode,status:'INCOMPLETE',cases:[],cleanup:[],
    pending:['UI_POSITIVE_GENERATION_FULL_PILLARS_NOT_COVERED','ANN_CONDITIONAL_RUNTIME_CENSUS_REQUIRED','REDIS_MAIN_ORIGINAL_DISCONNECT_NOT_FINAL_QUIESCENCE_PROOF'],
    globalProductAcceptance:'INCOMPLETE_PERMANENT_HOST_FRONTIER_MARKER'};
const host = installPreparationHost({scopes:48,active:512,failures:256,resources:256});
const audit = beginProviderAttemptAudit();
let sql: any, sql2: any, redis: any, driver: any, server: any;
let product: any, storage: any, lance: any;
const errors: unknown[] = [];let stage='PRECHECK';
const current = (id: string) => {
    const row: any = sql.prepare('SELECT * FROM user_profiles WHERE user_id=?').get(id);
    return row ? {id:row.user_id,...(row.name === null ? {} : {name:row.name}),preferredLanguage:row.preferred_language,
        preferences:JSON.parse(row.preferences),facts:JSON.parse(row.facts),extractedAt:row.extracted_at,lastInteraction:row.last_interaction} : null;
};
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
async function cypher(query: string, params: any = {}) {
    const session = driver.session({database:'neo4j'});
    try { return await session.run(query,params); } finally { await session.close(); }
}
async function check(name: string, run: () => Promise<void> | void) {
    stage=name;const started = performance.now();
    try { await run();result.cases.push({name,status:'PASS',seconds:(performance.now()-started)/1000}); }
    catch (error) { result.cases.push({name,status:'FAIL',errorType:error instanceof Error?error.name:'UNKNOWN'});throw error; }
}
async function projection(id: string) {
    const raw = await redis.get('silhouette:user_profile:'+id);
    const response = await cypher('MATCH (u:User {id:$id}) RETURN u.id AS id,u.name AS name,u.preferredLanguage AS lang,u.preferences AS preferences,u.facts AS facts',{id});
    assert.equal(response.records.length,1);
    const r=response.records[0];
    return {redis:raw===null?null:JSON.parse(raw),graph:{id:r.get('id'),name:r.get('name'),lang:r.get('lang'),preferences:JSON.parse(r.get('preferences')),facts:JSON.parse(r.get('facts'))}};
}
async function request(route: string,body?: any,session?: string) {
    if (body) assert(!['gitToken','gitOwner','gitRepo'].some(k=>Object.hasOwn(body,k)));
    const response = await fetch('http://127.0.0.1:3405'+route,{method:body?'POST':'GET',
        headers:{...(body?{'content-type':'application/json'}:{}),...(session?{'x-session-id':session}:{})},
        body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
    const text=await response.text();assert(Buffer.byteLength(text)<=262144);
    return {status:response.status,text};
}
try {
    result.diagnosticChannelSelfcheck = await audit.verifyActualLoopbackChannels();
    redis=createClient({url:'redis://127.0.0.1:6499',socket:{reconnectStrategy:false}});
    redis.on('error',()=>{ /* Exact original promises observed; no raw payload export. */ });
    await redis.connect();assert.equal(await redis.ping(),'PONG');
    driver=neo4j.driver('bolt://127.0.0.1:7787',neo4j.auth.basic('neo4j',process.env.NEO4J_PASSWORD!),
        {maxConnectionPoolSize:2,connectionAcquisitionTimeout:2000,connectionTimeout:2000});
    await driver.verifyConnectivity();
    await check('SDK_AUTHENTICATED_REAL_BOLT',async()=>{const r=await cypher('RETURN 1 AS actual');assert.equal(r.records[0].get('actual').toNumber(),1);});
    // An independent bad credential must fail at the actual authenticated SDK.
    if(mode==='cold-redis')await check('SDK_INVALID_AUTH_REAL_REJECTION',async()=>{
        const bad=neo4j.driver('bolt://127.0.0.1:7787',neo4j.auth.basic('neo4j','synthetic-deliberately-invalid-fixture-credential'),{connectionTimeout:2000,maxConnectionPoolSize:1});
        let rejected=false;
        try {await bad.verifyConnectivity();}catch(error:any){assert.equal(error.code,'Neo.ClientError.Security.Unauthorized');rejected=true;}
        finally {await bad.close();}
        assert(rejected);
    });
    const seed={id:'user_primary',name:mode==='cold-redis'?'ColdRedis':'ColdGraph',preferredLanguage:'en',preferences:{source:mode},facts:['synthetic source'],extractedAt:1234,lastInteraction:5678};
    // Same service boot, isolated graph namespace per child must be allocated by
    // the parent via database reset? NO: no deletion or overwrite is hidden.
    // Cold-graph and cold-graph-unsafe each use this ID in sequence; Redis cold child
    // leaves the same graph row untouched, and router reads SQL authority.
    if(mode==='cold-redis') await redis.set('silhouette:user_profile:user_primary',JSON.stringify(seed));
    if(mode==='cold-graph'||mode==='cold-graph-unsafe') {
        await redis.del('silhouette:user_profile:user_primary'); // fixture-only scoped disposable Redis key, not user data
        await cypher('MERGE (u:User {id:$id}) SET u.name=$name,u.preferredLanguage=$preferredLanguage,u.preferences=$preferences,u.facts=$facts,u.extractedAt=$extractedAt,u.lastInteraction=$lastInteraction',{
            ...seed,preferences:JSON.stringify(seed.preferences),facts:JSON.stringify(seed.facts),extractedAt:neo4j.int(mode==='cold-graph-unsafe'?'9007199254740992':'1234'),lastInteraction:neo4j.int(5678)});
    }
    if(mode==='cold-graph'||mode==='cold-graph-unsafe') {
        const actual=await cypher('MATCH (u:User {id:$id}) RETURN u.extractedAt AS extractedAt,u.lastInteraction AS lastInteraction',{id:'user_primary'});
        const timestamp=actual.records[0].get('extractedAt');assert(neo4j.isInt(timestamp));
        assert.equal(timestamp.inSafeRange(),mode==='cold-graph');
        assert(neo4j.isInt(actual.records[0].get('lastInteraction')));
        result.legacyGraphSDKIntegerObserved={realIsInt:true,inSafeRange:timestamp.inSafeRange()};
    }
    // No setup/bootstrap application: exact real router/product module imports.
    product=await import('/tmp/work/services/userProfileService.ts');
    const {userProfile}=product;
    const original1=userProfile.readyInitialProfile(),original2=userProfile.readyInitialProfile();
    assert.strictEqual(original1,original2);
    const hydrated=await original1;
    sql=new Database(dbPath,{timeout:5000});sql.pragma('busy_timeout=5000');
    sql2=new Database(dbPath,{timeout:5000});sql2.pragma('busy_timeout=5000');
    storage=await import('/tmp/work/services/lifecycle/runtimeStopBindings.ts');
    lance=(await import('/tmp/work/services/lancedbService.ts')).lancedbService;
    if(mode==='cold-redis'||mode==='cold-graph') {
        await check('ORIGINAL_CONSTRUCTOR_HYDRATION_'+mode,()=>{assert.equal(hydrated?.name,seed.name);assert.equal(hydrated?.id,'user_primary');assert.equal(current('user_primary')?.name,seed.name);assert.equal(current('user_primary')?.extractedAt,1234);assert.equal(current('user_primary')?.lastInteraction,5678);});
    }
    if(mode==='cold-graph-unsafe') await check('SDK_INTEGER_UNSAFE_GRAPH_NOT_ADMITTED_BY_CONSTRUCTOR',()=>{
        assert.equal(hydrated,null);assert.equal(current('user_primary'),null);
    });
    const id='fixture-'+mode;
    await check('REAL_SERVICE_TWO_CONNECTION_REBASE_AND_DETACHED_INPUT',async()=>{
        const original={nested:{value:'captured'}};
        const mutation=userProfile.setPreference('payload',original,id);original.nested.value='caller changed';await mutation;
        const {commitProfileMutation}=await import('/tmp/work/services/memory/profileAuthority.ts');
        const frozen=commitProfileMutation(sql2,id,{kind:'preference',key:'otherConnection',value:'committed'}).snapshot;
        assert(Object.isFrozen(frozen));assert(Object.isFrozen(frozen.preferences));
        await userProfile.addFact('original service mutation',id);
        assert.equal(current(id)?.preferences.otherConnection,'committed');
        assert.equal(current(id)?.preferences.payload.nested.value,'captured');
        assert(userProfile.getProfileContext(id).includes('otherConnection=committed'));
        assert(current(id)?.facts.includes('original service mutation'));
    });
    await check('ORIGINAL_AFTER_AWAIT_CONCURRENT_SQL_WINNER',async()=>{
        const target='race-'+mode;
        await redis.set('silhouette:user_profile:'+target,JSON.stringify({...seed,id:target,name:'Stalecandidate'}));
        const {commitProfileMutation}=await import('/tmp/work/services/memory/profileAuthority.ts');
        assert.equal(current(target),null);
        // Original load checks SQL synchronously then unconditionally awaits
        // real Redis.get; caller commits on independent SQL2 in the SAME turn.
        // No injected promises, scheduling patch or private-field mutation.
        const originalHydration=userProfile.loadProfile(target);
        const winner=commitProfileMutation(sql2,target,{kind:'name',name:'Sqlwinner'}).snapshot;
        const loaded=await originalHydration;assert.equal(loaded?.name,winner.name);assert.equal(current(target)?.name,winner.name);
    });
    await check('ACTUAL_SERVICE_RECEIPT_AND_INDEPENDENT_PROJECTIONS',async()=>{
        const extraction=await userProfile.extractFromMessageWithReceipt('my name is Receipt',id);assert(extraction.ok);
        assert.equal(extraction.receipt.completed.length,1);
        assert.equal(extraction.receipt.completed[0].snapshotDigest,digest(current(id)));
        const seen=await projection(id);assert.equal(seen.redis.name,'Receipt');assert.equal(seen.graph.name,'Receipt');
        assert.deepEqual(seen.redis.preferences,current(id)?.preferences);assert.deepEqual(seen.graph.facts,current(id)?.facts);
    });
    await check('SQL_CURRENT_BEATS_STALE_REDIS_AND_GRAPH',async()=>{
        const before=current(id);await redis.set('silhouette:user_profile:'+id,JSON.stringify({...before,name:'stale projection'}));
        await cypher('MERGE (u:User {id:$id}) SET u.name=$name',{id,name:'stale graph'});
        const loaded=await userProfile.loadProfile(id);assert.equal(loaded?.name,before.name);assert.equal(current(id)?.name,before.name);
    });
    await check('EXACT_ID_MISMATCH_REFUSED_WITHOUT_GRAPH_REMAP',async()=>{
        const target='mismatch-'+mode;await redis.set('silhouette:user_profile:'+target,JSON.stringify({...seed,id:'different-person'}));
        assert.equal(await userProfile.loadProfile(target),null);assert.equal(current(target),null);
    });
    if(mode==='router') {
        const express=(await import('/tmp/work/node_modules/express/index.js')).default;
        const identityRoutes=(await import('/tmp/work/server/routes/v1/identity.routes.ts')).default;
        const chatRoutes=(await import('/tmp/work/server/routes/v1/chat.routes.ts')).default;
        const app=express();app.use(express.json({limit:'64kb'}));app.use('/v1/identity',identityRoutes);app.use('/v1/chat',chatRoutes);
        server=await new Promise<any>((yes,no)=>{const s=app.listen(3405,'127.0.0.1',()=>yes(s));s.once('error',no);});
        const password=syntheticLoginPassword;
        const setup=await request('/v1/identity/setup',{email:'fixture-router@example.invalid',password,name:'Fixture'});assert.equal(setup.status,200);
        const account=JSON.parse(setup.text);assert(account.success&&account.user.id&&account.session.id);assert(!account.user.passwordHash);
        let session=account.session.id;
        const login=await request('/v1/identity/login',{email:'fixture-router@example.invalid',password});assert.equal(login.status,200);
        const signed=JSON.parse(login.text);assert(signed.success&&signed.session.id);session=signed.session.id;
        const accountId=account.user.id;
        await check('REAL_SESSION_MIDDLEWARE_ABSENT_AND_INVALID_DENIED',async()=>{
            assert.equal((await request('/v1/chat/message',{message:'do not process'})).status,401);
            assert.equal((await request('/v1/chat/message',{message:'do not process'},'synthetic-invalid-session')).status,401);
        });
        // Both SQL branches are genuine SQLite trigger failures, not stubs.
        sql.exec(`CREATE TRIGGER fixture_language_insert BEFORE INSERT ON user_profiles
          WHEN json_extract(NEW.preferences,'$.preferredLanguage')='es'
          BEGIN SELECT RAISE(ABORT,'fixture language write failure'); END;
          CREATE TRIGGER fixture_language_update BEFORE UPDATE ON user_profiles
          WHEN json_extract(NEW.preferences,'$.preferredLanguage')='es'
          BEGIN SELECT RAISE(ABORT,'fixture language write failure'); END;`);
        for(const streaming of [false,true]) await check(streaming?'SSE_PARTIAL_COMMIT_FAILURE_TRUTHFUL':'JSON_PARTIAL_COMMIT_FAILURE_TRUTHFUL',async()=>{
            const name=streaming?'Streamcase':'Jsoncase',sid=streaming?'fixture-sse':'fixture-json';
            const reply=await request('/v1/chat/'+(streaming?'stream':'message'),{message:`me llamo ${name}, responde en español, recuerda que fact must not run`,sessionId:sid},session);
            const events=streaming?reply.text.split('\n\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))):[JSON.parse(reply.text)];
            const failure=events.find(x=>x.type==='error');assert(failure);assert(!events.some(x=>['done','complete','response'].includes(x.type)));
            assert.equal(failure.receipt.chatMessage,'SQLITE_APPEND_RETURNED');assert.equal(failure.receipt.generation,'NOT_STARTED');
            assert.equal(failure.receipt.profile.state,'FAILED_AFTER_CONFIRMED_COMMITS');assert.equal(failure.receipt.profile.failedStep,2);
            assert.equal(failure.receipt.profile.failedStepCommit,'NOT_CONFIRMED');assert.equal(failure.receipt.profile.completed.length,1);
            assert.equal(failure.receipt.profile.completed[0].snapshotDigest,digest(current(accountId)));
            assert.equal(current(accountId)?.name,name);assert.equal(current(accountId)?.preferences.preferredLanguage,undefined);
            assert(!current(accountId)?.facts.includes('fact must not run'));
            assert.equal(sql.prepare('SELECT count(*) AS n FROM chat_logs WHERE session_id=?').get(sid).n,1);
            const seen=await projection(accountId);assert.equal(seen.redis.name,name);assert.equal(seen.graph.name,name);
            if(streaming){assert.equal(reply.status,200);assert.equal(events.filter(x=>x.type==='user_saved').length,1);assert.equal(events.filter(x=>x.type==='error').length,1);}else assert.equal(reply.status,500);
        });
        sql.exec(`CREATE TRIGGER fixture_chat_abort BEFORE INSERT ON chat_logs WHEN NEW.session_id='fixture-sql-abort' BEGIN SELECT RAISE(ABORT,'fixture chat failure'); END;`);
        await check('CHAT_SQL_INSERT_ABORT_NO_FALSE_RECEIPTS',async()=>{
            const before=digest(current(accountId));
            const reply=await request('/v1/chat/stream',{message:'me llamo Mustnotcommit',sessionId:'fixture-sql-abort'},session);
            const events=reply.text.split('\n\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)));
            assert(!events.some(x=>x.type==='user_saved'));const error=events.find(x=>x.type==='error');assert(error);
            assert.equal(error.receipt.chatMessage,'NOT_CONFIRMED');assert.equal(error.receipt.profile.state,'NOT_STARTED');assert.equal(error.receipt.generation,'NOT_STARTED');
            assert.equal(digest(current(accountId)),before);assert.equal(sql.prepare("SELECT count(*) AS n FROM chat_logs WHERE session_id='fixture-sql-abort'").get().n,0);
        });
        // Sessions and loginpassword never emitted, nor setup/login rawpayloads.
        result.realAuthenticatedRouter={setup:true,passwordLogin:true,sessionMiddleware:true,bearerMasterTokenUsed:false};
        // Stop real HTTP admission before original identity close. This actual
        // native login has an unconditional dynamic-import await after lookup;
        // same-turn close races that real continuation, no synthetic barrier.
        await new Promise<void>((yes,no)=>server.close((e:any)=>e?no(e):yes()));server=undefined;
        await check('IDENTITY_ORIGINAL_REAL_POSTAWAIT_JOIN_AND_CLOSE_IDENTITY',async()=>{
            const {identityService}=await import('/tmp/work/services/identityService.ts');
            const originalLogin=identityService.loginLocalVerify('fixture-router@example.invalid',password);
            const first=identityService.close(),second=identityService.close();assert.strictEqual(first,second);
            assert.throws(()=>identityService.hasAnyUsers());
            const outcomes=await Promise.allSettled([originalLogin,first]);
            assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[1].status,'fulfilled');
            if(outcomes[0].status==='fulfilled')assert.equal(outcomes[0].value?.id,accountId);
        });
    }
    const {redisClient}=await import('/tmp/work/services/redisClient.ts');assert.equal(redisClient.isMockMode(),false);
    const {graph}=await import('/tmp/work/services/graphService.ts');assert.equal(await graph.isConnected(),true);result.realGraphSdkHealth=true;
    const {configLoader}=await import('/tmp/work/server/config/configLoader.ts');
    const effective=configLoader.getConfig(),expected=JSON.parse(readFileSync('/tmp/work/silhouette.config.json','utf8'));
    assert.deepEqual(effective,expected);result.effectiveConfigExact=true;
} catch(error) {
    errors.push(error);result.primaryFailureType=error instanceof Error?error.name:'UNKNOWN';result.primaryFailure={stage,errorType:result.primaryFailureType,cause:'FIXED_STAGE_ASSERTION_OR_ORIGINAL_OPERATION_REJECTION'};
} finally {
    // Request bodies finished before HTTP server close. Never cut them short
    // with closeAllConnections; a stuck borrower is an outer deadline failure.
    const cleanup=async(name:string,body:()=>unknown)=>{try{await body();result.cleanup.push({name,state:'SETTLED'});}catch(error){errors.push(error);result.cleanup.push({name,state:'FAILED',errorType:error instanceof Error?error.name:'UNKNOWN'});}};
    if(server)await cleanup('original-express-server-close',()=>new Promise<void>((yes,no)=>server.close((e:any)=>e?no(e):yes())));
    for(const [name,path,method]of [['narrative','/tmp/work/services/narrativeService.ts','stopAdmissions'],['arbiter','/tmp/work/services/resourceArbiter.ts','stopAdmissions'],['orchestrator','/tmp/work/services/orchestrator.ts','stopUserMessageAdmissions']]as const){
        // All are static dependencies of the successful actual product import.
        // Do not evaluate a fresh module graph merely to manufacture teardown.
        if(product)await cleanup(name,async()=>{const m:any=await import(path);const owner=m.narrative??m.resourceArbiter??m.orchestrator;await owner[method]();});
    }
    if(storage){await cleanup('original-producers-and-introspection',()=>storage.drainEvaluatedRuntimeProducers());await cleanup('original-storage-ordered',()=>storage.closeEvaluatedRuntimeStorage());}
    if(product){const {redisClient}=await import('/tmp/work/services/redisClient.ts');result.redisOriginalNativeFrontier=redisClient.originalNativeFrontier();}
    if(lance)result.lanceNativeFrontier=lance.originalNativeFrontier();
    // Original upstream identity request is already awaited; remaining native
    // owner gap is explicit and cannot be converted by a quiet process exit.
    result.redisMainNativeClosure='UNSUPPORTED_PUBLIC_JOIN_API';
    if(sql2)await cleanup('independent-sql2',()=>sql2.close());if(sql)await cleanup('independent-sql',()=>sql.close());
    if(redis)await cleanup('independent-redis',async()=>{if(redis.isOpen)await redis.close();});
    if(driver)await cleanup('independent-driver',()=>driver.close());
    await cleanup('host-stop-with-marker-preserved',async()=>{const report=await host.stop();result.host={state:report.state,pending:report.pending,capacity:report.capacity,highWater:report.highWater,
            lifetimeFailures:report.lifetimeFailures,ownerFailures:report.ownerFailures,taskOutcomeFailures:report.taskOutcomeFailures,
            failures:report.failures.map((f:any)=>({id:f.id,kind:f.kind,source:f.source})),residuals:report.residuals,resources:report.resources,
            coverage:report.coverage};if(report.lifetimeFailures||report.ownerFailures)throw new Error('Original owner failures retained');});
    result.attemptAudit=audit.snapshot();audit.stop();delete process.env.NEO4J_PASSWORD;delete process.env.SILHOUETTE_API_TOKEN;
    result.functionalStatus=errors.length?'FAIL':'CASES_ASSERTED';
    if(result.attemptAudit.unexpectedHttp||result.attemptAudit.invalidObservation)errors.push(new Error('Unexpected/incomplete HTTP observation'));
    if(result.lanceNativeFrontier?.lanceHandles.some((x:any)=>x.open)||result.lanceNativeFrontier?.ann.closure==='UNSUPPORTED')errors.push(new Error('Native original Lance closure incomplete'));
    result.functionalStatus=errors.length?'FAIL':'SCOPED_REAL_AC_ASSERTIONS_PASS';
    result.status=errors.length?'FAIL':'INCOMPLETE';
    result.redisMainNativeClosure='UNSUPPORTED_PUBLIC_JOIN_API';
    result.lifecycleAcceptance='INCOMPLETE_NOT_ACCEPTED';
    result.failureCount=errors.length;
    // Structured safe evidence contains syntheticprofile assertions/ownerfields
    // only, no raw setup/session/APIcredential/authenticated request headers.
    console.log('JOINT_PRODUCT_CHILD_RESULT:'+JSON.stringify(result));
    if(errors.length)process.exitCode=1;
}
