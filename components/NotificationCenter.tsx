import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, X, AlertCircle, Lightbulb, CheckCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { systemBus } from '../services/systemBus';
import { ACTIONABLE_PROTOCOLS } from '../constants';

// --- Types ---
export interface Notification {
    id: string;
    type: 'info' | 'warning' | 'success' | 'idea' | 'action';
    title: string;
    message: string;
    timestamp: number;
    protocol?: string;
    read: boolean;
}

const MAX_NOTIFICATIONS = 20;

// --- NotificationCenter Component ---
const NotificationCenter: React.FC = () => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Subscribe to actionable protocols
    useEffect(() => {
        const unsubscribers = ACTIONABLE_PROTOCOLS.map(protocol => {
            return systemBus.subscribe(protocol as any, (payload: any) => {
                const notification = mapProtocolToNotification(protocol, payload);
                if (notification) {
                    setNotifications(prev => {
                        const updated = [notification, ...prev].slice(0, MAX_NOTIFICATIONS);
                        return updated;
                    });
                }
            });
        });

        return () => unsubscribers.forEach(unsub => unsub());
    }, []);

    const unreadCount = notifications.filter(n => !n.read).length;

    const markAllRead = useCallback(() => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    }, []);

    const clearAll = useCallback(() => {
        setNotifications([]);
    }, []);

    const dismissNotification = useCallback((id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    const getIcon = (type: Notification['type']) => {
        switch (type) {
            case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-400" />;
            case 'success': return <CheckCircle className="w-4 h-4 text-emerald-400" />;
            case 'idea': return <Lightbulb className="w-4 h-4 text-cyan-400" />;
            case 'action': return <ExternalLink className="w-4 h-4 text-purple-400" />;
            default: return <AlertCircle className="w-4 h-4 text-blue-400" />;
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 rounded-lg hover:bg-white/10 transition-colors"
                title="Notifications"
            >
                <Bell className="w-5 h-5 text-white/70" />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold flex items-center justify-center text-white animate-pulse">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown Panel */}
            {isOpen && (
                <div className="absolute right-0 top-12 w-80 max-h-96 overflow-hidden bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50">
                    {/* Header */}
                    <div className="flex items-center justify-between p-3 border-b border-white/10">
                        <span className="text-sm font-medium text-white/80">Notifications</span>
                        <div className="flex gap-2">
                            <button onClick={markAllRead} className="text-xs text-cyan-400 hover:text-cyan-300">
                                Mark all read
                            </button>
                            <button onClick={clearAll} className="text-xs text-red-400 hover:text-red-300">
                                Clear
                            </button>
                        </div>
                    </div>

                    {/* Notification List */}
                    <div className="overflow-y-auto max-h-72">
                        {notifications.length === 0 ? (
                            <div className="p-6 text-center text-white/40 text-sm">
                                No notifications yet
                            </div>
                        ) : (
                            notifications.map(notification => (
                                <div
                                    key={notification.id}
                                    className={`p-3 border-b border-white/5 hover:bg-white/5 transition-colors ${!notification.read ? 'bg-white/5' : ''
                                        }`}
                                >
                                    <div className="flex items-start gap-2">
                                        {getIcon(notification.type)}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium text-white/90 truncate">
                                                    {notification.title}
                                                </span>
                                                <button
                                                    onClick={() => dismissNotification(notification.id)}
                                                    className="text-white/30 hover:text-white/60"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                            <p className="text-xs text-white/50 line-clamp-2 mt-1">
                                                {notification.message}
                                            </p>
                                            <span className="text-[10px] text-white/30 mt-1 block">
                                                {formatTime(notification.timestamp)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- Helper Functions ---
function mapProtocolToNotification(protocol: string, payload: any): Notification | null {
    const id = `notif-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const timestamp = Date.now();

    switch (protocol) {
        case 'PROTOCOL_THOUGHT_EMISSION':
            // Filter out routine thoughts, only show important ones
            const thoughts = payload?.thoughts || [];
            if (thoughts.length === 0) return null;
            const thought = thoughts[0];
            // Skip routine introspection logs
            if (thought.includes('Storing memory:') || thought.includes('[INTROSPECTION]')) return null;
            return {
                id, timestamp, protocol, read: false,
                type: 'idea',
                title: 'Silhouette Insight',
                message: thought.substring(0, 150)
            };

        case 'PROTOCOL_ARCHITECTURAL_RFC':
            return {
                id, timestamp, protocol, read: false,
                type: 'action',
                title: 'RFC Needs Approval',
                message: payload?.title || 'A new architectural proposal requires your review.'
            };

        case 'PROTOCOL_EPISTEMIC_GAP_DETECTED':
            return {
                id, timestamp, protocol, read: false,
                type: 'idea',
                title: 'New Discovery',
                message: payload?.gap || 'Silhouette identified a knowledge gap to explore.'
            };

        case 'PROTOCOL_COST_ANOMALY':
            return {
                id, timestamp, protocol, read: false,
                type: 'warning',
                title: 'Budget Alert',
                message: payload?.message || 'Cost anomaly detected by CFO service.'
            };

        case 'PROTOCOL_DATA_CORRUPTION':
            return {
                id, timestamp, protocol, read: false,
                type: 'warning',
                title: 'Data Issue Detected',
                message: payload?.message || 'Janitor found corrupted data.'
            };

        case 'PROTOCOL_TRAINING_COMPLETE':
            return {
                id, timestamp, protocol, read: false,
                type: 'success',
                title: 'Training Complete',
                message: 'Neural plasticity cycle finished successfully.'
            };

        case 'PROTOCOL_TASK_COMPLETION':
            return {
                id, timestamp, protocol, read: false,
                type: 'success',
                title: 'Task Completed',
                message: payload?.taskName || 'A task has been completed.'
            };

        case 'PROTOCOL_MISSING_CREDENTIAL':
            return {
                id, timestamp, protocol, read: false,
                type: 'warning',
                title: 'Missing Key: ' + (payload?.key || 'Unknown'),
                message: `The agent needs access to ${payload?.service || 'a service'}. Click here to learn how to add it.`
            };

        default:
            return null;
    }
}

function formatTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
}

export default NotificationCenter;
