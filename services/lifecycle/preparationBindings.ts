import type { Scope } from './host';

// Fixed source topology, not caller authentication. The bootstrap alone imports
// installPreparationHost. Application sources import only their fixed binding.
export const fixedNames = ['systemBus', 'sqlite', 'sensory', 'power', 'hub', 'nervous', 'neuroLink', 'settings',
    'continuum', 'introspection', 'consciousness', 'narrative', 'arbiter', 'dreamer', 'graph', 'redis',
    'lance', 'brainBridge', 'plugins', 'proStudio', 'server', 'cost', 'runtimeEnvironment', 'config', 'orchestrator', 'neuroSynapse', 'architecturalReview', 'remediation', 'helpProtocol', 'codebase', 'architect', 'workflow'] as const;
type Name = typeof fixedNames[number];
let installed: Readonly<Record<Name, Scope>> | undefined;
let independentAdmissions: { lance: () => Scope; introspection: () => Scope; brainBridge: () => Scope; codebase: () => Scope };
export function installFixedBindings(scopes: Readonly<Record<Name, Scope>>, independent: {
    lance: () => Scope; introspection: () => Scope; brainBridge: () => Scope; codebase: () => Scope;
}): void {
    if (installed) throw new Error('Host already installed in this realm');
    installed = scopes; independentAdmissions = independent;
}
function required(name: Name): Scope {
    if (!installed) throw new Error('Explicit preparation host must precede application imports: ' + name);
    return installed[name];
}
// No generic exported lookup, service-name selector, factory/loader argument or
// caller-claimed URL. Each application call site has a fixed source binding.
export const systemBusOwner = () => required('systemBus');
export const sqliteOwner = () => required('sqlite');
export const sensoryOwner = () => required('sensory');
export const powerOwner = () => required('power');
export const hubOwner = () => required('hub');
export const nervousOwner = () => required('nervous');
export const neuroLinkOwner = () => required('neuroLink');
export const settingsOwner = () => required('settings');
export const continuumOwner = () => required('continuum');
export const introspectionOwner = () => required('introspection');
export const consciousnessOwner = () => required('consciousness');
export const narrativeOwner = () => required('narrative');
export const arbiterOwner = () => required('arbiter');
export const dreamerOwner = () => required('dreamer');
export const graphOwner = () => required('graph');
export const redisOwner = () => required('redis');
export const lanceOwner = () => required('lance');
export const brainBridgeOwner = () => required('brainBridge');
export const pluginsOwner = () => required('plugins');
export const proStudioOwner = () => required('proStudio');
export const serverOwner = () => required('server');
export const costOwner = () => required('cost');
export const runtimeEnvironmentOwner = () => required('runtimeEnvironment');
export const configOwner = () => required('config');
export const orchestratorOwner = () => required('orchestrator');
export const neuroSynapseOwner = () => required('neuroSynapse');
export const architecturalReviewOwner = () => required('architecturalReview');
export const remediationOwner = () => required('remediation');
export const helpProtocolOwner = () => required('helpProtocol');
export const codebaseOwner = () => required('codebase');
export const architectOwner = () => required('architect');
export const workflowOwner = () => required('workflow');

// Explicit independent caller admission. These create independent records,
// not replacement singleton objects and not an implicit host.
export function admitLanceInstance(): Scope {
    required('lance'); return independentAdmissions.lance();
}
export function admitIntrospectionInstance(): Scope {
    required('introspection'); return independentAdmissions.introspection();
}
export function admitBrainBridgeInstance(): Scope {
    required('brainBridge'); return independentAdmissions.brainBridge();
}

export function admitCodebaseInstance(): Scope {
    required('codebase'); return independentAdmissions.codebase();
}
