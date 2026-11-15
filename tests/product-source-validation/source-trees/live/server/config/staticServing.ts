/**
 * Decides whether the built React app (dist/) is served by the API server.
 *
 * [ROOT FIX] Serving used to be gated on NODE_ENV === 'production' only.
 * The deployed server runs NODE_ENV=development (deploy default), so the UI
 * silently 404'd in the real deployment even though dist/ was built and
 * shipped. Now the build being present is enough; SERVE_UI=true/false
 * overrides everything explicitly.
 */
export const shouldServeUi = (env: NodeJS.ProcessEnv, distIndexExists: boolean): boolean => {
    if (env.SERVE_UI !== undefined && env.SERVE_UI !== '') return env.SERVE_UI === 'true';
    return env.NODE_ENV === 'production' || distIndexExists;
};
