import log from 'electron-log';
import fs from 'fs';
import os from 'os';
import axios from 'axios';
import { app } from 'electron';

// Regular expressions for strict PII redaction (GDPR/Compliance)
const REDACTION_RULES = [
  { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]' },
  { regex: /(Bearer\s+|token=)[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/gi, replacement: '$1[JWT_REDACTED]' },
  { regex: /password(?:is|"|:\s*)=?\s*['"]?([^'"\s]+)['"]?/gi, replacement: 'password=[PASSWORD_REDACTED]' },
  { regex: /(sk-[a-zA-Z0-9]{40,})/g, replacement: '[API_KEY_REDACTED]' }
];

export class SupportAgent {
  private logPath: string;

  constructor() {
    // Get file path from electron-log
    this.logPath = log.transports.file.getFile().path;
  }

  private sanitizeLogs(rawText: string): string {
    let safeText = rawText;
    for (const rule of REDACTION_RULES) {
      safeText = safeText.replace(rule.regex, rule.replacement);
    }
    return safeText;
  }

  /**
   * Analyzes recent logs to identify local fixes before escalating to cloud support.
   */
  public async analyzeAndReport(userDescription: string): Promise<{ resolvedLocal: boolean; message: string }> {
    let tailLogs = '';
    try {
      if (fs.existsSync(this.logPath)) {
        const rawLogs = fs.readFileSync(this.logPath, 'utf8');
        tailLogs = rawLogs.slice(-10000); // Analyze the last 10KB of logs
      }
    } catch (e: any) {
      console.error('[SUPPORT_AGENT] Failed to read log file:', e.message);
    }

    // 1. Local Heuristic Analysis
    if (tailLogs.includes('CUDA out of memory') || tailLogs.includes('AllocateMemory failed')) {
      return {
        resolvedLocal: true,
        message: 'Su tarjeta gráfica se ha quedado sin memoria de video (VRAM). Intente reiniciar la aplicación, cerrar otras aplicaciones de diseño/juegos pesados, o seleccionar un modelo local más ligero (ej. Gemma 3B o Llama 8B Q4).'
      };
    }

    if (tailLogs.includes('EADDRINUSE') && (tailLogs.includes('3005') || tailLogs.includes('8000') || tailLogs.includes('9876'))) {
      return {
        resolvedLocal: true,
        message: 'Uno de los puertos del sistema (3005 o 9876) ya está ocupado por otra aplicación. Por favor, asegúrate de que no haya otra instancia de Silhouette o del motor Python ejecutándose en segundo plano.'
      };
    }

    // 2. Transmit to Proxy if unresolved
    const safeLogs = this.sanitizeLogs(tailLogs);
    const success = await this.transmitToProxy(userDescription, safeLogs);

    if (success) {
      return {
        resolvedLocal: false,
        message: 'Se ha enviado un reporte técnico sanitizado a nuestros ingenieros. Estaremos revisando tu incidencia a la brevedad.'
      };
    } else {
      throw new Error('Fallo al conectar con los servidores de soporte en la nube. Revisa tu conexión a internet.');
    }
  }

  private async transmitToProxy(issue: string, diagnosticLogs: string): Promise<boolean> {
    // Proxy Endpoint (prevents exposing corporate Discord/Slack webhooks in the compiled package)
    const PROXY_URL = process.env.TELEMETRY_PROXY_URL || 'https://api.silhouetteagency.com/v1/telemetry/tickets';

    const payload = {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      os_version: os.release(),
      memory_info: process.getSystemMemoryInfo(),
      description: issue,
      logs: diagnosticLogs
    };

    try {
      const response = await axios.post(PROXY_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-App-Version': app.isReady() ? app.getVersion() : '2.0.0-dev'
        },
        timeout: 5000 // 5 seconds timeout
      });
      return response.status === 200 || response.status === 201;
    } catch (error: any) {
      console.error('[SUPPORT_AGENT] Failed to transmit support ticket to proxy:', error.message);
      // Fallback: log to local error so developers can recover it manually
      log.error('Telemetry transmission failure payload:', JSON.stringify(payload));
      return false;
    }
  }
}

export const supportAgent = new SupportAgent();
