# Sansara pause checkpoint

Paused: 2026-07-31 22:28 CAT

## Completed in this pause

- Snowflow was cloned from `https://github.com/Noniv/snowflow_demo` into `experiments/dark-snow/`.
- The captured upstream source is commit `545039733b74eec742862f161990142c7ca7c7ec`.
- The upstream `LICENSE` is retained unchanged; the fork is MIT-licensed upstream code.
- The selector still uses the stable route key `dune2`, but presents it as **dark snow** with the Snowflow MIT credit.
- The old Dune 2 thumbnail was moved out of the project to `/tmp/dune2-legacy-thumbnail.jpg` so the selector no longer advertises the asset-heavy version.

## Exact next step

Replace the current `app/rooms/dune2.js` Three.js room handoff with the forked Babylon/WebGPU renderer in `experiments/dark-snow/`. Preserve the Snowflow sun/sky LUT, cascaded shadows, terrain material, and post chain first; only then adapt the snow surface toward sand.

## Deliberately not done

- No WebGPU renderer integration yet.
- No lighting retune yet; the current Three.js room is not the target look.
- No asset removal from the legacy `app/rooms/dune2.js` implementation yet; it is no longer the intended path and should be replaced rather than further tuned.
- No release commit or deployment from this checkpoint.

That pause was resumed on 2026-07-31. The fork is now wired through the selector and verified as a standalone WebGPU build; the remaining work is the sand adaptation and release polish.
