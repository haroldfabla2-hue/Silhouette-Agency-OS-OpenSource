import type { HostReport } from './host';
/** Exact source labels from reviewed code, no error/value/stack serialization.
 * Categories classify evidence, not severity, recovery or task success.
 */
const categories: Readonly<Record<string, string>> = Object.freeze({
    'redis:service-client:EMITTED_ERROR': 'REDIS_TRANSPORT_EVENT',
    'redis:service-connect:MEMORY_AVAILABILITY_NOT_DURABILITY_FALLBACK': 'REDIS_CONNECT_FALLBACK',
    'redis:service-fallback:ORIGINAL_DISCONNECT_FAILED': 'REDIS_FALLBACK_CLOSE_FAILURE',
    'redis:public-disconnect:ORIGINAL_CLOSE_FAILED': 'REDIS_PUBLIC_CLOSE_FAILURE',
    'redis:service-connected:ORIGINAL_INCIDENT_RESOLVE_FAILED': 'REDIS_INCIDENT_FAILURE',
    'redis:service-fallback:ORIGINAL_INCIDENT_RECORD_FAILED': 'REDIS_INCIDENT_FAILURE',
    'graph:health:ORIGINAL_UNAVAILABLE': 'GRAPH_HEALTH_UNAVAILABLE',
    'graph:schema:SELECTED_CONSTRAINT_FAILED': 'GRAPH_SCHEMA_FAILURE',
    'graph:query:ORIGINAL_RUN_FAILED': 'GRAPH_QUERY_FAILURE',
    'graph:query:RETRY_RUN_FAILED': 'GRAPH_QUERY_RETRY_FAILURE',
    'graph:session-close-original-sync': 'GRAPH_SESSION_CLOSE_FAILURE',
    'graph:session-close-original': 'GRAPH_SESSION_CLOSE_FAILURE',
    'dreamer:startup-power-check-boundary': 'DREAMER_STARTUP_FAILURE',
    'dreamer:dream:SELECTED_ATTEMPT_FAILED': 'DREAMER_SELECTED_ATTEMPT_FAILURE',
    'dreamer:initial-concept-notification:accepted-effect': 'INITIAL_CONCEPT_NOTIFICATION_FAILURE',
    'dreamer:initial-identity-notification:accepted-effect': 'INITIAL_IDENTITY_NOTIFICATION_FAILURE',
    'dreamer:canonical-store-notification:accepted-effect': 'STORE_NOTIFICATION_FAILURE',
    'dreamer:initial-concept-notification:accepted-effect:NOT_INVOKED': 'INITIAL_CONCEPT_NOTIFICATION_ABANDONED',
    'dreamer:initial-identity-notification:accepted-effect:NOT_INVOKED': 'INITIAL_IDENTITY_NOTIFICATION_ABANDONED',
    'dreamer:canonical-store-notification:accepted-effect:NOT_INVOKED': 'STORE_NOTIFICATION_ABANDONED',
});
const LIMIT = 64;
export function projectRetainedFailureCategories(report: HostReport) {
    const retained = report.failures.slice(0, LIMIT).map(failure => Object.freeze({
        id: failure.id, kind: failure.kind,
        category: Object.hasOwn(categories, failure.source) ? categories[failure.source] : 'UNCLASSIFIED',
    }));
    return Object.freeze({
        historicalMapping: 'NOT_RECONSTRUCTED',
        currentReportOnly: true,
        retainedCount: report.failures.length,
        ownerFailures: report.ownerFailures, taskOutcomeFailures: report.taskOutcomeFailures,
        lifetimeFailures: report.lifetimeFailures, acknowledged: report.acknowledged,
        truncated: report.failures.length > LIMIT,
        unclassifiedCount: retained.filter(failure => failure.category === 'UNCLASSIFIED').length,
        attribution: report.failures.length > LIMIT || retained.some(failure => failure.category === 'UNCLASSIFIED')
            ? 'INCOMPLETE' : 'FIXED_SOURCE_CATEGORIES_ONLY_NOT_CAUSE_OR_RECOVERY_PROOF',
        retained,
    });
}
