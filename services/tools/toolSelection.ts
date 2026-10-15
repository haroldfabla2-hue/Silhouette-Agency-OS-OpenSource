/**
 * [W3] Capability -> tool attachment for agent execution.
 *
 * The factory fire test showed agents "executing" build steps with no tools
 * attached: generateAgentResponse only attaches googleSearch / codeExecution /
 * media tools. Filesystem tools existed in the registry but no capability
 * branch ever attached them, so a "Frontend Developer" step could only
 * produce prose. This module owns the mapping, pure and unit-tested.
 */
import { AgentCapability } from '../../types';
import { READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_FILES_TOOL } from '../tools/definitions';

/**
 * Filesystem tool bundles (Gemini functionDeclarations format) for the given
 * capabilities. Read bundle and write bundle are attached independently:
 * an agent with only ACTION_FILE_READ gets read_file + list_files, never
 * write_file.
 */
export function fsToolsForCapabilities(caps: AgentCapability[]): Array<{ functionDeclarations: unknown[] }> {
    const bundles: Array<{ functionDeclarations: unknown[] }> = [];
    const reads: unknown[] = [];
    if (caps.includes(AgentCapability.ACTION_FILE_READ)) reads.push(READ_FILE_TOOL, LIST_FILES_TOOL);
    if (reads.length > 0) bundles.push({ functionDeclarations: reads });
    if (caps.includes(AgentCapability.ACTION_FILE_WRITE)) bundles.push({ functionDeclarations: [WRITE_FILE_TOOL] });
    return bundles;
}

/**
 * Work-description heuristic: does this step declare file-producing work?
 * Declaration is explicit (ACTION_FILE_WRITE in requiredCapabilities) or
 * inferred from the task text. Spanish + English, build-oriented terms.
 * Used BOTH to grant the minimal jailed tools and to arm the anti-theater
 * gate — an execution that declares file work must produce verified writes.
 */
export const FILE_WORK_PATTERN = /(crear|escribir|generar|construir|implement|build|create|write|archivo|file|c[oó]digo|code|component|componente|p[aá]gina|page|landing|website|sitio|app\b)/i;

export function stepDeclaresFileWork(step: { taskDescription?: string; requiredCapabilities?: AgentCapability[] }): boolean {
    if (step.requiredCapabilities?.includes(AgentCapability.ACTION_FILE_WRITE)) return true;
    return FILE_WORK_PATTERN.test(step.taskDescription || '');
}

/**
 * [Grant] Durable filesystem grant for agents assigned file-declaring work.
 * The per-step tool attachment above is ephemeral; this persists the grant
 * on the agent record so the capability registry and UI reflect reality and
 * non-planExecutor paths (chat) can attach the same JAILED tools. The jail
 * (W2) stays the real enforcement; this is honest bookkeeping, not a door.
 * Returns the updated capability list, or null when nothing changes
 * (idempotent — safe to call on every step).
 */
export function durableFileGrant(caps: AgentCapability[], declaresFileWork: boolean): AgentCapability[] | null {
    if (!declaresFileWork) return null;
    const hasRead = caps.includes(AgentCapability.ACTION_FILE_READ);
    const hasWrite = caps.includes(AgentCapability.ACTION_FILE_WRITE);
    if (hasRead && hasWrite) return null;
    return Array.from(new Set([...caps, AgentCapability.ACTION_FILE_READ, AgentCapability.ACTION_FILE_WRITE]));
}

/** System-instruction block appended when confined filesystem tools attach. */
export const FS_JAIL_INSTRUCTION = `
        PROTOCOL: BUILDER
        CAPABILITY: CONFINED_FILESYSTEM
        You have write_file / read_file / list_files tools. They are CONFINED to the project workspace jail: paths outside the allowed roots, secret files (.env, keys, databases, .git) and oversize content are DENIED and audited.
        RULES: (1) Write REAL files for every artifact you claim to produce. (2) After writing, state exactly what the tool returned. (3) If a write is denied, report the denial reason verbatim. (4) NEVER claim a file exists when the tool did not confirm it — simulated completion is a critical failure.
        `;
