// =============================================================================
// Nexus Canvas - Font Selector Component
// Premium font picker with preview and categories
// =============================================================================

import React, { useState, useMemo } from 'react';
import { ChevronDown, Search, Type, Star, Clock } from 'lucide-react';

// Google Fonts categories with popular fonts
const FONT_CATEGORIES = {
    'Sans Serif': [
        'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins',
        'Nunito', 'Outfit', 'Work Sans', 'DM Sans', 'Source Sans 3'
    ],
    'Serif': [
        'Playfair Display', 'Merriweather', 'Lora', 'PT Serif', 'Crimson Text',
        'Libre Baskerville', 'Source Serif 4', 'EB Garamond', 'Noto Serif'
    ],
    'Display': [
        'Bebas Neue', 'Oswald', 'Archivo Black', 'Anton', 'Staatliches',
        'Righteous', 'Pacifico', 'Lobster', 'Permanent Marker'
    ],
    'Monospace': [
        'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Roboto Mono',
        'IBM Plex Mono', 'Space Mono', 'Inconsolata'
    ],
    'Handwriting': [
        'Dancing Script', 'Caveat', 'Satisfy', 'Great Vibes', 'Pacifico',
        'Sacramento', 'Shadows Into Light'
    ]
};

// All fonts flattened for search
const ALL_FONTS = Object.values(FONT_CATEGORIES).flat();

interface FontSelectorProps {
    value: string;
    onChange: (font: string) => void;
    className?: string;
}

export const FontSelector: React.FC<FontSelectorProps> = ({ value, onChange, className = '' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [recentFonts, setRecentFonts] = useState<string[]>(() => {
        try {
            return JSON.parse(localStorage.getItem('canvas_recent_fonts') || '[]');
        } catch {
            return [];
        }
    });

    // Filter fonts by search query
    const filteredFonts = useMemo(() => {
        if (!searchQuery) return null;
        const query = searchQuery.toLowerCase();
        return ALL_FONTS.filter(font => font.toLowerCase().includes(query));
    }, [searchQuery]);

    // Load Google Font dynamically
    const loadFont = (fontName: string) => {
        const link = document.createElement('link');
        link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}&display=swap`;
        link.rel = 'stylesheet';
        if (!document.querySelector(`link[href="${link.href}"]`)) {
            document.head.appendChild(link);
        }
    };

    // Select a font
    const handleSelect = (font: string) => {
        loadFont(font);
        onChange(font);
        setIsOpen(false);
        setSearchQuery('');

        // Update recent fonts
        const newRecent = [font, ...recentFonts.filter(f => f !== font)].slice(0, 5);
        setRecentFonts(newRecent);
        localStorage.setItem('canvas_recent_fonts', JSON.stringify(newRecent));
    };

    // Load current font on mount
    React.useEffect(() => {
        if (value) loadFont(value);
    }, [value]);

    return (
        <div className={`relative ${className}`}>
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg hover:border-cyan-500 transition-all min-w-[180px]"
            >
                <Type size={14} className="text-slate-400" />
                <span
                    className="flex-1 text-left text-sm text-white truncate"
                    style={{ fontFamily: value || 'inherit' }}
                >
                    {value || 'Select Font'}
                </span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute top-full left-0 mt-1 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    {/* Search */}
                    <div className="p-2 border-b border-slate-800">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
                            <input
                                type="text"
                                placeholder="Search fonts..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 outline-none"
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* Font List */}
                    <div className="max-h-80 overflow-y-auto custom-scrollbar">
                        {/* Search Results */}
                        {filteredFonts && (
                            <div className="p-2">
                                {filteredFonts.length === 0 ? (
                                    <p className="text-slate-500 text-xs text-center py-4">No fonts found</p>
                                ) : (
                                    filteredFonts.map(font => (
                                        <FontOption
                                            key={font}
                                            font={font}
                                            isSelected={value === font}
                                            onSelect={handleSelect}
                                        />
                                    ))
                                )}
                            </div>
                        )}

                        {/* Categories (when not searching) */}
                        {!filteredFonts && (
                            <>
                                {/* Recent Fonts */}
                                {recentFonts.length > 0 && (
                                    <div className="p-2 border-b border-slate-800">
                                        <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-slate-500 uppercase font-bold">
                                            <Clock size={10} />
                                            Recent
                                        </div>
                                        {recentFonts.map(font => (
                                            <FontOption
                                                key={font}
                                                font={font}
                                                isSelected={value === font}
                                                onSelect={handleSelect}
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* Categories */}
                                {Object.entries(FONT_CATEGORIES).map(([category, fonts]) => (
                                    <div key={category} className="p-2 border-b border-slate-800 last:border-b-0">
                                        <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-slate-500 uppercase font-bold">
                                            <Star size={10} />
                                            {category}
                                        </div>
                                        {fonts.slice(0, 5).map(font => (
                                            <FontOption
                                                key={font}
                                                font={font}
                                                isSelected={value === font}
                                                onSelect={handleSelect}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Click outside to close */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsOpen(false)}
                />
            )}
        </div>
    );
};

// Individual font option
const FontOption: React.FC<{ font: string; isSelected: boolean; onSelect: (font: string) => void }> = ({
    font,
    isSelected,
    onSelect
}) => {
    // Load font on hover for preview
    const handleMouseEnter = () => {
        const link = document.createElement('link');
        link.href = `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}&display=swap`;
        link.rel = 'stylesheet';
        if (!document.querySelector(`link[href="${link.href}"]`)) {
            document.head.appendChild(link);
        }
    };

    return (
        <button
            onMouseEnter={handleMouseEnter}
            onClick={() => onSelect(font)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${isSelected
                    ? 'bg-cyan-600/20 text-cyan-400'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
            style={{ fontFamily: font }}
        >
            {font}
        </button>
    );
};

export default FontSelector;
