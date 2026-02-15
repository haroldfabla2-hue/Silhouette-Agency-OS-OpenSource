// Mock for systeminformation in browser environment
export const cpu = async () => ({
    manufacturer: 'Silicon',
    brand: 'Neural Engine',
    speed: 3.5,
    cores: 16,
    physicalCores: 8,
    processors: 1
});

export const currentLoad = async () => ({
    currentLoad: 15 + Math.random() * 10,
    currentLoadUser: 10,
    currentLoadSystem: 5,
    cpus: []
});

export const mem = async () => ({
    total: 16 * 1024 * 1024 * 1024,
    free: 8 * 1024 * 1024 * 1024,
    used: 8 * 1024 * 1024 * 1024,
    active: 6 * 1024 * 1024 * 1024,
    available: 10 * 1024 * 1024 * 1024
});
