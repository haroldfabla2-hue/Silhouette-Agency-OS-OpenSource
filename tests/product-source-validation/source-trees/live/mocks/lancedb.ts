export const connect = async () => ({
    tableNames: async () => [],
    openTable: async () => ({
        search: () => ({ limit: () => ({ execute: async () => [] }) }),
        add: async () => { },
        query: () => ({ limit: () => ({ execute: async () => [] }) })
    }),
    createTable: async () => ({})
});
