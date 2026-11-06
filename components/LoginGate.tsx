// =============================================================================
// Login Gate
// Authentication wrapper - handles first-time setup, login, and Google linking
//
// Flow:
//   1. First visit (no users) → Setup screen (SetupWizard)
//   2. Returning device → Auto-login via fingerprint
//   3. New device/Not trusted → Login screen (LocalLogin)
// =============================================================================

import React, { useEffect, useState, useCallback } from 'react';
import { checkDeviceTrust, startGoogleAuth } from '../utils/fingerprint';
import { api } from '../utils/api';
import LocalLogin from './LocalLogin';
import SetupWizard from './SetupWizard';
import { AuthenticatedUser, AuthProvider, DEFAULT_AUTH_CONTEXT } from './authContext';

interface LoginGateProps {
    children: React.ReactNode;
}

type ScreenState =
    | { type: 'loading' }
    | { type: 'setup' }
    | { type: 'login'; googleLinked: boolean }
    | { type: 'authenticated'; user: AuthenticatedUser; isCreator: boolean; googleLinked: boolean };

export const LoginGate: React.FC<LoginGateProps> = ({ children }) => {
    const [screen, setScreen] = useState<ScreenState>({ type: 'loading' });

    const toAuthenticatedScreen = useCallback((
        user: AuthenticatedUser,
        isCreator = false,
        googleLinked = false
    ): ScreenState => ({
        type: 'authenticated',
        user,
        isCreator,
        googleLinked
    }), []);

    // Check auth state on mount
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const status = await api.get<{
                    authenticated: boolean;
                    user: AuthenticatedUser | null;
                    isCreator: boolean;
                    googleLinked: boolean;
                }>('/v1/identity/status');

                if (status.authenticated && status.user) {
                    setScreen(toAuthenticatedScreen(
                        status.user,
                        status.isCreator || status.user.role === 'CREATOR',
                        status.googleLinked || false
                    ));
                    return;
                }
            } catch (error) {
                console.warn('[LoginGate] Session status check failed, falling back to device trust');
            }

            // First try auto-login via device fingerprint
            const result = await checkDeviceTrust();

            if (result.trusted && result.user) {
                setScreen(toAuthenticatedScreen(
                    result.user,
                    result.isCreator || false,
                    result.googleLinked || false
                ));
                return;
            }

            // Auto-login failed - check if setup is needed
            if (result.needsSetup) {
                setScreen({ type: 'setup' });
                return;
            }

            // Users exist but this device isn't trusted - need login
            setScreen({ type: 'login', googleLinked: result.googleLinked || false });
        };

        checkAuth();
    }, [toAuthenticatedScreen]);

    // Listen for OAuth popup success (both login and link modes)
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // Validate origin to prevent cross-origin message injection
            if (event.origin !== window.location.origin) return;

            if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
                setScreen(toAuthenticatedScreen(
                    {
                        email: event.data.email,
                        name: event.data.name || event.data.email?.split('@')[0] || 'User',
                        role: event.data.role || (event.data.isCreator ? 'CREATOR' : 'USER')
                    },
                    event.data.isCreator,
                    true
                ));
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [toAuthenticatedScreen]);

    const authValue = screen.type === 'authenticated'
        ? {
            authenticated: true,
            user: screen.user,
            isCreator: screen.isCreator,
            googleLinked: screen.googleLinked
        }
        : DEFAULT_AUTH_CONTEXT;

    const handleGoogleLogin = useCallback(() => {
        startGoogleAuth();
    }, []);

    // ─── Loading ────────────────────────────────────────────────
    if (screen.type === 'loading') {
        return (
            <AuthProvider value={authValue}>
                <div className="h-screen w-screen bg-slate-950 flex items-center justify-center">
                    <div className="text-center">
                        <div className="relative w-20 h-20 mx-auto mb-4">
                            <img
                                src="/logo/isotipo-oscuro.png"
                                alt="Silhouette"
                                className="w-20 h-20 object-contain"
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
                        <p className="text-slate-400 text-sm tracking-wider uppercase">Loading OS Kernel...</p>
                        <style>{`
                            @keyframes logoGlow {
                                0%, 100% { filter: drop-shadow(0 0 20px rgba(6, 182, 212, 0.3)); transform: scale(1); }
                                50% { filter: drop-shadow(0 0 30px rgba(6, 182, 212, 0.6)); transform: scale(1.05); }
                            }
                        `}</style>
                    </div>
                </div>
            </AuthProvider>
        );
    }

    // ─── First-time Setup ───────────────────────────────────────
    if (screen.type === 'setup') {
        return (
            <AuthProvider value={authValue}>
                <SetupWizard
                    onComplete={(session, user) => setScreen(toAuthenticatedScreen(
                        user,
                        user.role === 'CREATOR',
                        false
                    ))}
                />
            </AuthProvider>
        );
    }

    // ─── Local Login (n8n style) ────────────────────────────────
    if (screen.type === 'login') {
        return (
            <AuthProvider value={authValue}>
                <LocalLogin
                    onComplete={(session, user) => setScreen(toAuthenticatedScreen(
                        user,
                        user.role === 'CREATOR',
                        user.googleLinked || false
                    ))}
                    onGoogleLogin={handleGoogleLogin}
                />
            </AuthProvider>
        );
    }

    // ─── Authenticated ──────────────────────────────────────────
    return (
        <AuthProvider value={authValue}>
            <div className="relative min-h-screen">
                {children}
            </div>
        </AuthProvider>
    );
};

export default LoginGate;
