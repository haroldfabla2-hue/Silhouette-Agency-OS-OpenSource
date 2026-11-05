/**
 * GATED EXECUTION HELPER (2026-11-05, cierre de paths directos)
 *
 * Un solo punto para ejecutar una herramienta respetando el consentimiento
 * de efectos, espejo del bloque aceptado en orchestrator.executeCapability.
 * Lo usan los call sites que NO pasan por ese chokepoint:
 *   - geminiService (function-calling nativo del proveedor)
 *   - streamAdapters (fallback local JSON {tool,args})
 *   - server/mcp/mcpServer (clientes MCP externos)
 *   - services/mcp/mcpClient (herramientas de servidores MCP externos)
 *
 * Semantica identica al chokepoint: efecto no gateado pasa directo; efecto
 * gateado sin contexto pide aprobacion humana en /v1/autonomy/confirmations
 * CUANDO existe un principal humano; si no existe (llamadas por API token,
 * daemons sin sesion), el flujo DENIEGA - ninguna aprobacion es alcanzable
 * ni prometida ahi. Aprobada, re-entra con pseudo-grant ligado a
 * efecto+args exactos; denegacion lanza EffectDeniedError (sin reintento,
 * sin exito simulado).
 */
import {
    isGatedEffect,
    ensureEffectConsent,
    effectBinding,
    isCapabilityLevelBoundary,
    HUMAN_APPROVED_TOKEN
} from './effectGate';
import { runWithEffectContext } from './effectContext';

export async function executeWithEffectConsent<T>(
    effect: string,
    args: Record<string, any>,
    origin: string,
    exec: () => Promise<T>
): Promise<T> {
    if (!isGatedEffect(effect)) {
        return exec();
    }
    const granted = await ensureEffectConsent(effect, args, origin,
        { providerBoundary: isCapabilityLevelBoundary(effect) });
    if (granted.via === 'human-approval') {
        // Approved once by a human at /v1/autonomy/confirmations: re-enter
        // with a pseudo-grant bound to THIS exact effect+args (same pattern
        // as orchestrator.executeCapability).
        const binding = effectBinding(effect, args);
        return runWithEffectContext(
            {
                grant: { token: HUMAN_APPROVED_TOKEN, binding },
                validated: new Set(),
                issuedBy: 'actionExecutor:/v1/autonomy/confirmations'
            },
            exec
        );
    }
    // via 'grant': an EffectContext already carries authority for this exact
    // effect+args (validated at the wrapper layer); execute within it.
    return exec();
}
