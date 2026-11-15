
import React from 'react';
import { Play, Download, Wand2 } from 'lucide-react';

interface Concept {
    id: string;
    url: string;
    title: string;
    description: string;
}

interface ConceptCarouselProps {
    concepts: Concept[];
    onIterate: (concept: Concept) => void;
    onAnimate: (concept: Concept) => void;
}

export const ConceptCarousel: React.FC<ConceptCarouselProps> = ({ concepts, onIterate, onAnimate }) => {
    return (
        <div className="flex gap-4 overflow-x-auto p-2 w-full max-w-md custom-scrollbar snap-x">
            {concepts.map(concept => (
                <div key={concept.id} className="min-w-[200px] bg-slate-900 rounded-xl overflow-hidden border border-slate-800 snap-center">
                    <div className="relative aspect-[9/16]">
                        <img src={concept.url} alt={concept.title} className="w-full h-full object-cover" />
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent p-3">
                            <h4 className="text-xs font-bold text-white">{concept.title}</h4>
                            <p className="text-[10px] text-slate-300 line-clamp-2">{concept.description}</p>
                        </div>
                    </div>
                    <div className="flex border-t border-slate-800">
                        <button
                            onClick={() => onIterate(concept)}
                            className="flex-1 p-2 text-[10px] text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center gap-1"
                        >
                            <Wand2 size={10} /> Iterate
                        </button>
                        <div className="w-px bg-slate-800"></div>
                        <button
                            onClick={() => onAnimate(concept)}
                            className="flex-1 p-2 text-[10px] text-cyan-400 hover:text-cyan-300 hover:bg-slate-800 flex items-center justify-center gap-1 font-bold"
                        >
                            <Play size={10} /> Animate
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};
