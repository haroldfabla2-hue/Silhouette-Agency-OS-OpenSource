-- Exact input-set admission. STARTED includes interrupted/unknown calls and is
-- never automatically retried. This is not an execution or provider grant.
CREATE TABLE IF NOT EXISTS learning_analysis (
    input_hash TEXT PRIMARY KEY,
    input_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('STARTED', 'COMPLETE')),
    result_json TEXT,
    CHECK ((state = 'STARTED' AND result_json IS NULL) OR (state = 'COMPLETE' AND result_json IS NOT NULL))
);
