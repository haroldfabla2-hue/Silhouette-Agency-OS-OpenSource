/**
 * PRESENTATION VIEWER - Premium Slideshow Component
 * 
 * Reveal.js-inspired presentation viewer with:
 * - Smooth slide transitions (fade, slide, zoom)
 * - Keyboard navigation (←→, Space, Escape, Home/End)
 * - Touch/swipe support for mobile
 * - Progress bar and slide counter
 * - Presenter notes panel (toggle with N key)
 * - Thumbnail overview (toggle with O key)
 * - Fullscreen support
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    ChevronLeft, ChevronRight, X, Maximize2, Minimize2,
    Clock, MessageSquare, Grid3x3, Play, Pause
} from 'lucide-react';
import type { Presentation, Slide, PresentationTheme } from '../types/presentation';

interface PresentationViewerProps {
    presentation: Presentation;
    onClose: () => void;
    startSlide?: number;
}

// Theme colors mapping
const THEME_STYLES: Record<PresentationTheme, {
    bg: string;
    text: string;
    accent: string;
    overlay: string;
}> = {
    'modern-dark': {
        bg: 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900',
        text: 'text-white',
        accent: 'text-cyan-400',
        overlay: 'bg-black/80'
    },
    'corporate': {
        bg: 'bg-gradient-to-br from-blue-50 via-white to-blue-100',
        text: 'text-slate-900',
        accent: 'text-blue-600',
        overlay: 'bg-white/90'
    },
    'pitch-deck': {
        bg: 'bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900',
        text: 'text-white',
        accent: 'text-purple-300',
        overlay: 'bg-purple-950/90'
    },
    'academic': {
        bg: 'bg-gradient-to-br from-amber-50 via-stone-50 to-amber-100',
        text: 'text-stone-800',
        accent: 'text-amber-700',
        overlay: 'bg-stone-100/95'
    },
    'minimal': {
        bg: 'bg-white',
        text: 'text-gray-900',
        accent: 'text-gray-600',
        overlay: 'bg-gray-100/95'
    },
    'creative': {
        bg: 'bg-gradient-to-br from-pink-500 via-red-500 to-yellow-500',
        text: 'text-white',
        accent: 'text-yellow-200',
        overlay: 'bg-black/80'
    }
};

// Transition types
type TransitionType = 'fade' | 'slide' | 'zoom';

const PresentationViewer: React.FC<PresentationViewerProps> = ({
    presentation,
    onClose,
    startSlide = 0
}) => {
    // State
    const [currentSlide, setCurrentSlide] = useState(startSlide);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    const [showOverview, setShowOverview] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [transition, setTransition] = useState<TransitionType>('fade');
    const [isTransitioning, setIsTransitioning] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const autoplayRef = useRef<NodeJS.Timeout | null>(null);

    const slides = presentation.slides;
    const totalSlides = slides.length;
    const currentSlideData = slides[currentSlide];
    const theme = THEME_STYLES[presentation.theme] || THEME_STYLES['modern-dark'];

    // Navigation functions
    const goToSlide = useCallback((index: number, withTransition = true) => {
        if (index < 0 || index >= totalSlides || isTransitioning) return;

        if (withTransition) {
            setIsTransitioning(true);
            setTimeout(() => {
                setCurrentSlide(index);
                setTimeout(() => setIsTransitioning(false), 300);
            }, 150);
        } else {
            setCurrentSlide(index);
        }
    }, [totalSlides, isTransitioning]);

    const nextSlide = useCallback(() => {
        goToSlide(currentSlide + 1);
    }, [currentSlide, goToSlide]);

    const prevSlide = useCallback(() => {
        goToSlide(currentSlide - 1);
    }, [currentSlide, goToSlide]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowRight':
                case 'Space':
                case 'Enter':
                    e.preventDefault();
                    nextSlide();
                    break;
                case 'ArrowLeft':
                case 'Backspace':
                    e.preventDefault();
                    prevSlide();
                    break;
                case 'Home':
                    e.preventDefault();
                    goToSlide(0);
                    break;
                case 'End':
                    e.preventDefault();
                    goToSlide(totalSlides - 1);
                    break;
                case 'Escape':
                    if (showOverview) setShowOverview(false);
                    else if (showNotes) setShowNotes(false);
                    else if (isFullscreen) toggleFullscreen();
                    else onClose();
                    break;
                case 'n':
                case 'N':
                    setShowNotes(prev => !prev);
                    break;
                case 'o':
                case 'O':
                    setShowOverview(prev => !prev);
                    break;
                case 'f':
                case 'F':
                    toggleFullscreen();
                    break;
                case 'p':
                case 'P':
                    setIsPlaying(prev => !prev);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [nextSlide, prevSlide, goToSlide, totalSlides, showOverview, showNotes, isFullscreen, onClose]);

    // Touch/swipe support
    useEffect(() => {
        let touchStartX = 0;
        let touchEndX = 0;

        const handleTouchStart = (e: TouchEvent) => {
            touchStartX = e.changedTouches[0].screenX;
        };

        const handleTouchEnd = (e: TouchEvent) => {
            touchEndX = e.changedTouches[0].screenX;
            const diff = touchStartX - touchEndX;

            if (Math.abs(diff) > 50) {
                if (diff > 0) nextSlide();
                else prevSlide();
            }
        };

        const container = containerRef.current;
        if (container) {
            container.addEventListener('touchstart', handleTouchStart);
            container.addEventListener('touchend', handleTouchEnd);
            return () => {
                container.removeEventListener('touchstart', handleTouchStart);
                container.removeEventListener('touchend', handleTouchEnd);
            };
        }
    }, [nextSlide, prevSlide]);

    // Fullscreen toggle
    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    }, []);

    // Listen for fullscreen changes
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    // Timer
    useEffect(() => {
        timerRef.current = setInterval(() => {
            setElapsedTime(prev => prev + 1);
        }, 1000);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    // Autoplay
    useEffect(() => {
        if (isPlaying) {
            autoplayRef.current = setInterval(() => {
                if (currentSlide < totalSlides - 1) {
                    nextSlide();
                } else {
                    setIsPlaying(false);
                }
            }, 5000);
        } else {
            if (autoplayRef.current) clearInterval(autoplayRef.current);
        }
        return () => {
            if (autoplayRef.current) clearInterval(autoplayRef.current);
        };
    }, [isPlaying, currentSlide, totalSlides, nextSlide]);

    // Format time
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Get transition classes
    const getTransitionClass = () => {
        if (!isTransitioning) return 'opacity-100 translate-x-0 scale-100';
        switch (transition) {
            case 'slide':
                return 'opacity-0 translate-x-8';
            case 'zoom':
                return 'opacity-0 scale-95';
            default:
                return 'opacity-0';
        }
    };

    // Render slide content
    const renderSlideContent = (slide: Slide) => {
        const layoutClass = slide.layout === 'title'
            ? 'items-center justify-center text-center'
            : slide.layout === 'two-column'
                ? 'grid grid-cols-2 gap-8 items-center'
                : 'items-start justify-start';

        return (
            <div className={`w-full h-full flex flex-col ${layoutClass} p-12 lg:p-16`}>
                {/* Title */}
                <h2 className={`text-3xl lg:text-5xl font-bold mb-6 ${theme.text}`}>
                    {slide.title}
                </h2>

                {/* Content */}
                {slide.content && (
                    <div className={`text-lg lg:text-xl ${theme.text} opacity-90 max-w-4xl`}>
                        {slide.content.split('\n').map((line, i) => (
                            line.startsWith('- ') ? (
                                <div key={i} className="flex items-start gap-3 mb-3">
                                    <span className={`${theme.accent} mt-1.5`}>•</span>
                                    <span>{line.substring(2)}</span>
                                </div>
                            ) : (
                                <p key={i} className="mb-4">{line}</p>
                            )
                        ))}
                    </div>
                )}

                {/* Image asset if present */}
                {slide.assets?.filter(a => a.type === 'image').map(asset => (
                    <img
                        key={asset.id}
                        src={asset.src}
                        alt={asset.alt || slide.title}
                        className="max-h-[50vh] object-contain rounded-lg shadow-2xl mt-6"
                    />
                ))}
            </div>
        );
    };

    return (
        <div
            ref={containerRef}
            className={`fixed inset-0 z-50 ${theme.bg} ${theme.text} flex flex-col`}
        >
            {/* Main slide area */}
            <div
                className="flex-1 relative overflow-hidden cursor-pointer"
                onClick={(e) => {
                    // Click on left third = prev, right two-thirds = next
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    if (clickX < rect.width / 3) prevSlide();
                    else nextSlide();
                }}
            >
                {/* Slide content with transition */}
                <div className={`absolute inset-0 transition-all duration-300 ease-out ${getTransitionClass()}`}>
                    {currentSlideData && renderSlideContent(currentSlideData)}
                </div>

                {/* Navigation arrows */}
                <button
                    onClick={(e) => { e.stopPropagation(); prevSlide(); }}
                    disabled={currentSlide === 0}
                    className={`absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full ${theme.overlay} backdrop-blur-sm opacity-0 hover:opacity-100 transition-opacity disabled:opacity-0`}
                >
                    <ChevronLeft size={32} />
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); nextSlide(); }}
                    disabled={currentSlide === totalSlides - 1}
                    className={`absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full ${theme.overlay} backdrop-blur-sm opacity-0 hover:opacity-100 transition-opacity disabled:opacity-0`}
                >
                    <ChevronRight size={32} />
                </button>
            </div>

            {/* Bottom bar */}
            <div className={`h-14 ${theme.overlay} backdrop-blur-md flex items-center justify-between px-6 border-t border-white/10`}>
                {/* Left: Close & controls */}
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                        <X size={20} />
                    </button>
                    <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className={`p-2 hover:bg-white/10 rounded-lg transition-colors ${isPlaying ? theme.accent : ''}`}
                    >
                        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                    </button>
                    <div className="flex items-center gap-2 text-sm opacity-70">
                        <Clock size={16} />
                        {formatTime(elapsedTime)}
                    </div>
                </div>

                {/* Center: Progress */}
                <div className="flex-1 max-w-xl mx-8">
                    <div className="flex items-center gap-4">
                        <span className="text-sm font-mono">{currentSlide + 1} / {totalSlides}</span>
                        <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                            <div
                                className={`h-full ${theme.accent.replace('text-', 'bg-')} transition-all duration-300`}
                                style={{ width: `${((currentSlide + 1) / totalSlides) * 100}%` }}
                            />
                        </div>
                    </div>
                </div>

                {/* Right: View controls */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowNotes(!showNotes)}
                        className={`p-2 hover:bg-white/10 rounded-lg transition-colors ${showNotes ? theme.accent : ''}`}
                        title="Notes (N)"
                    >
                        <MessageSquare size={20} />
                    </button>
                    <button
                        onClick={() => setShowOverview(!showOverview)}
                        className={`p-2 hover:bg-white/10 rounded-lg transition-colors ${showOverview ? theme.accent : ''}`}
                        title="Overview (O)"
                    >
                        <Grid3x3 size={20} />
                    </button>
                    <button
                        onClick={toggleFullscreen}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        title="Fullscreen (F)"
                    >
                        {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                    </button>
                </div>
            </div>

            {/* Presenter notes panel */}
            {showNotes && (
                <div className={`absolute bottom-14 left-0 right-0 h-48 ${theme.overlay} backdrop-blur-md border-t border-white/10 p-6 overflow-auto`}>
                    <h4 className="text-sm font-bold uppercase opacity-50 mb-2">Presenter Notes</h4>
                    <p className="text-sm opacity-80">
                        {currentSlideData?.notes || 'No notes for this slide.'}
                    </p>
                </div>
            )}

            {/* Thumbnail overview */}
            {showOverview && (
                <div className={`absolute inset-0 ${theme.overlay} backdrop-blur-md z-10 p-8 overflow-auto`}>
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold">Slide Overview</h3>
                        <button onClick={() => setShowOverview(false)} className="p-2 hover:bg-white/10 rounded-lg">
                            <X size={24} />
                        </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {slides.map((slide, idx) => (
                            <button
                                key={slide.id}
                                onClick={() => { goToSlide(idx, false); setShowOverview(false); }}
                                className={`aspect-video rounded-lg overflow-hidden border-2 transition-all ${idx === currentSlide
                                    ? 'border-cyan-400 ring-2 ring-cyan-400/50'
                                    : 'border-white/20 hover:border-white/40'
                                    }`}
                            >
                                <div className={`w-full h-full ${theme.bg} p-4 flex flex-col justify-center text-left`}>
                                    <span className="text-xs opacity-50 mb-1">{idx + 1}</span>
                                    <span className="text-sm font-bold truncate">{slide.title}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Keyboard hints (shown briefly on mount) */}
            <div className="absolute top-4 right-4 text-xs opacity-50 hidden lg:block">
                ← → Navigate • Space Next • N Notes • O Overview • F Fullscreen • Esc Close
            </div>
        </div>
    );
};

export default PresentationViewer;
