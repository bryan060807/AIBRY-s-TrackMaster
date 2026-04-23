# TrackMaster UI

UI-owned code lives here as the split is introduced. The current Vite entrypoint
still uses the root `src/` tree during this scaffold pass, while API/session
client ownership has moved into `trackmaster-ui/src/lib`.

This tree is required source, not a duplicate or generated artifact. The root
UI currently depends on it through `src/lib/api.ts`, which re-exports the
shared API/session client from `trackmaster-ui/src/lib`.

Future passes can move the remaining React components and Vite config here after
the API package boundary is stable.
