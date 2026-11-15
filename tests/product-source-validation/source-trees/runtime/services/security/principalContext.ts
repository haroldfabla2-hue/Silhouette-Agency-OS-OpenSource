import {AsyncLocalStorage} from 'node:async_hooks';
/** Identity, not permission. Entered only after authentication, never from
 * action payloads, tool arguments, bus events or model-authored role names. */
const principalContext=new AsyncLocalStorage<string|null>();
export const currentPrincipal=():string|null=>principalContext.getStore()??null;
export function withAuthenticatedPrincipal<T>(principal:string|null,run:()=>T):T{
    return principalContext.run(principal&&principal!=='system:api-token'?principal:null,run);
}
