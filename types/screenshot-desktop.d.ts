declare module 'screenshot-desktop' {
    function screenshot(options?: { format?: string; screen?: string }): Promise<Buffer>;
    namespace screenshot {
        function listDisplays(): Promise<Array<{ id: string; name: string; top: number; left: number; width: number; height: number }>>;
        function all(): Promise<Buffer[]>;
    }
    export = screenshot;
}
