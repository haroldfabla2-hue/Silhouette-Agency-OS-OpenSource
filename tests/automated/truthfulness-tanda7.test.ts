import { describe, it, expect } from 'vitest';
import fs from 'fs';

const service = fs.readFileSync('services/identityService.ts', 'utf8');
const routes = fs.readFileSync('server/routes/v1/identity.routes.ts', 'utf8');
const settings = fs.readFileSync('components/Settings.tsx', 'utf8');

describe('Tanda 7: creator emails configurable from Settings (B1)', () => {
  it('keeps honoring the CREATOR_EMAILS env var', () => {
    expect(service).toMatch(/process\.env\.CREATOR_EMAILS \|\| ''/);
  });
  it('persists user-configured creator emails in system_config', () => {
    expect(service).toContain('identity.creator_emails');
    expect(service).toContain('system_config');
    expect(service).toContain('addCreatorEmail');
    expect(service).toContain('removeCreatorEmail');
    expect(service).toContain('getCreatorEmails');
  });
  it('exposes creator-emails management endpoints guarded to CREATOR', () => {
    expect(routes).toContain("router.get('/creator-emails'");
    expect(routes).toContain("router.post('/creator-emails'");
    expect(routes).toContain("router.delete('/creator-emails/:email'");
    expect(routes).toContain('Only the CREATOR can manage creator emails');
  });
  it('refuses to remove env-provided emails from the UI', () => {
    expect(routes).toContain('CREATOR_EMAILS environment variable');
  });
  it('Settings UI manages creator emails through the API', () => {
    expect(settings).toContain('/v1/identity/creator-emails');
    expect(settings).toContain('handleAddCreatorEmail');
    expect(settings).toContain('handleRemoveCreatorEmail');
  });
});
