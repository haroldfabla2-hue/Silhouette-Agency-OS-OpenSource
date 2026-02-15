
import React from 'react';
import { Check, ExternalLink } from 'lucide-react';

interface Asset {
    id: string;
    url: string;
    thumb: string;
    description: string;
    photographer: string;
}

interface AssetGridProps {
    assets: Asset[];
    onSelect: (asset: Asset) => void;
    selectedId?: string;
}

export const AssetGrid: React.FC<AssetGridProps> = ({ assets, onSelect, selectedId }) => {
    return (
        <div className="grid grid-cols-2 gap-2 mt-2 w-full max-w-md">
            {assets.map(asset => (
                <div
                    key={asset.id}
                    onClick={() => onSelect(asset)}
                    className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${selectedId === asset.id ? 'border-cyan-500 scale-95' : 'border-transparent hover:border-slate-600'
                        }`}
                >
                    <img
                        src={asset.thumb}
                        alt={asset.description}
                        className="w-full h-24 object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                        <p className="text-[10px] text-white truncate">by {asset.photographer}</p>
                    </div>
                    {selectedId === asset.id && (
                        <div className="absolute top-1 right-1 bg-cyan-500 rounded-full p-0.5">
                            <Check size={12} className="text-white" />
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};
