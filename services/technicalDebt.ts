import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

export interface DebtItem {
    id: string;
    description: string;
    affectedComponent: string;
    appliedPatch: string;
    timestamp: number;
    status: 'ACTIVE' | 'RESOLVED' | 'ANALYSING';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

class TechnicalDebtService {
    private debtLog: Map<string, DebtItem> = new Map();

    constructor() {
        console.log('[TechnicalDebt] Initialized. Monitoring for Incidents.');
        this.setupListeners();
    }

    private setupListeners() {
        systemBus.subscribe(SystemProtocol.INCIDENT_REPORT, (event) => {
            if (event.payload && event.payload.remediationType === 'PATCH') {
                this.recordDebt(event.payload);
            }
        });
    }

    private recordDebt(payload: any) {
        const id = crypto.randomUUID();
        const item: DebtItem = {
            id,
            description: payload.error || "Unknown Error",
            affectedComponent: payload.component || "Unknown",
            appliedPatch: payload.patchDetails || "Auto-Patch",
            timestamp: Date.now(),
            status: 'ACTIVE',
            severity: 'HIGH' // Default to high for auto-patches
        };

        this.debtLog.set(id, item);
        console.log(`[TechnicalDebt] 📉 New Debt Recorded: ${item.description} (${id})`);

        // Trigger Research Request?
        // systemBus.emit(SystemProtocol.RESEARCH_REQUEST, { topic: "Root Cause Analysis", context: item }, "TECH_DEBT");
    }

    public getActiveDebt(): DebtItem[] {
        return Array.from(this.debtLog.values()).filter(i => i.status === 'ACTIVE');
    }

    public resolveDebt(id: string) {
        if (this.debtLog.has(id)) {
            const item = this.debtLog.get(id)!;
            item.status = 'RESOLVED';
            this.debtLog.set(id, item);
            console.log(`[TechnicalDebt] 📈 Debt Resolved: ${id}`);
        }
    }
}

export const technicalDebt = new TechnicalDebtService();
