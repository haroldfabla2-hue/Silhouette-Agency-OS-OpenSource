import { useState, useEffect } from 'react';

export const useHardwareSafety = () => {
    const [safetyScore, setSafetyScore] = useState(0);
    const [recommendedMode, setRecommendedMode] = useState('balanced');
    const [specs, setSpecs] = useState({ cores: 0, memory: 0 });

    useEffect(() => {
        // Real Browser Detection
        const cores = navigator.hardwareConcurrency || 4;
        // @ts-ignore - deviceMemory is standard in Chrome/Edge but not in TS types by default
        const memory = (navigator as any).deviceMemory || 8;

        setSpecs({ cores, memory });

        // Safety Algorithm
        let score = 0;
        if (cores >= 16) score += 50;
        else if (cores >= 8) score += 30;
        else score += 10;

        if (memory >= 32) score += 50;
        else if (memory >= 16) score += 30;
        else score += 10;

        setSafetyScore(score);

        if (score >= 80) setRecommendedMode('ultra');
        else if (score >= 50) setRecommendedMode('turbo');
        else setRecommendedMode('balanced');
    }, []);

    return { safetyScore, recommendedMode, specs };
};
