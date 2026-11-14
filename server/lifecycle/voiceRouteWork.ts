import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { serverOwner } from '../../services/lifecycle/preparationBindings';
import { AdmissionClosed } from '../../services/lifecycle/host';
import { admitEvaluatedVoiceRoutes, bindEvaluatedVoiceRoutes } from '../../services/lifecycle/runtimeStopBindings';

type RouteSource = "voice:get:/library" | "voice:get:/library/language/:lang" | "voice:post:/library/download/:id" | "voice:post:/library/download-all" | "voice:get:/default" | "voice:get:/calls" | "voice:get:/:id" | "voice:delete:/:id" | "voice:post:/:id/set-default" | "voice:get:/:id/sample" | "voice:post:/clone" | "voice:get:/clone/providers" | "voice:post:/clone/analyze" | "voice:post:/twiml" | "voice:post:/twiml-gather" | "voice:post:/status" | "voice:post:/dial" | "media:post:/tts/speak" | "media:get:/tts/config" | "media:post:/tts/config" | "media:post:/tts/sleep" | "media:post:/tts/wake" | "media:get:/tts/voices" | "media:post:/tts/voices/clone" | "media:get:/tts/health";
let installed = false;
let sealed = false;
let joined: Promise<void> | undefined;
const active = new Set<Promise<unknown>>();

/** Register only literal reviewed original async handlers, before Router mount.
 * Retains their exact task beyond response.finish/HTTP transport close. Does not
 * cover preceding multer/auth/body middleware, detached work, WebSockets or
 * third-party provider callback delivery. No implicit host or permission grant.
 */
export function retainKnownVoiceRoute<R extends Request>(source: RouteSource,
    original: (request: R, response: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
    if (sealed) throw new AdmissionClosed('voice-route-registration');
    if (!installed) {
        const permit = admitEvaluatedVoiceRoutes();
        bindEvaluatedVoiceRoutes(permit, sealAndDrainKnownVoiceRoutes);
        installed = true;
    }
    // Return void to Express in both versions. Exactly one error path calls
    // next(error); Express5 must not also observe the same rejected Promise.
    return (request, response, next): void => {
        if (sealed) {
            response.status(503).setHeader('Connection', 'close');
            response.end('Server shutting down');
            return;
        }
        let task: Promise<unknown>;
        try { task = serverOwner().invoke('known-voice-route-' + source, () => original(request as R, response, next)); }
        catch (error) { next(error); return; }
        active.add(task);
        const settle = () => { active.delete(task); };
        void task.then(settle, error => {
            settle();
            try { next(error); }
            catch (forwardingError) { serverOwner().failure('known-voice-route-error-forwarding', forwardingError); }
        });
    };
}

export function sealAndDrainKnownVoiceRoutes(): Promise<void> {
    if (joined) return joined;
    sealed = true;
    const admitted = [...active];
    joined = Promise.allSettled(admitted).then(results => {
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length) throw new AggregateError(errors, 'Known original voice route drain failed');
    });
    void joined.catch(() => undefined);
    return joined;
}
