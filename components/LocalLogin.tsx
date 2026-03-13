import React, { useState } from 'react';
import { api } from '../utils/api';

interface LocalLoginProps {
    onComplete: (session: any, user: any) => void;
    onGoogleLogin: () => void;
}

export const LocalLogin: React.FC<LocalLoginProps> = ({ onComplete, onGoogleLogin }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        try {
            setLoading(true);
            const data = await api.post<any>('/v1/identity/login', {
                email,
                password
            });

            // Persist session for subsequent API requests (api.ts reads this)
            if (data.session?.id) {
                localStorage.setItem('silhouette_session_id', data.session.id);
            }

            onComplete(data.session, data.user);
        } catch (err: any) {
            setError(err.message || "Invalid credentials");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen w-screen bg-slate-950 flex items-center justify-center relative overflow-hidden">
            {/* Background elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-900/10 blur-[120px] rounded-full"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-900/10 blur-[100px] rounded-full"></div>
            </div>

            <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-xl border border-slate-800/60 rounded-2xl p-8 shadow-2xl relative z-10 transition-all hover:border-slate-700/60">
                <div className="text-center mb-8">
                    {/* Logo */}
                    <div className="mb-6">
                        <div className="w-32 h-32 mx-auto mb-4 rounded-2xl flex items-center justify-center relative">
                            <img
                                src="/logo/isotipo-oscuro.png"
                                alt="Silhouette"
                                className="w-32 h-32 object-contain hover:scale-105 transition-transform duration-500"
                                style={{ filter: 'drop-shadow(0 0 20px rgba(6, 182, 212, 0.2))' }}
                            />
                        </div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                            SILHOUETTE
                        </h1>
                        <p className="text-slate-500 text-sm mt-1 tracking-wide">Agency OS v2.0</p>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 p-3 bg-red-950/40 border border-red-900/50 rounded flex items-center gap-2 text-red-200 text-sm animate-pulse">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-slate-950/80 border border-slate-800 rounded-lg px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
                            placeholder="Email Address"
                        />
                    </div>

                    <div>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-slate-950/80 border border-slate-800 rounded-lg px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
                            placeholder="Password"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold py-3 px-4 rounded-lg shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all duration-300 ${loading ? 'opacity-70 cursor-wait' : 'hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] hover:-translate-y-0.5'}`}
                    >
                        {loading && (
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        )}
                        {loading ? 'Authenticating...' : 'Access Neural Core'}
                    </button>

                    <div className="relative flex py-5 items-center">
                        <div className="flex-grow border-t border-slate-800"></div>
                        <span className="flex-shrink-0 mx-4 text-slate-500 text-xs">OR</span>
                        <div className="flex-grow border-t border-slate-800"></div>
                    </div>

                    {/* Google Login button */}
                    <button
                        type="button"
                        onClick={onGoogleLogin}
                        className="flex items-center justify-center gap-3 w-full px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-all"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                        Sign In with Google
                    </button>
                </form>
            </div>
        </div>
    );
};

export default LocalLogin;
