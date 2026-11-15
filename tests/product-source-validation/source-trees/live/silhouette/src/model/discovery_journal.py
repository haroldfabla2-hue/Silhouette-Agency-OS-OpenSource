"""
NANOSILHOUETTE - Discovery Journal
====================================
Persistent memory of discovery decisions with SQLite backend.

Designed for AGI-scale robustness:
- SQLite for ACID compliance and durability
- Efficient querying for pattern analysis
- Prevention of re-evaluation (no wasted computation)
- Statistical analysis for meta-learning
- Safe concurrent access

Biological analog: Hippocampal memory consolidation
"""
import sqlite3
import json
import time
import threading
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
from contextlib import contextmanager


class DiscoveryDecision(Enum):
    """Mirrors the decision types from discovery_engine."""
    ACCEPT = "accept"
    REFINE = "refine"
    DEFER = "defer"
    REJECT = "reject"


class FinalOutcome(Enum):
    """Final outcome after all processing."""
    INTEGRATED = "integrated"      # Successfully added to knowledge
    RESEARCHED = "researched"      # Refined and resolved
    ABANDONED = "abandoned"        # Deferred too many times
    DISCARDED = "discarded"        # Rejected as invalid


@dataclass
class DiscoveryEntry:
    """A single discovery decision record."""
    id: str
    timestamp: float
    source_node: str
    target_node: str
    decision: str  # DiscoveryDecision.value
    confidence: float
    validation_score: float
    reasoning_trace: str  # JSON serialized
    discovery_source: str  # "gnn", "eureka", "open_triangle"
    relation_type: str
    retry_count: int = 0
    final_outcome: str = ""  # FinalOutcome.value or empty
    refinement_hint: str = ""
    metadata: str = "{}"  # JSON serialized
    
    def to_dict(self) -> Dict:
        return asdict(self)
    
    @classmethod
    def from_row(cls, row: Tuple) -> "DiscoveryEntry":
        return cls(
            id=row[0],
            timestamp=row[1],
            source_node=row[2],
            target_node=row[3],
            decision=row[4],
            confidence=row[5],
            validation_score=row[6],
            reasoning_trace=row[7],
            discovery_source=row[8],
            relation_type=row[9],
            retry_count=row[10],
            final_outcome=row[11],
            refinement_hint=row[12],
            metadata=row[13]
        )


