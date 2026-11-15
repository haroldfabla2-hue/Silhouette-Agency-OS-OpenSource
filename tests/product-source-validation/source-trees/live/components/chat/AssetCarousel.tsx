/**
 * AssetCarousel - Smooth Multi-Asset Carousel
 * 
 * Features:
 * - Smooth scroll with snap
 * - Dots indicator
 * - Arrow navigation
 * - Touch/swipe support
 * - Minimal, elegant design
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ImageCard } from './ImageCard';
import { ParsedAsset } from './AssetRenderer';

interface AssetCarouselProps {
    assets: ParsedAsset[];
    onAssetClick?: (asset: ParsedAsset) => void;
    onAction?: (action: string, asset: ParsedAsset) => void;
}

export const AssetCarousel: React.FC<AssetCarouselProps> = ({
    assets,
    onAssetClick,
    onAction
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isHovered, setIsHovered] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(true);

    const updateScrollButtons = useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;

        setCanScrollLeft(container.scrollLeft > 10);
        setCanScrollRight(
            container.scrollLeft < container.scrollWidth - container.clientWidth - 10
        );
    }, []);

    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        container.addEventListener('scroll', updateScrollButtons);
        updateScrollButtons();

        return () => container.removeEventListener('scroll', updateScrollButtons);
    }, [updateScrollButtons]);

    const scrollTo = (direction: 'left' | 'right') => {
        const container = scrollRef.current;
        if (!container) return;

        const cardWidth = container.querySelector('[data-carousel-item]')?.clientWidth || 300;
        const scrollAmount = direction === 'left' ? -cardWidth : cardWidth;

        container.scrollBy({
            left: scrollAmount,
            behavior: 'smooth'
        });
    };

    const scrollToIndex = (index: number) => {
        const container = scrollRef.current;
        if (!container) return;

        const items = container.querySelectorAll('[data-carousel-item]');
        if (items[index]) {
            items[index].scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'center'
            });
            setCurrentIndex(index);
        }
    };

    // Update current index based on scroll position
    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        const handleScroll = () => {
            const items = container.querySelectorAll('[data-carousel-item]');
            const containerRect = container.getBoundingClientRect();
            const containerCenter = containerRect.left + containerRect.width / 2;

            let closestIndex = 0;
            let closestDistance = Infinity;

            items.forEach((item, index) => {
                const rect = item.getBoundingClientRect();
                const itemCenter = rect.left + rect.width / 2;
                const distance = Math.abs(itemCenter - containerCenter);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestIndex = index;
                }
            });

            setCurrentIndex(closestIndex);
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <div
            className="relative group"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Carousel Container */}
            <div
                ref={scrollRef}
                className="flex gap-3 overflow-x-auto scrollbar-none scroll-smooth snap-x snap-mandatory pb-2"
                style={{
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    WebkitOverflowScrolling: 'touch'
                }}
            >
                {assets.map((asset, index) => (
                    <div
                        key={asset.id}
                        data-carousel-item
                        className="flex-shrink-0 w-[280px] sm:w-[320px] snap-center"
                    >
                        <ImageCard
                            asset={asset}
                            onClick={() => onAssetClick?.(asset)}
                            onAction={(action) => onAction?.(action, asset)}
                            compact
                        />
                    </div>
                ))}
            </div>

            {/* Left Arrow */}
            <button
                onClick={() => scrollTo('left')}
                className={`
                    absolute left-2 top-1/2 -translate-y-1/2 z-10
                    w-10 h-10 flex items-center justify-center
                    rounded-full bg-black/60 backdrop-blur-sm
                    border border-white/10
                    transition-all duration-300
                    ${canScrollLeft && isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'}
                    hover:bg-black/80 hover:border-cyan-500/50
                `}
                disabled={!canScrollLeft}
            >
                <ChevronLeft className="w-5 h-5 text-white" />
            </button>

            {/* Right Arrow */}
            <button
                onClick={() => scrollTo('right')}
                className={`
                    absolute right-2 top-1/2 -translate-y-1/2 z-10
                    w-10 h-10 flex items-center justify-center
                    rounded-full bg-black/60 backdrop-blur-sm
                    border border-white/10
                    transition-all duration-300
                    ${canScrollRight && isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'}
                    hover:bg-black/80 hover:border-cyan-500/50
                `}
                disabled={!canScrollRight}
            >
                <ChevronRight className="w-5 h-5 text-white" />
            </button>

            {/* Dots Indicator */}
            {assets.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 mt-3">
                    {assets.map((_, index) => (
                        <button
                            key={index}
                            onClick={() => scrollToIndex(index)}
                            className={`
                                transition-all duration-300
                                ${currentIndex === index
                                    ? 'w-6 h-1.5 bg-cyan-500 rounded-full'
                                    : 'w-1.5 h-1.5 bg-slate-600 hover:bg-slate-500 rounded-full'
                                }
                            `}
                        />
                    ))}
                </div>
            )}

            {/* Asset Counter */}
            <div className="absolute top-3 right-3 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-md text-xs text-white font-medium z-10">
                {currentIndex + 1} / {assets.length}
            </div>
        </div>
    );
};

export default AssetCarousel;
