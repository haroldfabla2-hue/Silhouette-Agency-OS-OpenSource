/** Real service authorization with inert blueprint fixtures. Does not run
 * integration effects or model generation and is not end-to-end integration proof. */
import {describe,it,expect} from 'vitest';
import {withAuthenticatedPrincipal} from '../../services/security/principalContext';
import {integrationArchitect as architect} from '../../services/integrationArchitect';
describe('blueprint service ownership',()=>{
 it('refuses foreign, absent and legacy ownership before any integration effect',async()=>{
  await expect(architect.generateBlueprint('fixture',{} as any,[])).rejects.toThrow('BLUEPRINT_PRINCIPAL_REQUIRED');
  const map=(architect as any).pendingBlueprints as Map<string,any>;
  const bp={id:'owner-fixture',principalId:'fixture-A',status:'PENDING_APPROVAL',tools:[],credentials:[]};
  map.set(bp.id,bp);map.set('legacy-fixture',{...bp,id:'legacy-fixture',principalId:undefined});
  try{
   expect(architect.getPendingBlueprints()).toEqual([]);
   expect(await architect.approveAndExecute(bp.id)).toBe(false);
   await withAuthenticatedPrincipal('fixture-B',async()=>{
    expect(architect.getBlueprint(bp.id)).toBeUndefined();
    expect(architect.getPendingBlueprints()).toEqual([]);
    expect(await architect.approveAndExecute(bp.id)).toBe(false);
    expect(architect.rejectBlueprint(bp.id)).toBe(false);
   });
   await withAuthenticatedPrincipal('fixture-A',async()=>{
    expect(architect.getBlueprint(bp.id)).toBe(bp);
    expect(await architect.approveAndExecute('legacy-fixture')).toBe(false);
    expect(architect.rejectBlueprint('legacy-fixture')).toBe(false);
    expect(architect.rejectBlueprint(bp.id)).toBe(true);
   });
  }finally{map.delete(bp.id);map.delete('legacy-fixture');}
 });
});
