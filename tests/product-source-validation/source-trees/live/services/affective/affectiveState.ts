/**
 * AFFECTIVE STATE LAYER (modelo funcional — NO conciencia, NO sentimientos reales)
 *
 * Qué es: un estado afectivo PERSISTENTE y CUANTITATIVO (valencia + activación)
 * que etiqueta memorias/reflexiones y MODULA el tono y las prioridades de la
 * entidad. Es un modelo funcional de regulación, inspirado en la evidencia de
 * que un estado afectivo continuo, moderado y modulador mejora el desempeño
 * (curva en U invertida: los extremos empeoran).
 *
 * Qué NO es: no es conciencia, no son emociones reales, y JAMÁS decide.
 * No cambia acciones, intents, disposiciones ni routing. Solo entra como
 * contexto de tono en la narrativa y como etiqueta en la memoria.
 *
 * Invariantes de diseño (testeadas en tests/automated/affective-state.test.ts):
 *  1. PERSISTENTE: sobrevive reinicios (data/affective_state.json, escritura atómica).
 *  2. MODERADO: la valencia vive en [-0.6, +0.6] y la activación en [0.15, 0.85].
 *     Ninguna observación, por extrema que sea, puede salir de la banda.
 *  3. GRADUAL: cada observación pesa como mucho `alpha` (EMA) — el estado no
 *     salta de golpe, igual que los ajustes de alma son graduales.
 *  4. MODULA, NO DECIDE: getModulationContext() devuelve SOLO texto descriptivo
 *     para prompts. Ninguna rama de decisión lee este estado.
 *  5. MEMORIA ETERNA: el tagging afectivo es aditivo; nunca borra ni degrada.
 */

import fs from 'fs/promises';
import path from 'path';
import { atomicWriteFile } from '../utils/atomicWrite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Etiqueta afectiva que se adjunta a memorias/reflexiones (aditiva, opcional). */
export interface AffectTag {
    valence: number;    // [-1, 1] — negativo ↔ positivo
    activation: number; // [0, 1] — calmado ↔ intenso
    at: number;         // epoch ms del etiquetado
}

export interface AffectiveStateData {
    valence: number;      // [-1, 1], moderado a [-0.6, 0.6]
    activation: number;   // [0, 1], moderado a [0.15, 0.85]
    observations: number; // conteo total de observaciones absorbidas (auditoría)
    updatedAt: number;    // epoch ms de la última observación
}

// ---------------------------------------------------------------------------
// Constantes de diseño (de la investigación: continua, moderada, moduladora)
// ---------------------------------------------------------------------------

/** Banda de moderación: los extremos empeoran el desempeño (U invertida). */
export const MODERATION_BAND = {
    valenceMin: -0.6,
    valenceMax: 0.6,
    activationMin: 0.15,
    activationMax: 0.85
} as const;

/** Peso máximo de una sola observación (EMA). Gradual, nunca brusco. */
export const DEFAULT_ALPHA = 0.15;

/** Estado basal: neutral y en reposo medio. */
export const BASELINE: AffectiveStateData = {
    valence: 0,
    activation: 0.5,
    observations: 0,
    updatedAt: 0
};

const STATE_PATH = path.join(process.cwd(), 'data', 'affective_state.json');

// ---------------------------------------------------------------------------
// Funciones puras (testeables sin IO)
// ---------------------------------------------------------------------------

/** Acota el estado a la banda de moderación. Los extremos son inalcanzables. */
export function clampToModerateBand(state: AffectiveStateData): AffectiveStateData {
    return {
        ...state,
        valence: Math.min(MODERATION_BAND.valenceMax, Math.max(MODERATION_BAND.valenceMin, state.valence)),
        activation: Math.min(MODERATION_BAND.activationMax, Math.max(MODERATION_BAND.activationMin, state.activation))
    };
}

/**
 * Absorbe una observación como media móvil exponencial.
 * `weight` ∈ (0, 1] escala el alpha (observaciones débiles pesan menos).
 * Nunca mueve el estado más que alpha * distancia — gradual por construcción.
 */
export function applyObservation(
    state: AffectiveStateData,
    observation: { valence: number; activation: number },
    alpha: number = DEFAULT_ALPHA
): AffectiveStateData {
    const safeAlpha = Math.min(1, Math.max(0, alpha));
    const obsValence = Math.min(1, Math.max(-1, observation.valence));
    const obsActivation = Math.min(1, Math.max(0, observation.activation));
    const next: AffectiveStateData = {
        valence: state.valence + safeAlpha * (obsValence - state.valence),
        activation: state.activation + safeAlpha * (obsActivation - state.activation),
        observations: state.observations + 1,
        updatedAt: Date.now()
    };
    return clampToModerateBand(next);
}

