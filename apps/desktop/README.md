# Skitza desktop shell

Tauri 2.x native shell that wraps the Skitza web app in a macOS window.

## Scripts

Run from the repo root (these go through the workspace `tauri:dev` / `tauri:build` scripts):

```sh
corepack pnpm tauri:dev    # boots Next.js dev server + opens the native window
corepack pnpm tauri:build  # production bundle (see TODO below)
```

Direct invocation also works:

```sh
corepack pnpm --filter desktop tauri dev
```

## Notes

- `beforeDevCommand` uses `corepack pnpm --filter web dev` (not bare `pnpm`)
  because this machine has no global `pnpm` shim — only corepack-managed pnpm.
- `frontendDist` is set to `../web/.next` per the Phase 1 spec, but `.next/`
  is Next's build cache, not a static export. **Production `tauri build` will
  not produce a working bundle until Task 12 wires up a proper static export
  (e.g. `next build && next export` to `apps/web/out`, then point
  `frontendDist` there).** Dev (`tauri dev`) is unaffected — it uses `devUrl`.
