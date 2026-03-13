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
import LocalLogin from './LocalLogin';
import SetupWizard from './SetupWizard';

interface LoginGateProps {
    children: React.ReactNode;
}

type ScreenState =
    | { type: 'loading' }
    | { type: 'setup' }
    | { type: 'login'; googleLinked: boolean }
    | { type: 'authenticated'; user: { email: string | null; name: string; role: string }; isCreator: boolean; googleLinked: boolean };

export const LoginGate: React.FC<LoginGateProps> = ({ children }) => {
    const [screen, setScreen] = useState<ScreenState>({ type: 'loading' });

    // Check auth state on mount
    useEffect(() => {
        const checkAuth = async () => {
            // First try auto-login via device fingerprint
            const result = await checkDeviceTrust();

            if (result.trusted && result.user) {
                setScreen({
                    type: 'authenticated',
                    user: result.user,
                    isCreator: result.isCreator || false,
                    googleLinked: result.googleLinked || false
                });
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
    }, []);

    // Listen for OAuth popup success (both login and link modes)
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // Validate origin to prevent cross-origin message injection
            if (event.origin !== window.location.origin) return;

            if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
                setScreen({
                    type: 'authenticated',
                    user: {
                        email: event.data.email,
                        name: event.data.name || event.data.email?.split('@')[0] || 'User',
                        role: event.data.isCreator ? 'CREATOR' : 'USER'
                    },
                    isCreator: event.data.isCreator,
                    googleLinked: true
                });
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleGoogleLogin = useCallback(() => {
        startGoogleAuth();
    }, []);

    // ─── Loading ────────────────────────────────────────────────
    if (screen.type === 'loading') {
        return (
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
        );
    }

    // ─── First-time Setup ───────────────────────────────────────
    if (screen.type === 'setup') {
        return (
            <SetupWizard
                onComplete={(session, user) => setScreen({
                    type: 'authenticated',
                    user: user,
                    isCreator: user.role === 'CREATOR',
                    googleLinked: false
                })}
            />
        );
    }

    // ─── Local Login (n8n style) ────────────────────────────────
    if (screen.type === 'login') {
        return (
            <LocalLogin
                onComplete={(session, user) => setScreen({
                    type: 'authenticated',
                    user: user,
                    isCreator: user.role === 'CREATOR',
                    googleLinked: user.googleLinked || false
                })}
                onGoogleLogin={handleGoogleLogin}
            />
        );
    }

    // ─── Authenticated ──────────────────────────────────────────
    return (
        <div className="relative min-h-screen">
            {children}
        </div>
    );
};

export default LoginGate;
