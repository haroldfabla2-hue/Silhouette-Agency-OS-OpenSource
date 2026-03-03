import React, { useState } from 'react';
import { api } from '../utils/api';

interface SetupWizardProps {
    onComplete: (session: any, user: any) => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
    const [step, setStep] = useState<1 | 2>(1);

    // Step 1 State
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');

    // Step 2 State
    const [diagnostics, setDiagnostics] = useState<any>(null);
    const [loadingDiag, setLoadingDiag] = useState(false);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleNextStep = async (e: React.FormEvent) => {
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

        setStep(2);
        fetchDiagnostics();
    };

    const fetchDiagnostics = async () => {
        setLoadingDiag(true);
        try {
            const data = await api.get<any>('/v1/system/diagnostics');
            setDiagnostics(data);
        } catch (e: any) {
            console.warn("Could not fetch diagnostics", e);
            // Provide a safe fallback if backend not updated yet
            setDiagnostics({ ram: { totalGB: 16 } });
        } finally {
            setLoadingDiag(false);
        }
    };

    const handleFinalSubmit = async () => {
        try {
            setLoading(true);
            const data = await api.post<any>('/v1/identity/setup', {
                email,
                name,
                password
            });

            // Persist session for subsequent API requests (api.ts reads this)
            if (data.session?.id) {
                localStorage.setItem('silhouette_session_id', data.session.id);
            }

            onComplete(data.session, data.user);
        } catch (err: any) {
            setError(err.message || "Failed to complete setup");
            setLoading(false);
        }
    };

    const renderStep1 = () => (
        <form onSubmit={handleNextStep} className="space-y-4">
            <h2 className="text-xl font-bold text-white mb-4">1. Admin Account</h2>
            <div>
                <label className="block text-slate-400 text-xs font-medium mb-1 uppercase tracking-wider">Full Name</label>
                <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                    placeholder="John Doe" />
            </div>
            <div>
                <label className="block text-slate-400 text-xs font-medium mb-1 uppercase tracking-wider">Email Address</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                    placeholder="admin@silhouette.local" />
            </div>
            <div>
                <label className="block text-slate-400 text-xs font-medium mb-1 uppercase tracking-wider">Master Password</label>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                    placeholder="••••••••" />
            </div>
            <div>
                <label className="block text-slate-400 text-xs font-medium mb-1 uppercase tracking-wider">Confirm Password</label>
                <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
                    placeholder="••••••••" />
            </div>
            <button type="submit" className="w-full mt-6 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold py-3 px-4 rounded-lg shadow-lg">
                Continue to Environment Setup ➔
            </button>
        </form>
    );

    const renderStep2 = () => {
        const totalRAM = diagnostics?.ram?.totalGB || 0;
        const recommendsLocal = totalRAM >= 16;

        return (
            <div className="space-y-6">
                <h2 className="text-xl font-bold text-white mb-2">2. Hardware Analysis</h2>

                {loadingDiag ? (
                    <div className="p-4 bg-slate-900 rounded-lg border border-slate-800 animate-pulse text-cyan-400">
                        Analyzing system hardware...
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 bg-slate-950/50 border border-slate-800 rounded-lg">
                                <span className="block text-xs text-slate-500 uppercase">Total Memory</span>
                                <span className="text-lg text-white font-mono">{totalRAM} GB</span>
                            </div>
                            <div className="p-3 bg-slate-950/50 border border-slate-800 rounded-lg">
                                <span className="block text-xs text-slate-500 uppercase">CPU Cores</span>
                                <span className="text-lg text-white font-mono">{diagnostics?.cpu?.cores || 8}</span>
                            </div>
                        </div>

                        <div className={`p-4 rounded-xl border ${recommendsLocal ? 'bg-cyan-950/30 border-cyan-800/50' : 'bg-purple-950/30 border-purple-800/50'}`}>
                            <h3 className="text-white font-medium mb-2 flex items-center gap-2">
                                {recommendsLocal ? '💻 Local Deep Memory Recommended' : '☁️ Cloud Deep Memory Recommended'}
                            </h3>
                            <p className="text-sm text-slate-300 mb-4">
                                {recommendsLocal
                                    ? `Your system has ${totalRAM}GB of RAM, which is ample for running Neo4j locally. We recommend using Docker for maximum data privacy.`
                                    : `Your system has ${totalRAM}GB of RAM. The 4-Tier Memory system (Neo4j) requires at least 1GB dedicated. We recommend the free Cloud Tier to save local resources.`}
                            </p>

                            <div className="bg-slate-950 rounded p-3 font-mono text-xs text-slate-400 border border-slate-800">
                                {recommendsLocal ? (
                                    <>
                                        # 1. Run in terminal:<br />
                                        docker-compose up -d neo4j<br /><br />
                                        # 2. Add to .env.local:<br />
                                        NEO4J_URI=bolt://localhost:7687<br />
                                        NEO4J_USER=neo4j<br />
                                        NEO4J_PASSWORD=silhouette
                                    </>
                                ) : (
                                    <>
                                        # 1. Visit: https://console.neo4j.io/<br />
                                        # 2. Create a Free "AuraDB" Instance<br />
                                        # 3. Add to .env.local:<br />
                                        NEO4J_URI=neo4j+s://[your-id].databases.neo4j.io<br />
                                        NEO4J_USER=neo4j<br />
                                        NEO4J_PASSWORD=[your-password]
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button onClick={() => setStep(1)} type="button" className="px-5 py-3 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-all duration-300">
                                Back
                            </button>
                            <button onClick={handleFinalSubmit} disabled={loading} className={`flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold py-3 px-4 rounded-lg shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all duration-300 ${loading ? 'opacity-70 cursor-wait' : 'hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] hover:-translate-y-0.5'}`}>
                                {loading && (
                                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                )}
                                {loading ? 'Initializing Core...' : 'Initialize & Boot OS'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-900/20 blur-[100px] rounded-full"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-900/20 blur-[100px] rounded-full"></div>
            </div>

            <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-8 shadow-2xl relative z-10">
                <div className="text-center mb-8">
                    <div className="relative w-20 h-20 mx-auto mb-6">
                        <img src="/logo/isotipo-oscuro.png" alt="Silhouette" className="w-20 h-20 object-contain" style={{ filter: 'drop-shadow(0 0 15px rgba(6, 182, 212, 0.4))' }} />
                        <div className="absolute inset-0 border border-cyan-500/30 rounded-full animate-ping" style={{ animationDuration: '3s' }} />
                    </div>
                </div>

                {error && <div className="mb-6 p-4 bg-red-950/50 border border-red-900/50 rounded-lg text-red-200 text-sm">{error}</div>}

                {step === 1 ? renderStep1() : renderStep2()}
            </div>
        </div>
    );
};

export default SetupWizard;
