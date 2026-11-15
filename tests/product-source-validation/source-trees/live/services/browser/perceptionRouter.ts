/**
 * Routes perception/act requests: Stagehand when it is REAL, the built-in engine otherwise.
 * The response always says which provider answered and why (status/missing settings), so a
 * fallback is visible, never silent and never presented as Stagehand.
 */
import { StagehandPerception, PerceptionResult } from './stagehandPerception';

export interface BuiltinBrowser {
    goto(url: string): Promise<any>;
    observe(instruction?: string): Promise<any>;
    act(instruction: string, text?: string): Promise<any>;
    extract(instruction: string): Promise<any>;
}

export type PerceptionOperation = 'status' | 'goto' | 'observe' | 'extract' | 'act';

export interface RoutedResult {
    provider: 'stagehand' | 'builtin';
    stagehand_status: 'REAL' | 'UNAVAILABLE';
    stagehand_missing?: string[];
    stagehand_reason?: string;
    fell_back_from_stagehand: boolean;
    result?: any;
    error?: string;
}

export async function routePerception(
    op: PerceptionOperation,
    args: { url?: string; instruction?: string; text?: string; schema?: any },
    stagehand: StagehandPerception,
    builtin: BuiltinBrowser,
): Promise<RoutedResult> {
    const st = stagehand.status();
    const base = {
        stagehand_status: st.status,
        stagehand_missing: st.missing.length ? st.missing : undefined,
        stagehand_reason: st.reason,
    };
    if (op === 'status') {
        return { ...base, provider: st.status === 'REAL' ? 'stagehand' : 'builtin', fell_back_from_stagehand: st.status !== 'REAL' };
    }

    const need = (v: string | undefined, name: string) => { if (!v) throw new Error(`${name} is required for ${op}`); return v; };

    if (st.status === 'REAL') {
        let r: PerceptionResult;
        if (op === 'goto') r = await stagehand.goto(need(args.url, 'url'));
        else if (op === 'observe') r = await stagehand.perceive(args.instruction);
        else if (op === 'extract') r = await stagehand.extract(need(args.instruction, 'instruction'), args.schema);
        else r = await stagehand.act(need(args.instruction, 'instruction'));
        return { ...base, provider: 'stagehand', fell_back_from_stagehand: false, result: r, error: r.success ? undefined : r.error };
    }

    // UNAVAILABLE: genuine fallback to the existing engine. Same gates, same audit.
    try {
        let result: any;
        if (op === 'goto') result = await builtin.goto(need(args.url, 'url'));
        else if (op === 'observe') result = await builtin.observe(args.instruction);
        else if (op === 'extract') result = await builtin.extract(need(args.instruction, 'instruction'));
        else result = await builtin.act(need(args.instruction, 'instruction'), args.text);
        return { ...base, provider: 'builtin', fell_back_from_stagehand: true, result };
    } catch (e: any) {
        return { ...base, provider: 'builtin', fell_back_from_stagehand: true, error: String(e?.message || e) };
    }
}
