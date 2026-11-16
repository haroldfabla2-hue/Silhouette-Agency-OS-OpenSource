import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EXPECTED_SQL: Record<string, string> = {
    "001_baseline_indexes.down.sql": "88669be76ff558d35f548afd1fdbcf3ef30502319d04651d83c9a53548fc02d1",
    "001_baseline_indexes.up.sql": "5fd2b4f9cde9d6f3379a9cb5088afb7e1cd9b6837736638e3eba9762903e1f51",
    "002_facts_table.down.sql": "8819268fa2550972478fa5c0ab77c9b7d75070dbf4db6c7ea20a10ff398043af",
    "002_facts_table.up.sql": "dfaa2acbf809e9f6ff9ae48041fad92f0c319666fcee949c089e9ae903b34ae6",
    "003_user_profiles.down.sql": "4d4ee35139f14a8dfeb20403092d7df032ee1f4383bbc62789e42cf40ead5231",
    "003_user_profiles.up.sql": "f35a12904a00254affd1c8d3078530d959a13ff25e9ea5853fe5cb88dcdcaf8f",
    "004_incidents.down.sql": "c20c496deb750c55dda332d6cb592fa7ec0950a4a35139fb3705925a24e6c747",
    "004_incidents.up.sql": "9dbdd0e8505c937caf829f4fa24823740d27a599fbf52331eb4b2aecd821c24a"
};

/** Read-only, complete immutable asset contract. Does not open or mutate a DB. */
export function verifiedMigrationAssets(root: string): string[] {
    const actual = fs.readdirSync(root).sort();
    const expected = Object.keys(EXPECTED_SQL).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('SQLite migration asset set mismatch');
    for (const file of expected) {
        const full = path.join(root, file);
        if (!fs.lstatSync(full).isFile()) throw new Error('SQLite migration asset is not a regular file');
        const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        if (hash !== EXPECTED_SQL[file]) throw new Error('SQLite migration asset hash mismatch');
    }
    const up = expected.filter(file => file.endsWith('.up.sql'));
    if (!up.length) throw new Error('SQLite migration up set empty');
    return up;
}
