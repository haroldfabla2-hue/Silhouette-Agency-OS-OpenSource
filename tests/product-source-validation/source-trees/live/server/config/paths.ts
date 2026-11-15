
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root is essentially up from server/config -> server -> root
export const PROJECT_ROOT = path.resolve(__dirname, '../../');

export const PATHS = {
    ROOT: PROJECT_ROOT,
    UPLOADS: path.join(PROJECT_ROOT, 'uploads'),
    DATA: path.join(PROJECT_ROOT, 'data'),
    DB: path.join(PROJECT_ROOT, 'db'),
    MEMORY_FILE: path.join(PROJECT_ROOT, 'silhouette_memory_db.json'), // Deprecated but kept for ref
    CHAT_HISTORY_FILE: path.join(PROJECT_ROOT, 'silhouette_chat_history.json'), // Deprecated
    UI_STATE_FILE: path.join(PROJECT_ROOT, 'ui_state.json'), // Deprecated
    COST_METRICS_FILE: path.join(PROJECT_ROOT, 'cost_metrics.json'), // Deprecated
    GENESIS_DB: path.join(PROJECT_ROOT, 'genesis_db.json'),
    UniversalPrompts: path.join(PROJECT_ROOT, 'universalprompts')
};
