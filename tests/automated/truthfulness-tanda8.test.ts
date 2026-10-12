import { describe, it, expect } from 'vitest';
import fs from 'fs';

const sysinfo = fs.readFileSync('mocks/systeminformation.ts', 'utf8');
const gemini = fs.readFileSync('mocks/geminiService.ts', 'utf8');
const continuum = fs.readFileSync('mocks/continuumMemory.ts', 'utf8');
const redis = fs.readFileSync('mocks/redisClient.ts', 'utf8');
const ollama = fs.readFileSync('mocks/ollamaService.ts', 'utf8');
const lancedb = fs.readFileSync('mocks/lancedbService.ts', 'utf8');
const arbiter = fs.readFileSync('services/resourceArbiter.ts', 'utf8');
const catalog = fs.readFileSync('services/modelCatalog.ts', 'utf8');
const gateway = fs.readFileSync('services/llmGateway.ts', 'utf8');
const telephony = fs.readFileSync('services/telephony/telephonyService.ts', 'utf8');

describe('Tanda 8: A10 browser shims never fabricate', () => {
  it('systeminformation shim throws UNAVAILABLE instead of fake hardware', () => {
    expect(sysinfo).toContain('UNAVAILABLE');
    expect(sysinfo).not.toContain('Neural Engine');
    expect(sysinfo).not.toContain('Math.random');
  });
  it('gemini shim never returns a fabricated model response', () => {
    expect(gemini).toContain('UNAVAILABLE');
    expect(gemini).not.toContain('Mock response');
  });
  it('memory shims fail loudly instead of fabricating empty memory', () => {
    for (const src of [continuum, lancedb]) {
      expect(src).toContain('UNAVAILABLE');
      expect(src).not.toMatch(/return \[\];/);
    }
  });
  it('redis shim never reports a connected client', () => {
    expect(redis).toContain('UNAVAILABLE');
    expect(redis).not.toContain('this.isReady = true');
  });
  it('ollama shim fails loudly', () => {
    expect(ollama).toContain('UNAVAILABLE');
    expect(ollama).not.toContain('Mock response');
  });
});

describe('Tanda 8: A11 resource arbiter estimates are flagged', () => {
  it('fallback metrics are marked estimated with no invented GB figures', () => {
    expect(arbiter).toContain('estimated: true');
    expect(arbiter).not.toContain('8GB Mock');
  });
});

describe('Tanda 8: C5 MiniMax default model is current', () => {
  it('no retired abab6.5s-chat as default', () => {
    expect(catalog).not.toContain('abab6.5s-chat');
    expect(gateway).not.toContain('abab6.5s-chat');
    expect(catalog).toContain('MiniMax-M2.7-highspeed');
  });
});

describe('Tanda 8: C7 no fictional default sender number for real calls', () => {
  it('fails honestly when no TWILIO_PHONE_NUMBER is configured', () => {
    expect(telephony).toContain('UNAVAILABLE: no sender phone number configured');
    expect(telephony).not.toContain("process.env.TWILIO_PHONE_NUMBER || '+15550199000'");
  });
});
