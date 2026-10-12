import { describe, it, expect } from 'vitest';
import fs from 'fs';

const routes = fs.readFileSync('server/routes/v1/voice.routes.ts', 'utf8');
const engine = fs.readFileSync('voice_engine/main.py', 'utf8');

describe('Tanda 6: real voice cloning (cloud + local)', () => {
  it('supports a local provider and an elevenlabs provider', () => {
    expect(routes).toContain("provider === 'local'");
    expect(routes).toContain('isLocalEngineAvailable');
    expect(routes).toContain('/clone/providers');
  });
  it('declares honest UNAVAILABLE with install steps', () => {
    expect(routes).toContain('UNAVAILABLE: no voice cloning provider is ready');
    expect(routes).toContain('uvicorn main:app --port 8100');
  });
  it('local engine reads name as multipart form field', () => {
    expect(engine).toContain('name: str = Form(...)');
  });
});
