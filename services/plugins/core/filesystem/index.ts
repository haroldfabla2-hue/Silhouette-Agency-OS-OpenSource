import { IPlugin } from '../../../pluginInterface';
import * as tools from './tools';

export const CoreFilesystemPlugin: IPlugin = {
    id: 'core-filesystem',
    name: 'Core Filesystem',
    version: '1.0.0',
    description: 'Provides essential file system operations (Read, Write, List).',
    author: 'Silhouette System',

    tools: [
        {
            name: 'read_file',
            description: 'Read the contents of a file from the filesystem.',
            category: 'DEV', // Use literal string to avoid import cycle with ToolRegistry enum if possible, or cast
            parameters: {
                type: 'OBJECT',
                properties: {
                    path: { type: 'STRING', description: 'Absolute or relative path to the file to read.' }
                },
                required: ['path']
            },
            handler: tools.handleReadFile
        },
        {
            name: 'write_file',
            description: 'Write content to a file. Creates the file if it does not exist.',
            category: 'DEV',
            parameters: {
                type: 'OBJECT',
                properties: {
                    path: { type: 'STRING', description: 'Absolute or relative path to the file to write.' },
                    content: { type: 'STRING', description: 'The content to write to the file.' },
                    create_dirs: { type: 'BOOLEAN', description: 'Create parent directories if they do not exist. Default: true.' }
                },
                required: ['path', 'content']
            },
            handler: tools.handleWriteFile
        },
        {
            name: 'list_files',
            description: 'List files and directories in a given path.',
            category: 'DEV',
            parameters: {
                type: 'OBJECT',
                properties: {
                    directory: { type: 'STRING', description: 'Path to the directory to list.' },
                    pattern: { type: 'STRING', description: 'Optional glob pattern to filter files.' },
                    recursive: { type: 'BOOLEAN', description: 'List files recursively. Default: false.' }
                },
                required: ['directory']
            },
            handler: tools.handleListFiles
        }
    ]
};
