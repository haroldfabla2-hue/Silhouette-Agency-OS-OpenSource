import React from 'react';

interface Props {
    children: React.ReactNode;
    name?: string;
    compact?: boolean;
}

interface State {
    hasError: boolean;
}

export class SystemErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error) {
        console.error(`[UI] ${this.props.name || 'module'} crashed`, error);
    }

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        if (this.props.compact) {
            return null;
        }

        return (
            <div className="flex min-h-[40vh] items-center justify-center px-4">
                <div className="max-w-lg rounded-2xl border border-red-500/20 bg-slate-950/90 p-6 text-center shadow-2xl">
                    <div className="text-sm font-mono uppercase tracking-[0.28em] text-red-400/70">UI Safeguard</div>
                    <h2 className="mt-3 text-xl font-semibold text-white">A module failed to render</h2>
                    <p className="mt-2 text-sm text-slate-400">
                        {this.props.name || 'This panel'} hit a runtime error. The rest of the interface stays available.
                    </p>
                </div>
            </div>
        );
    }
}
