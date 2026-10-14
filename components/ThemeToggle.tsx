import React, { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

/**
 * Brand theme toggle (dark default / light). The whole palette lives in CSS
 * variables (see index.css); this button only flips the class on <html> and
 * persists the choice. Zero component changes required elsewhere.
 */
const STORAGE_KEY = 'silhouette-theme';

const ThemeToggle: React.FC = () => {
    const [theme, setTheme] = useState<'dark' | 'light'>(() => {
        try { return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
    });

    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle('light', theme === 'light');
        root.classList.toggle('dark', theme === 'dark');
        try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage unavailable */ }
    }, [theme]);

    return (
        <button
            onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
            className="glass-button p-2 rounded-full text-cyan-400"
            title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
        >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
    );
};

export default ThemeToggle;
