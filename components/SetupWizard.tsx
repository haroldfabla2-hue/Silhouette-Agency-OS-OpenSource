import React, { useState } from 'react';
import { api } from '../utils/api';

interface SetupWizardProps {
    onComplete: (session: any, user: any) => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password !== confirm) {
            setError("Passwords do not match");
            return;
        }
        if (password.length < 8) {
            setError("Password must be at least 8 characters");
            return;
        }

        try {
            setLoading(true);
            const data = await api.post<any>('/v1/identity/setup', {
                email,
                name,
                password
            });

            // Setup complete, pass session back to LoginGate
            onComplete(data.session, data.user);
        } catch (err: any) {
            setError(err.message || "Failed to complete setup");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
            {/* Background elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-900/20 blur-[100px] rounded-full"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-900/20 blur-[100px] rounded-full"></div>
            </div>

            <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-8 shadow-2xl relative z-10">
                <div className="text-center mb-8">
                    <div className="relative w-20 h-20 mx-auto mb-6">
                        <img
                            src="/logo/isotipo-oscuro.png"
                            alt="Silhouette"
                            className="w-20 h-20 object-contain"
                            style={{ filter: 'drop-shadow(0 0 15px rgba(6, 182, 212, 0.4))' }}
                        />
                        <div className="absolute inset-0 border border-cyan-500/30 rounded-full animate-ping" style={{ animationDuration: '3s' }} />
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-2">Welcome to Silhouette</h1>
                    <p className="text-slate-400 text-sm">Create the initial administrative account. This user will have absolute control over the system.</p>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-950/50 border border-red-900/50 rounded-lg text-red-200 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-slate-400 text-xs font-medium mb-1 uppercase tracking-wider">Full Name</label>
                        <input
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
                            placeholder="John Doe"
                        />
                    </div>

                    <div>
                        <label className="block text-slate-400 text-xs font-medium mb-1 uppercase tracking-wider">Email Address</label>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
                            placeholder="admin@silhouette.local"
                        />
                    </div>

                    <div>
                        <label className="block text-slate-400 text-xs font-medium mb-1 uppercase tracking-wider">Master Password</label>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
                            placeholder="••••••••"
                        />
                    </div>

                    <div>
                        <label className="block text-slate-400 text-xs font-medium mb-1 uppercase tracking-wider">Confirm Password</label>
                        <input
                            type="password"
                            required
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
                            placeholder="••••••••"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full mt-6 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold py-3 px-4 rounded-lg shadow-lg shadow-cyan-900/20 transition-all ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02]'}`}
                    >
                        {loading ? 'Initializing System...' : 'Create Admin Account'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default SetupWizard;
