/** Contracts around real no-principal refusal. Static caller checks are
 * deliberately not called end-to-end narrator/provider/integration evidence. */
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {ActionExecutor} from '../../services/actionExecutor';
import {withAuthenticatedPrincipal} from '../../services/security/principalContext';
import {ensureEffectConsent} from '../../services/security/effectGate';
describe('unavailable confirmation is not user rejection',()=>{
 it('actual executor/effect gate reject with typed no-owner outcome, never false rejection',async()=>{
  const executor=new ActionExecutor();
  await expect(executor.requestConfirmation({type:'SEND_EMAIL'} as any)).rejects.toMatchObject({reason:'NO_AUTHENTICATED_PRINCIPAL'});
  await expect(ensureEffectConsent('send_email',{to:'fixture@invalid',body:'x'},'fixture')).rejects.toMatchObject({code:'CONFIRMATION_UNAVAILABLE',reason:'NO_AUTHENTICATED_PRINCIPAL'});
  expect(executor.getPendingConfirmations('fixture')).toEqual([]);
 });
 it('no-principal cannot be forged through action payload or system-token context',async()=>{
  const executor=new ActionExecutor();
  await expect(withAuthenticatedPrincipal('system:api-token',()=>executor.requestConfirmation({type:'SEND_EMAIL',principalId:'claimed',payload:{principalId:'claimed'}} as any))).rejects.toMatchObject({reason:'NO_AUTHENTICATED_PRINCIPAL'});
 });
 it('all three old global payload producers no longer emit confirmation details',()=>{
  for(const file of ['services/actionExecutor.ts','services/integrationArchitect.ts','services/security/securityManager.ts']){
   expect(readFileSync(file,'utf8')).not.toMatch(/systemBus\.emit\(SystemProtocol\.CONFIRMATION_REQUIRED/);
  }
 });
 it('narrator stores unavailable as unresolved proposal, not human rejection',()=>{
  const src=readFileSync('services/cognitive/thoughtNarrator.ts','utf8');
  const error=src.slice(src.indexOf('Confirmation unavailable:'),src.indexOf('Confirmation unavailable:')+850);
  expect(error).toContain('CONSENT_UNRESOLVED');expect(error).toContain('not_dispatched');expect(error).not.toContain('REJECTED_BY_USER');
 });
});
