import { SquadFactory, SquadRequest } from '../factory/squadFactory';
import { AgentTier } from '../../types';

export const defineLibrarianSquad = async () => {
    const request: SquadRequest = {
        goal: "Organize the Virtual File System and Tag all Assets",
        context: "The user has a chaotic VFS and many untagged assets. We need a team to create structure, folder hierarchies, and apply semantic tags to every image/video.",
        budget: 'ECO'
    };

    // This is just a helper to blueprint it, normally called by Orchestrator
    const squadFactory = new SquadFactory();

    // We can also check if we want to manually construct the blueprint here
    // but SquadFactory does it via LLM.

    // For V2: We define a "Preset" squad here for the UI to quick-launch
    return {
        id: 'SQ_LIBRARIAN_PRESET',
        name: 'The Librarians',
        description: 'Organizational squad dedicated to file structure and asset tagging.',
        strategy: 'Divide and conquer: One agent scans directory tree, one analyzes image content for tags, one moves files to folders.',
        members: [
            {
                roleName: 'Chief Archivist',
                category: 'DATA' as const,
                focus: 'File System Hierarchy & Taxonomy',
                tier: AgentTier.SPECIALIST
            },
            {
                roleName: 'Visual Tagger',
                category: 'MEDIA' as const,
                focus: 'Image Recognition & Metadata',
                tier: AgentTier.WORKER
            },
            {
                roleName: 'Clerk',
                category: 'OPS' as const,
                focus: 'Moving files and cleaning duplicates',
                tier: AgentTier.WORKER
            }
        ]
    };
};
