// =============================================================================
// Login Gate
// Authentication wrapper - handles first-time setup, login, and Google linking
//
// Flow:
//   1. First visit (no users) → Setup screen → Enter name → CREATOR
//   2. Returning device → Auto-login via fingerprint
//   3. New device + Google linked → "Continue with Google"
//   4. New device + no Google → "Use your registered device"
// =============================================================================

import React, { useEffect, useState, useCallback } from 'react';
import { checkDeviceTrust, startGoogleAuth, generateFingerprint, getDeviceName } from '../utils/fingerprint';

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
    const [setupName, setSetupName] = useState('');
    const [setupLoading, setSetupLoading] = useState(false);
    const [setupError, setSetupError] = useState('');

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

    // Handle first-time setup
    const handleSetup = useCallback(async () => {
        if (!setupName.trim()) {
            setSetupError('Please enter your name');
            return;
        }

        setSetupLoading(true);
        setSetupError('');

        try {
            const fingerprint = generateFingerprint();
            const deviceNameStr = getDeviceName();

            const response = await fetch('/v1/identity/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: setupName.trim(),
                    fingerprint,
                    deviceName: deviceNameStr
                })
            });

            const data = await response.json();

            if (data.success) {
                setScreen({
                    type: 'authenticated',
                    user: data.user,
                    isCreator: true,
                    googleLinked: false
                });
            } else {
                setSetupError(data.error || 'Setup failed');
            }
        } catch (error: any) {
            setSetupError('Connection error. Is the server running?');
        } finally {
            setSetupLoading(false);
        }
    }, [setupName]);

    const handleGoogleLogin = useCallback(() => {
        startGoogleAuth();
    }, []);

    // ─── Loading ────────────────────────────────────────────────
    if (screen.type === 'loading') {
        return (
            <div className="h-screen w-screen bg-slate-900 flex items-center justify-center">
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

    // ─── First-time Setup ───────────────────────────────────────
    if (screen.type === 'setup') {
        return (
            <div className="h-screen w-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
                <div className="text-center max-w-md mx-auto px-6">
                    {/* Logo */}
                    <div className="mb-8">
                        <div className="w-32 h-32 mx-auto mb-4">
                            <img
                                src="/logo/isotipo-oscuro.png"
                                alt="Silhouette"
                                className="w-32 h-32 object-contain"
                                style={{ filter: 'drop-shadow(0 0 15px rgba(6, 182, 212, 0.3))' }}
                            />
                        </div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                            Welcome to Silhouette
                        </h1>
                        <p className="text-slate-400 text-sm mt-2">
                            Let's set up your Agency OS
                        </p>
                    </div>

                    {/* Setup form */}
                    <div className="bg-slate-800/60 backdrop-blur rounded-2xl p-6 border border-slate-700/50">
                        <label className="block text-left text-sm text-slate-400 mb-2">
                            Your name
                        </label>
                        <input
                            type="text"
                            value={setupName}
                            onChange={(e) => { setSetupName(e.target.value); setSetupError(''); }}
                            onKeyDown={(e) => e.key === 'Enter' && handleSetup()}
                            placeholder="Enter your name..."
                            className="w-full px-4 py-3 bg-slate-900/60 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/25 transition-colors"
                            autoFocus
                            disabled={setupLoading}
                        />

                        {setupError && (
                            <p className="text-red-400 text-sm mt-2 text-left">{setupError}</p>
                        )}

                        <button
                            onClick={handleSetup}
                            disabled={setupLoading || !setupName.trim()}
                            className="w-full mt-4 px-6 py-3 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 disabled:from-slate-600 disabled:to-slate-600 text-white rounded-xl font-medium shadow-lg transition-all hover:scale-[1.02] disabled:hover:scale-100 disabled:cursor-not-allowed"
                        >
                            {setupLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Setting up...
                                </span>
                            ) : 'Initialize Silhouette'}
                        </button>

                        <p className="text-xs text-slate-500 mt-4">
                            You'll be registered as the admin. You can link your Google account later to unlock Drive, Gmail, and Calendar.
                        </p>
                    </div>

                    {/* Device info */}
                    <p className="text-xs text-slate-600 mt-6">
                        This device will be remembered for automatic login
                    </p>
                </div>
            </div>
        );
    }

    // ─── Login (users exist, device not trusted) ────────────────
    if (screen.type === 'login') {
        return (
            <div className="h-screen w-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
                <div className="text-center">
                    {/* Logo */}
                    <div className="mb-8">
                        <div className="w-48 h-48 mx-auto mb-4 rounded-2xl flex items-center justify-center">
                            <img
                                src="/logo/isotipo-oscuro.png"
                                alt="Silhouette"
                                className="w-48 h-48 object-contain hover:scale-110 transition-transform duration-300"
                                style={{ filter: 'drop-shadow(0 0 15px rgba(6, 182, 212, 0.3))' }}
                            />
                        </div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                            SILHOUETTE
                        </h1>
                        <p className="text-slate-500 text-sm mt-1">Agency OS v2.0</p>
                    </div>

                    {screen.googleLinked ? (
                        <>
                            {/* Google login available */}
                            <button
                                onClick={handleGoogleLogin}
                                className="flex items-center gap-3 px-6 py-3 bg-white hover:bg-gray-100 text-gray-800 rounded-xl font-medium shadow-lg transition-all hover:scale-105 mx-auto"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                </svg>
                                Continue with Google
                            </button>
                            <p className="mt-4 text-xs text-slate-600">
                                Your device will be remembered for automatic login
                            </p>
                        </>
                    ) : (
                        <>
                            {/* No Google linked yet - device-only access */}
                            <div className="bg-slate-800/60 backdrop-blur rounded-2xl p-6 border border-slate-700/50 max-w-sm mx-auto">
                                <div className="text-slate-400 text-sm mb-3">
                                    <svg className="w-8 h-8 mx-auto mb-2 text-amber-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                    <p>This instance hasn't linked a Google account yet.</p>
                                    <p className="mt-2 text-slate-500">
                                        Access from the device where Silhouette was set up, then link Google from Settings to enable multi-device access.
                                    </p>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    }

    // ─── Authenticated ──────────────────────────────────────────
    return (
        <div className="relative">
            {children}
        </div>
    );
};

export default LoginGate;
