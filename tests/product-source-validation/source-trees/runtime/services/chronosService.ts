
export interface TemporalContext {
    now: string;
    timestamp: number;
    timezone: string;
    dayOfWeek: string;
    dayOfYear: number;
    weekNumber: number;
    era: string; // e.g. "Anthropocene" (Flavor)
    relative: {
        yesterday: string;
        tomorrow: string;
        lastWeek: string;
        nextWeek: string;
        past20Years: string;
        future20Years: string;
    };
}

class ChronosService {

    public getContext(): TemporalContext {
        const now = new Date();

        // Native JS Date Math
        const oneDay = 24 * 60 * 60 * 1000;
        const yesterday = new Date(now.getTime() - oneDay);
        const tomorrow = new Date(now.getTime() + oneDay);
        const lastWeek = new Date(now.getTime() - (7 * oneDay));
        const nextWeek = new Date(now.getTime() + (7 * oneDay));
        const past20Years = new Date(now.getFullYear() - 20, now.getMonth(), now.getDate());
        const future20Years = new Date(now.getFullYear() + 20, now.getMonth(), now.getDate());

        // Day of Year Calculation
        const start = new Date(now.getFullYear(), 0, 0);
        const diff = now.getTime() - start.getTime();
        const dayOfYear = Math.floor(diff / oneDay);

        // Week Number Calculation (Local)
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dayNum = d.getDay() || 7;
        d.setDate(d.getDate() + 4 - dayNum);
        const yearStart = new Date(d.getFullYear(), 0, 1);
        const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

        const pad = (n: number) => n.toString().padStart(2, '0');
        const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const fmtFull = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        return {
            now: fmtFull(now),
            timestamp: now.getTime(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            dayOfWeek: days[now.getDay()],
            dayOfYear: dayOfYear,
            weekNumber: weekNo,
            era: "Digital Age",
            relative: {
                yesterday: fmt(yesterday),
                tomorrow: fmt(tomorrow),
                lastWeek: fmt(lastWeek),
                nextWeek: fmt(nextWeek),
                past20Years: fmt(past20Years),
                future20Years: fmt(future20Years)
            }
        };
    }

    public getTimeGrid(date: Date = new Date()) {
        return {
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate(),
            hour: date.getHours(),
            weekday: date.getDay()
        };
    }
}

export const chronos = new ChronosService();
