// =============================================================================
// CHANNEL INTEGRATION TESTS
// Tests for channel utilities: chunking, thought filtering, typing indicator.
// =============================================================================

const assert = (condition: boolean, msg: string) => {
    if (!condition) throw new Error(`❌ FAIL: ${msg}`);
    console.log(`  ✅ ${msg}`);
};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
    try {
        fn();
        passed++;
    } catch (err: any) {
        console.error(`  ${err.message}`);
        failed++;
    }
}

// ─── CHUNK MESSAGE (replicating the logic from channels) ─────────────────────

function chunkMessage(text: string, maxLen: number = 4000): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLen) { chunks.push(remaining); break; }
        let splitAt = remaining.lastIndexOf('\n\n', maxLen);
        if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('\n', maxLen);
        if (splitAt < maxLen * 0.3) { splitAt = remaining.lastIndexOf('. ', maxLen); if (splitAt > 0) splitAt += 1; }
        if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf(' ', maxLen);
        if (splitAt <= 0) splitAt = maxLen;
        chunks.push(remaining.substring(0, splitAt).trim());
        remaining = remaining.substring(splitAt).trim();
    }
    return chunks.filter(c => c.length > 0);
}

// ─── INTERNAL PATTERNS (replicating the logic from channels) ─────────────────

const INTERNAL_PATTERNS = [
    /^\[THOUGHT\]/i, /^\[INTERNAL\]/i, /^Introspection:/i, /^<think>/i,
    /^SYSTEM:/, /^\[REFLECTIVE\]/i, /^\[COGNITIVE\]/i, /^\[SELF-HEAL\]/i,
    /^\[BUS\]/i, /^\[DAEMON\]/i,
];

function isInternalMessage(text: string): boolean {
    return INTERNAL_PATTERNS.some(p => p.test(text.trim()));
}

// ═══════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════

console.log('\n🧪 Channel Integration Tests\n');

// ─── chunkMessage tests ──────────────────────────────────────────────────────

console.log('📦 chunkMessage()');

test('Short message returns single chunk', () => {
    const result = chunkMessage('Hello world');
    assert(result.length === 1, 'Single chunk for short message');
    assert(result[0] === 'Hello world', 'Content preserved');
});

test('Long message splits at paragraph boundary', () => {
    const p1 = 'A'.repeat(3500);
    const p2 = 'B'.repeat(1500);
    const result = chunkMessage(`${p1}\n\n${p2}`);
    assert(result.length === 2, `Split into 2 chunks (got ${result.length})`);
    assert(result[0] === p1, 'First chunk is first paragraph');
    assert(result[1] === p2, 'Second chunk is second paragraph');
});

test('Very long message without paragraphs splits at newline', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'x'.repeat(50)}`).join('\n');
    const result = chunkMessage(lines, 2000);
    assert(result.length > 1, `Multiple chunks (got ${result.length})`);
    for (const chunk of result) {
        assert(chunk.length <= 2000, `Chunk length ${chunk.length} <= 2000`);
    }
});

test('Discord limit (1950) works correctly', () => {
    const text = 'W'.repeat(5000);
    const result = chunkMessage(text, 1950);
    assert(result.length >= 3, `At least 3 chunks for 5000 chars at 1950 limit (got ${result.length})`);
});

test('Empty string returns empty array or single empty', () => {
    const result = chunkMessage('');
    assert(result.length <= 1, 'Empty or single chunk');
});

test('Exact boundary message returns single chunk', () => {
    const text = 'X'.repeat(4000);
    const result = chunkMessage(text);
    assert(result.length === 1, 'Single chunk at exact boundary');
});

// ─── isInternalMessage tests ─────────────────────────────────────────────────

console.log('\n🧠 isInternalMessage()');

test('[THOUGHT] is internal', () => {
    assert(isInternalMessage('[THOUGHT] Processing cognitive loop'), 'Detected [THOUGHT]');
});

test('[INTERNAL] is internal', () => {
    assert(isInternalMessage('[INTERNAL] System check'), 'Detected [INTERNAL]');
});

test('Introspection: is internal', () => {
    assert(isInternalMessage('Introspection: analyzing...'), 'Detected Introspection:');
});

test('<think> is internal', () => {
    assert(isInternalMessage('<think>reasoning...</think>'), 'Detected <think>');
});

test('SYSTEM: is internal', () => {
    assert(isInternalMessage('SYSTEM: reboot'), 'Detected SYSTEM:');
});

test('[BUS] is internal', () => {
    assert(isInternalMessage('[BUS] message routed'), 'Detected [BUS]');
});

test('[DAEMON] is internal', () => {
    assert(isInternalMessage('[DAEMON] tick'), 'Detected [DAEMON]');
});

test('Normal user-facing message is NOT internal', () => {
    assert(!isInternalMessage('Hello! How can I help you today?'), 'Normal message passes');
});

test('Message with THOUGHT mid-text is NOT internal', () => {
    assert(!isInternalMessage('I had a [THOUGHT] about this'), 'Mid-text [THOUGHT] passes');
});

test('Whitespace before internal prefix still detected', () => {
    assert(isInternalMessage('  [THOUGHT] padded'), 'Leading whitespace handled');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`📊 Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}\n`);

if (failed > 0) {
    process.exit(1);
}
