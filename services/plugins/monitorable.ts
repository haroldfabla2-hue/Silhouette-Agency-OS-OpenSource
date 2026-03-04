// =============================================================================
// MONITORABLE INTERFACE
// Standard interface for any service, plugin, channel, or integration
// that has an external dependency requiring health monitoring.
//
// Implementing this interface allows the Connection Nervous System to
// automatically monitor, recover, and report on the service's health.
// =============================================================================

/**
 * Any component that connects to an external dependency can implement
 * this interface to be automatically monitored by the Nervous System.
 *
 * Usage:
 *   - Plugins: Add `monitoring?: IMonitorable` to your IPlugin
 *   - Channels: Implemented automatically by channelRouter
 *   - Integrations: Registered via SystemBus INTEGRATION_EVENT
 */
export interface IMonitorable {
    /** Unique ID for monitoring (e.g., 'plugin:github', 'channel:telegram') */
    monitorId: string;

    /** Human-readable name for logs and UI */
    monitorName: string;

    /** Classification for the UI dashboard */
    monitorType: 'DATABASE' | 'API' | 'LOCAL_SERVICE' | 'CLOUD';

    /** If true, system is considered degraded without this service */
    isRequired: boolean;

    /** Return true if the service is healthy and reachable */
    checkHealth(): Promise<boolean>;

    /** Attempt to reconnect/reinitialize the service. Return true on success */
    reconnect(): Promise<boolean>;
}
