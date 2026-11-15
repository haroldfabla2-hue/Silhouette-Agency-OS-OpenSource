const v = (name) => `rgb(var(${name}) / <alpha-value>)`;
const dc = require('tailwindcss/colors');

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // BRAND RULE: extend the default palette, never replace it.
                // Only brand-owned hues are tokenized (CSS vars, themed);
                // every other shade falls back to the Tailwind default so
                // nothing in the app loses its color.
                white: v('--c-white'),
                black: v('--c-black'),
                slate: {
                    ...dc.slate,
                    50: v('--c-slate-50'), 100: v('--c-slate-100'), 200: v('--c-slate-200'),
                    300: v('--c-slate-300'), 400: v('--c-slate-400'), 500: v('--c-slate-500'),
                    600: v('--c-slate-600'), 700: v('--c-slate-700'), 800: v('--c-slate-800'),
                    850: v('--c-slate-850'), 900: v('--c-slate-900'), 950: v('--c-slate-950'),
                },
                // "cyan" is the legacy accent slot: full ramp carries the
                // copper brand accent, themed. Class names stay untouched.
                cyan: {
                    ...dc.cyan,
                    50: v('--c-accent-50'), 100: v('--c-accent-100'), 200: v('--c-accent-200'),
                    300: v('--c-accent-300'), 400: v('--c-accent-400'), 500: v('--c-accent-500'),
                    600: v('--c-accent-600'), 700: v('--c-accent-700'), 800: v('--c-accent-800'),
                    900: v('--c-accent-900'), 950: v('--c-accent-950'),
                },
                // "blue" is the secondary accent slot: same copper family,
                // so legacy from-cyan-600-to-blue-600 gradients stay in-brand.
                blue: {
                    ...dc.blue,
                    50: v('--c-accent-50'), 100: v('--c-accent-100'), 200: v('--c-accent-200'),
                    300: v('--c-accent-300'), 400: v('--c-accent-400'), 500: v('--c-accent-500'),
                    600: v('--c-accent-600'), 700: v('--c-accent-700'), 800: v('--c-accent-800'),
                    900: v('--c-accent-900'), 950: v('--c-accent-950'),
                },
                // Status hues keep their semantics; only the shades the app
                // actually themes are tokenized, the rest stay default.
                red: { ...dc.red, 300: v('--c-red-300'), 400: v('--c-red-400'), 500: v('--c-red-500') },
                green: { ...dc.green, 400: v('--c-green-400'), 500: v('--c-green-500') },
                yellow: { ...dc.yellow, 400: v('--c-yellow-400') },
                purple: { ...dc.purple, 300: v('--c-purple-300'), 400: v('--c-purple-400'), 500: v('--c-purple-500'), 900: v('--c-purple-900') },
                emerald: { ...dc.emerald, 400: v('--c-emerald-400') },
                orange: { ...dc.orange, 400: v('--c-orange-400') },
            },
            fontFamily: {
                mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
                sans: ['Jost', 'system-ui', 'sans-serif'],
                display: ['Cormorant Garamond', 'Georgia', 'serif'],
            },
            animation: {
                'pulse-fast': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'spin-slow': 'spin 3s linear infinite',
            }
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
}
