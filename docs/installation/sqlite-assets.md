# SQLite migration assets and persistent stores

Native startup uses `db/migrations/sqlite` relative to the working directory.
If the launcher uses another directory, set `SILHOUETTE_MIGRATIONS_DIR` to the
absolute path of the shipped migration directory. Keep the owning eight SQL
files unchanged, including line endings. Missing, extra, changed or symlinked
assets stop startup before SQLite opens. A new migration must update the
asset manifest and Docker allowlist together. This check validates shipped
assets, not every historical database schema, and is not filesystem isolation.

The image uses `/app` as its working directory. SQL is copied to
`/app/migrations/sqlite`, outside writable `/app/db`. The standard Compose
installation uses image-built code, not a source checkout bind. Rebuild the
image to change its code. Development source overlays need a separate setup;
a bind over `/app` hides the image's compiled server and dependencies.

## Existing installations: inspect before changing mounts

Do not apply the new working directory or production `./db:/app/db` mount
blindly. First identify the running process's actual SQLite and LanceDB paths,
including environment overrides and any old `/usr/src/app/db` data. Stop all
writers and create a verified, consistent backup of every store. A new empty
bind can hide existing container data without deleting it. Config and data
mount types, contents, ownership and permissions must also match the existing
installation. No automatic relocation or deletion is performed by this patch.

The Docker build runs the frontend build and the existing server Vite config;
the runtime still needs all production dependencies and a supported native
SQLite binary. A successful bundle is not an image startup or health check.
This patch does not enable Docker socket or whole-host filesystem access.

## Desktop resource scope

Electron packages ship the eight owning SQL files in
`resources/migrations/sqlite`, outside `app.asar`. The packaged server launch
sets the asset directory to that resource path rather than the caller's cwd.
This does not move user stores or change development launches.

Resource inclusion does not prove desktop startup: the current desktop launcher
still calls an external `node` executable with its inherited working directory.
Node availability/version, native module ABI compatibility, reading the server
entry from `app.asar`, and a writable persistent working directory still need
installed-app validation. Do not treat a successful installer build as that test.