class DiscoveryJournal:
    """
    Persistent journal of all discovery decisions.
    
    Features:
    - SQLite backend for durability
    - Efficient lookups to avoid re-processing
    - Statistical queries for meta-learning
    - Thread-safe access
    - Automatic schema migration
    """
    
    SCHEMA_VERSION = 1
    
    def __init__(self, db_path: Optional[Path] = None):
        """
        Initialize the journal.
        
        Args:
            db_path: Path to SQLite database. If None, uses default location.
        """
        if db_path is None:
            db_path = Path("./silhouette_discovery.db")
        
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        
        self._lock = threading.RLock()
        
        self._init_database()
    
    @contextmanager
    def _get_connection(self):
        """Thread-safe connection context manager."""
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.execute("PRAGMA journal_mode=WAL")  # Better concurrency
        conn.execute("PRAGMA synchronous=NORMAL")  # Good balance of safety/speed
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    
    def _init_database(self):
        """Initialize database schema."""
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                # Main discoveries table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS discoveries (
                        id TEXT PRIMARY KEY,
                        timestamp REAL NOT NULL,
                        source_node TEXT NOT NULL,
                        target_node TEXT NOT NULL,
                        decision TEXT NOT NULL,
                        confidence REAL NOT NULL,
                        validation_score REAL NOT NULL,
                        reasoning_trace TEXT,
                        discovery_source TEXT,
                        relation_type TEXT,
                        retry_count INTEGER DEFAULT 0,
                        final_outcome TEXT DEFAULT '',
                        refinement_hint TEXT DEFAULT '',
                        metadata TEXT DEFAULT '{}'
                    )
                """)
                
                # Indices for efficient queries
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_source_target 
                    ON discoveries(source_node, target_node)
                """)
                
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_decision 
                    ON discoveries(decision)
                """)
                
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_timestamp 
                    ON discoveries(timestamp)
                """)
                
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_final_outcome 
                    ON discoveries(final_outcome)
                """)
                
                # Schema version tracking
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS schema_meta (
                        key TEXT PRIMARY KEY,
                        value TEXT
                    )
                """)
                
                cursor.execute("""
                    INSERT OR REPLACE INTO schema_meta (key, value)
                    VALUES ('version', ?)
                """, (str(self.SCHEMA_VERSION),))
    
    def log_discovery(
        self,
        source_node: str,
        target_node: str,
        decision: DiscoveryDecision,
        confidence: float,
        validation_score: float,
        reasoning_trace: List[str],
        discovery_source: str,
        relation_type: str,
        metadata: Optional[Dict] = None
    ) -> str:
        """
        Log a discovery decision.
        
        Returns the entry ID.
        """
        entry_id = f"disc_{int(time.time() * 1000)}_{source_node[:8]}_{target_node[:8]}"
        
        entry = DiscoveryEntry(
            id=entry_id,
            timestamp=time.time(),
            source_node=source_node,
            target_node=target_node,
            decision=decision.value,
            confidence=confidence,
            validation_score=validation_score,
            reasoning_trace=json.dumps(reasoning_trace),
            discovery_source=discovery_source,
            relation_type=relation_type,
            metadata=json.dumps(metadata or {})
        )
        
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO discoveries (
                        id, timestamp, source_node, target_node, decision,
                        confidence, validation_score, reasoning_trace,
                        discovery_source, relation_type, retry_count,
                        final_outcome, refinement_hint, metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    entry.id, entry.timestamp, entry.source_node, entry.target_node,
                    entry.decision, entry.confidence, entry.validation_score,
                    entry.reasoning_trace, entry.discovery_source, entry.relation_type,
                    entry.retry_count, entry.final_outcome, entry.refinement_hint,
                    entry.metadata
                ))
        
        return entry_id
    
    def was_rejected(self, source_node: str, target_node: str) -> bool:
        """
        Check if a connection was previously rejected.
        
        Prevents wasted computation on known-bad candidates.
        """
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT COUNT(*) FROM discoveries
                    WHERE source_node = ? AND target_node = ? AND decision = ?
                """, (source_node, target_node, DiscoveryDecision.REJECT.value))
                
                return cursor.fetchone()[0] > 0
    
    def was_accepted(self, source_node: str, target_node: str) -> bool:
        """
        Check if a connection was previously accepted.
        
        Prevents duplicate processing.
        """
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT COUNT(*) FROM discoveries
                    WHERE source_node = ? AND target_node = ? AND decision = ?
                """, (source_node, target_node, DiscoveryDecision.ACCEPT.value))
                
                return cursor.fetchone()[0] > 0
    
    def get_pending_refinements(self, limit: int = 10) -> List[DiscoveryEntry]:
        """
        Get discoveries marked for refinement that haven't been resolved.
        """
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT * FROM discoveries
                    WHERE decision = ? AND final_outcome = ''
                    ORDER BY validation_score DESC
                    LIMIT ?
                """, (DiscoveryDecision.REFINE.value, limit))
                
                return [DiscoveryEntry.from_row(row) for row in cursor.fetchall()]
    
    def get_deferred_ready_for_retry(
        self,
        min_age_seconds: float = 300
    ) -> List[DiscoveryEntry]:
        """
        Get deferred discoveries ready for retry.
        """
        cutoff = time.time() - min_age_seconds
        
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT * FROM discoveries
                    WHERE decision = ? AND final_outcome = '' AND timestamp < ?
                    ORDER BY retry_count ASC, validation_score DESC
                    LIMIT 10
                """, (DiscoveryDecision.DEFER.value, cutoff))
                
                return [DiscoveryEntry.from_row(row) for row in cursor.fetchall()]
    
    def update_final_outcome(
        self,
        entry_id: str,
        outcome: FinalOutcome,
        refinement_hint: str = ""
    ):
        """Update the final outcome of a discovery."""
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE discoveries
                    SET final_outcome = ?, refinement_hint = ?
                    WHERE id = ?
                """, (outcome.value, refinement_hint, entry_id))
    
    def increment_retry(self, entry_id: str) -> int:
        """Increment retry count and return new count."""
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE discoveries
                    SET retry_count = retry_count + 1
                    WHERE id = ?
                """, (entry_id,))
                
                cursor.execute("SELECT retry_count FROM discoveries WHERE id = ?", (entry_id,))
                row = cursor.fetchone()
                return row[0] if row else 0
    
    def get_recent_discoveries(
        self,
        limit: int = 100,
        decision_filter: Optional[DiscoveryDecision] = None
    ) -> List[DiscoveryEntry]:
        """Get recent discovery entries."""
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                if decision_filter:
                    cursor.execute("""
                        SELECT * FROM discoveries
                        WHERE decision = ?
                        ORDER BY timestamp DESC
                        LIMIT ?
                    """, (decision_filter.value, limit))
                else:
                    cursor.execute("""
                        SELECT * FROM discoveries
                        ORDER BY timestamp DESC
                        LIMIT ?
                    """, (limit,))
                
                return [DiscoveryEntry.from_row(row) for row in cursor.fetchall()]
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Get aggregated statistics for meta-learning.
        
        Returns comprehensive stats about discovery patterns.
        """
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                stats = {}
                
                # Total counts by decision
                cursor.execute("""
                    SELECT decision, COUNT(*) as count
                    FROM discoveries
                    GROUP BY decision
                """)
                decision_counts = {row[0]: row[1] for row in cursor.fetchall()}
                stats["by_decision"] = decision_counts
                
                # Total counts by source
                cursor.execute("""
                    SELECT discovery_source, COUNT(*) as count
                    FROM discoveries
                    GROUP BY discovery_source
                """)
                source_counts = {row[0]: row[1] for row in cursor.fetchall()}
                stats["by_source"] = source_counts
                
                # Average confidence by decision
                cursor.execute("""
                    SELECT decision, AVG(confidence) as avg_conf
                    FROM discoveries
                    GROUP BY decision
                """)
                avg_conf = {row[0]: row[1] for row in cursor.fetchall()}
                stats["avg_confidence"] = avg_conf
                
                # Final outcomes
                cursor.execute("""
                    SELECT final_outcome, COUNT(*) as count
                    FROM discoveries
                    WHERE final_outcome != ''
                    GROUP BY final_outcome
                """)
                outcomes = {row[0]: row[1] for row in cursor.fetchall()}
                stats["final_outcomes"] = outcomes
                
                # Total entries
                cursor.execute("SELECT COUNT(*) FROM discoveries")
                stats["total_entries"] = cursor.fetchone()[0]
                
                # Acceptance rate
                total = stats["total_entries"]
                accepted = decision_counts.get("accept", 0)
                stats["acceptance_rate"] = accepted / max(1, total)
                
                # Success rate (accepted that were integrated)
                integrated = outcomes.get("integrated", 0)
                stats["integration_rate"] = integrated / max(1, accepted)
                
                return stats
    
    def find_patterns(self, min_occurrences: int = 3) -> Dict[str, Any]:
        """
        Analyze patterns in discoveries for meta-learning.
        
        Identifies:
        - Common relation types that get accepted
        - Discovery sources with high success rates
        - Node pairs that frequently appear
        """
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                patterns = {}
                
                # Most successful relation types
                cursor.execute("""
                    SELECT relation_type, 
                           COUNT(*) as total,
                           SUM(CASE WHEN decision = 'accept' THEN 1 ELSE 0 END) as accepted
                    FROM discoveries
                    GROUP BY relation_type
                    HAVING total >= ?
                    ORDER BY CAST(accepted AS FLOAT) / total DESC
                """, (min_occurrences,))
                patterns["successful_relations"] = [
                    {"type": row[0], "total": row[1], "accepted": row[2]}
                    for row in cursor.fetchall()
                ]
                
                # Best discovery sources
                cursor.execute("""
                    SELECT discovery_source,
                           COUNT(*) as total,
                           SUM(CASE WHEN decision = 'accept' THEN 1 ELSE 0 END) as accepted
                    FROM discoveries
                    GROUP BY discovery_source
                """)
                patterns["source_performance"] = [
                    {"source": row[0], "total": row[1], "accepted": row[2], 
                     "rate": row[2] / max(1, row[1])}
                    for row in cursor.fetchall()
                ]
                
                return patterns
    
    def cleanup_old_entries(self, max_age_days: int = 30, keep_accepted: bool = True):
        """
        Clean up old entries to manage database size.
        
        Keeps accepted entries by default since they represent validated knowledge.
        """
        cutoff = time.time() - (max_age_days * 24 * 60 * 60)
        
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                if keep_accepted:
                    cursor.execute("""
                        DELETE FROM discoveries
                        WHERE timestamp < ? AND decision != 'accept'
                    """, (cutoff,))
                else:
                    cursor.execute("""
                        DELETE FROM discoveries
                        WHERE timestamp < ?
                    """, (cutoff,))
                
                deleted = cursor.rowcount
                
                # Vacuum to reclaim space
                cursor.execute("VACUUM")
                
                return deleted
    
    def export_to_json(self, output_path: Path) -> int:
        """Export all entries to JSON for analysis."""
        entries = self.get_recent_discoveries(limit=100000)
        
        data = [e.to_dict() for e in entries]
        
        with open(output_path, 'w') as f:
            json.dump(data, f, indent=2)
        
        return len(data)
    
    def import_from_json(self, input_path: Path) -> int:
        """Import entries from JSON backup."""
        with open(input_path) as f:
            data = json.load(f)
        
        count = 0
        with self._lock:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                for entry_dict in data:
                    try:
                        cursor.execute("""
                            INSERT OR IGNORE INTO discoveries (
                                id, timestamp, source_node, target_node, decision,
                                confidence, validation_score, reasoning_trace,
                                discovery_source, relation_type, retry_count,
                                final_outcome, refinement_hint, metadata
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            entry_dict["id"], entry_dict["timestamp"],
                            entry_dict["source_node"], entry_dict["target_node"],
                            entry_dict["decision"], entry_dict["confidence"],
                            entry_dict["validation_score"], entry_dict["reasoning_trace"],
                            entry_dict["discovery_source"], entry_dict["relation_type"],
                            entry_dict.get("retry_count", 0),
                            entry_dict.get("final_outcome", ""),
                            entry_dict.get("refinement_hint", ""),
                            entry_dict.get("metadata", "{}")
                        ))
                        count += 1
                    except Exception:
                        pass
        
        return count


def create_discovery_journal(db_path: Optional[Path] = None) -> DiscoveryJournal:
    """Factory function."""
    return DiscoveryJournal(db_path)


if __name__ == "__main__":
    import tempfile
    
    print("Testing Discovery Journal...")
    
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_journal.db"
        journal = create_discovery_journal(db_path)
        
        # Test logging
        entry_id = journal.log_discovery(
            source_node="node_a",
            target_node="node_b",
            decision=DiscoveryDecision.ACCEPT,
            confidence=0.85,
            validation_score=0.9,
            reasoning_trace=["Step 1", "Step 2"],
            discovery_source="gnn",
            relation_type="related_to"
        )
        
        print(f"Logged entry: {entry_id}")
        
        # Test queries
        assert journal.was_accepted("node_a", "node_b")
        assert not journal.was_rejected("node_a", "node_b")
        
        # Test stats
        stats = journal.get_stats()
        print(f"Stats: {stats}")
        
        assert stats["total_entries"] == 1
        assert stats["by_decision"].get("accept", 0) == 1
        
        # Test patterns
        patterns = journal.find_patterns(min_occurrences=1)
        print(f"Patterns: {patterns}")
        
        print("\n✅ Discovery Journal test passed!")