/**
 * Describe el estado en lenguaje natural (para contexto de tono en prompts).
 * SOLO texto descriptivo — nunca instrucciones de acción.
 */
export function describeState(state: AffectiveStateData): string {
    const v = state.valence;
    const a = state.activation;
    const valenceLabel =
        v <= -0.4 ? 'claramente negativo' :
        v < -0.1 ? 'ligeramente negativo' :
        v <= 0.1 ? 'neutral' :
        v < 0.4 ? 'ligeramente positivo' :
        'claramente positivo';
    const activationLabel =
        a <= 0.35 ? 'en calma' :
        a <= 0.65 ? 'en reposo medio' :
        'en alerta moderada';
    return `valencia=${v.toFixed(2)} (${valenceLabel}), activación=${a.toFixed(2)} (${activationLabel})`;
}

/**
 * Bloque de contexto para prompts del narrador. La REGLA DUERA va explícita:
 * el estado modula el TONO, jamás el contenido de las decisiones.
 */
export function buildModulationPromptBlock(state: AffectiveStateData): string {
    return [
        `CURRENT AFFECTIVE STATE (functional regulation model): ${describeState(state)}.`,
        `RULE: this state may ONLY color the TONE of your "thought" text (warmer/cooler, calmer/more urgent wording).`,
        `It must NEVER change your intent, your action.type, your params, your confidence, or your safety fields.`,
        `Two identical sensory inputs with different affective states MUST yield the same decisions.`
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Servicio singleton con persistencia
// ---------------------------------------------------------------------------

export class AffectiveStateService {
    private state: AffectiveStateData = { ...BASELINE };
    private loaded = false;
    private loading: Promise<void> | null = null;
    private readonly statePath: string;

    constructor(statePath: string = STATE_PATH) {
        this.statePath = statePath;
    }

    /** Carga perezosa (una vez por proceso). Sobrevive reinicios vía disco. */
    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        if (this.loading) return this.loading;
        this.loading = (async () => {
            try {
                const raw = await fs.readFile(this.statePath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (typeof parsed.valence === 'number' && typeof parsed.activation === 'number') {
                    this.state = clampToModerateBand({
                        valence: parsed.valence,
                        activation: parsed.activation,
                        observations: typeof parsed.observations === 'number' ? parsed.observations : 0,
                        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
                    });
                }
            } catch {
                // Sin estado previo o archivo corrupto → baseline (degradación honesta, estado neutral)
                this.state = { ...BASELINE };
            }
            this.loaded = true;
        })();
        return this.loading;
    }

    private async persist(): Promise<void> {
        try {
            await fs.mkdir(path.dirname(this.statePath), { recursive: true });
            await atomicWriteFile(this.statePath, JSON.stringify(this.state, null, 2));
        } catch (e) {
            // La persistencia nunca rompe el camino principal — se reporta y sigue
            console.error('[AFFECT] Failed to persist affective state:', e);
        }
    }

    /**
     * Registra una observación afectiva (EMA gradual + banda de moderación) y
     * la persiste. `weight` ∈ (0,1] opcional escala el alpha.
     */
    public async observe(
        observation: { valence: number; activation: number },
        weight: number = 1
    ): Promise<AffectiveStateData> {
        await this.ensureLoaded();
        const alpha = DEFAULT_ALPHA * Math.min(1, Math.max(0, weight));
        this.state = applyObservation(this.state, observation, alpha);
        await this.persist();
        return { ...this.state };
    }

    /** Estado actual (copia defensiva). Solo lectura. */
    public async getState(): Promise<AffectiveStateData> {
        await this.ensureLoaded();
        return { ...this.state };
    }

    /** Etiqueta afectiva para adjuntar a una memoria/reflexión (aditiva). */
    public async tag(): Promise<AffectTag> {
        const s = await this.getState();
        return { valence: s.valence, activation: s.activation, at: Date.now() };
    }

    /** Bloque de contexto de tono para prompts (texto; nunca decide). */
    public async getModulationContext(): Promise<string> {
        const s = await this.getState();
        return buildModulationPromptBlock(s);
    }
}

export const affectiveState = new AffectiveStateService();
