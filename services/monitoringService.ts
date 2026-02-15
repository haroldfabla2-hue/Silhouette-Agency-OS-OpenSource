import { ServiceStatus } from '../types';

interface ServiceConfig {
    id: string;
    name: string;
    port?: number;
    url?: string;
}

class MonitoringService {

    async checkServiceHealth(service: ServiceConfig): Promise<ServiceStatus> {
        const startTime = Date.now();
        try {
            let isOnline = false;

            if (service.url) {
                // Check URL (External or Internal)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);

                try {
                    const res = await fetch(service.url, { method: 'HEAD', signal: controller.signal });
                    isOnline = res.ok || res.status === 404; // 404 means server is up but route missing
                } catch (e) {
                    isOnline = false;
                } finally {
                    clearTimeout(timeoutId);
                }

            } else if (service.port) {
                // Check Local Port (via fetch to localhost)
                // Note: In browser environment, we can't ping arbitrary ports easily due to CORS/Security.
                // But since this runs in Node (Backend), we can use fetch to localhost.
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1000);

                try {
                    await fetch(`http://127.0.0.1:${service.port}`, { method: 'HEAD', signal: controller.signal });
                    isOnline = true;
                } catch (e: any) {
                    // Connection refused means offline. 
                    // However, some services might not respond to HEAD /
                    if (e.cause?.code === 'ECONNREFUSED') isOnline = false;
                    else isOnline = true; // Other errors might mean it's there but rejecting
                } finally {
                    clearTimeout(timeoutId);
                }
            }

            const latency = Date.now() - startTime;

            return {
                id: service.id,
                name: service.name,
                port: service.port || 0,
                status: isOnline ? 'ONLINE' : 'OFFLINE',
                latency: isOnline ? latency : 0,
                uptime: isOnline ? 99.9 : 0 // Simplified uptime
            };

        } catch (error) {
            return {
                id: service.id,
                name: service.name,
                port: service.port || 0,
                status: 'OFFLINE',
                latency: 0,
                uptime: 0
            };
        }
    }

    async checkAll(services: ServiceConfig[]): Promise<ServiceStatus[]> {
        return await Promise.all(services.map(s => this.checkServiceHealth(s)));
    }
}

export const monitoringService = new MonitoringService();
