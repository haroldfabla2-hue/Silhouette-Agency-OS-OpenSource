import { telephonyToolsOwner } from './preparationBindings';
import { AdmissionClosed } from './host';
import { admitEvaluatedTelephonyTools, bindEvaluatedTelephonyTools } from './runtimeStopBindings';
type Source = 'Dial' | 'ProcessTurn' | 'BargeIn' | 'AnalyzeSentiment' | 'SendDtmf' | 'Hangup';
let installed = false;
let sealed = false;
let joined: Promise<void> | undefined;
const active = new Set<Promise<unknown>>();
/** Fixed original tool branches, not new tool dispatch, provider permission or
 * complete toolHandler lifetime. Retains exact original task before first import.
 */
export function retainKnownTelephonyTool<T>(source: Source, original: () => Promise<T>): Promise<T> {
    if (sealed) throw new AdmissionClosed('telephony-tool-' + source);
    if (!installed) {
        const permit = admitEvaluatedTelephonyTools();
        bindEvaluatedTelephonyTools(permit, sealAndDrainKnownTelephonyTools);
        installed = true;
    }
    const work = telephonyToolsOwner().invoke('original-' + source, original);
    active.add(work);
    const settle = () => { active.delete(work); };
    void work.then(settle, settle);
    return work;
}
export function sealAndDrainKnownTelephonyTools(): Promise<void> {
    if (joined) return joined;
    sealed = true;
    joined = Promise.allSettled([...active]).then(results => {
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length) throw new AggregateError(errors, 'Known telephony tool branch drain failed');
    });
    void joined.catch(() => undefined);
    return joined;
}
