// =============================================================================
// Login Gate
// Lightweight authentication wrapper - shows login screen until authenticated
// =============================================================================

import React, { useEffect, useState, useCallback } from 'react';
import { checkDeviceTrust, startGoogleAuth } from '../utils/fingerprint';
import SetupWizard from './SetupWizard';
import LocalLogin from './LocalLogin';
import { api } from '../utils/api';

interface LoginGateProps {
    children: React.ReactNode;
}

interface AuthState {
    checkingSetup: boolean;
    isSetup: boolean | null;
    checkingAuth: boolean;
    authenticated: boolean;
    user: any;
}

export const LoginGate: React.FC<LoginGateProps> = ({ children }) => {
    const [auth, setAuth] = useState<AuthState>({
        checkingSetup: true,
        isSetup: null,
        checkingAuth: true,
        authenticated: false,
        user: null
    });

    // Check if system is set up
    useEffect(() => {
        const checkSetup = async () => {
            try {
                const data = await api.get<{ isSetup: boolean }>('/v1/identity/is-setup');
                setAuth(prev => ({ ...prev, checkingSetup: false, isSetup: data.isSetup }));
            } catch (e) {
                console.error("Failed to check setup status", e);
                // Fail safe: assume setup to show login gate
                setAuth(prev => ({ ...prev, checkingSetup: false, isSetup: true }));
            }
        };
        checkSetup();
    }, []);

    // Check existing auth if setup is complete
    useEffect(() => {
        if (auth.checkingSetup || auth.isSetup === false) return;

        const checkAuth = async () => {
            // First check if we have a local session ID
            const sessionId = localStorage.getItem('silhouette_session_id');
            const userStr = localStorage.getItem('silhouette_user');

            if (sessionId && userStr) {
                try {
                    // Try a ping to verify session (any harmless authenticated route works)
                    await api.get('/health');
                    setAuth(prev => ({
                        ...prev,
                        checkingAuth: false,
                        authenticated: true,
                        user: JSON.parse(userStr)
                    }));
                    return;
                } catch (e) {
                    console.warn("Session invalid, falling back to device trust");
                    localStorage.removeItem('silhouette_session_id');
                }
            }

            // Fallback to legacy device trust (Google Auth / original ID flow)
            const result = await checkDeviceTrust();
            if (result.trusted && result.user) {
                setAuth(prev => ({
                    ...prev,
                    checkingAuth: false,
                    authenticated: true,
                    user: result.user
                }));
            } else {
                setAuth(prev => ({ ...prev, checkingAuth: false }));
            }
        };

        checkAuth();
    }, [auth.checkingSetup, auth.isSetup]);

    // Listen for OAuth popup success
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // Validate origin to prevent cross-origin message injection
            if (event.origin !== window.location.origin) return;

            if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
                setAuth(prev => ({
                    ...prev,
                    checkingAuth: false,
                    authenticated: true,
                    user: { email: event.data.email, name: event.data.email.split('@')[0], role: event.data.isCreator ? 'CREATOR' : 'USER' }
                }));
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleGoogleLogin = useCallback(() => {
        startGoogleAuth();
    }, []);

    const handleLocalSuccess = (session: any, user: any) => {
        localStorage.setItem('silhouette_session_id', session.id);
        localStorage.setItem('silhouette_user', JSON.stringify(user));
        setAuth(prev => ({ ...prev, authenticated: true, user, isSetup: true }));
    };

    // Loading state
    if (auth.checkingSetup || (auth.isSetup && auth.checkingAuth)) {
        return (
            <div className="h-screen w-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="relative w-20 h-20 mx-auto mb-4">
                        <img
                            src="/logo/isotipo-oscuro.png"
                            alt="Silhouette"
                            className="w-20 h-20 object-contain animate-pulse"
                            style={{
                                filter: 'drop-shadow(0 0 20px rgba(6, 182, 212, 0.4))',
                                animation: 'logoGlow 2s ease-in-out infinite'
                            }}
                        />
                        <div
                            className="absolute inset-0 border-2 border-cyan-500/30 rounded-full animate-spin"
                            style={{ animationDuration: '3s' }}
                        />
                    </div>
                    <p className="text-slate-400 text-sm">Recognizing device...</p>
                    <style>{`
                        @keyframes logoGlow {
                            0%, 100% { filter: drop-shadow(0 0 20px rgba(6, 182, 212, 0.3)); transform: scale(1); }
                            50% { filter: drop-shadow(0 0 30px rgba(6, 182, 212, 0.6)); transform: scale(1.05); }
                        }
                    `}</style>
                </div>
            </div>
        );
    }

    // Setup Wizard Flow (First Time)
    if (auth.isSetup === false && !auth.authenticated) {
        return <SetupWizard onComplete={handleLocalSuccess} />;
    }

    // Login Screen Flow
    if (!auth.authenticated) {
        return <LocalLogin onComplete={handleLocalSuccess} onGoogleLogin={handleGoogleLogin} />;
    }

    // Authenticated - render app with user context
    return (
        <div className="relative">
            {children}
        </div>
    );
};

export default LoginGate;
