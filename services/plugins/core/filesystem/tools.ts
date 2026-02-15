import * as fs from 'fs/promises';
import * as pathModule from 'path';

export const handleReadFile = async (args: { path: string }) => {
    try {
        const content = await fs.readFile(args.path, 'utf-8');
        return { content, path: args.path };
    } catch (e: any) {
        throw new Error(`Failed to read file: ${e.message}`);
    }
};

export const handleWriteFile = async (args: { path: string; content: string; create_dirs?: boolean }) => {
    try {
        // Create parent dirs if needed
        if (args.create_dirs !== false) {
            const dir = pathModule.dirname(args.path);
            await fs.mkdir(dir, { recursive: true });
        }

        await fs.writeFile(args.path, args.content, 'utf-8');
        return { status: "success", path: args.path, message: "File written successfully" };
    } catch (e: any) {
        throw new Error(`Failed to write file: ${e.message}`);
    }
};

export const handleListFiles = async (args: { directory: string; pattern?: string; recursive?: boolean }) => {
    try {
        // Simple implementation for now, ignoring pattern/recursive for MVP migration
        const files = await fs.readdir(args.directory);
        return {
            files,
            count: files.length,
            directory: args.directory
        };
    } catch (e: any) {
        throw new Error(`Failed to list files: ${e.message}`);
    }
};
