---
name: isometric-rpg-animation
description: Create, fix, validate and integrate natural 2D isometric character/monster animations (idle, walk, run, attack, hit, death, 4/8 directions) into a Phaser.js RPG, Dofus-style. Use when the user gives a reference image or existing spritesheets, or complains about foot sliding, jittery frames, wrong directions, bad depth sorting or broken click/keyboard movement. Not for 3D games, non-isometric platformers, or pure art generation with no game integration.
---

# Isometric RPG animation

Pipeline: reference/spritesheet → analysis → production path → frame cleanup → validation → atlas+manifest → Phaser integration → tests.
The repo you are in is both this skill and a library. Paths below are relative to the skill folder (`$SKILL`).

## Rules that must not be broken
- Never claim visual understanding you do not have. `scripts/isoanim.py analyze` is pixel statistics only (`semanticAnalysis: false`). If you have no vision model, ask the user only for the facts listed in `needsInput`.
- Diagnose before editing the game. Write the diagnosis + plan first, then change code incrementally. Keep the game's own pathfinding, collision and input; plug into them through adapters.
- Never delete old spritesheets. Never strip magenta (or any colour) automatically: `bg detect` first, then explicit `--color`.
- Passing validation ≠ natural motion. Report objective results and heuristic warnings separately, and tell the user what still needs their eyes (previews + demo).
- Do not invent test output. Run the commands and quote results; say what could not be run.

## Workflow
1. **Diagnose the project** (read-only): Phaser version, asset layout, spritesheet format, movement/animation code, collision, pathfinding, coordinate convention (camera rotation, tile size), input. Checklist and report template: `references/integration-playbook.md`.
2. **Pick the production path** from what exists (details: `references/production-paths.md`):
   - existing spritesheets → `isoanim process --spec` (path 1)
   - cut-out parts available → `isoanim articulated --rig` (path 2)
   - 3D model / Blender available → `scripts/blender_render_sprites.py` then `isoanim from-frames` (path 3, untested in CI)
   - external generators → implement `AnimationProvider` (`src/providers`), then `from-frames`. Never assume an image API exists.
3. **Analyze references**: `python scripts/isoanim.py analyze --image ref.png --out analysis.json`, merge into `character-manifest.json` (`references/manifest-format.md`).
4. **Produce frames** with the chosen path; configure profile (humanoid/quadruped/flying/legless), FPS, frame counts, loops, events, 4 or 8 directions. Locomotion needs `stride` (world cells per cycle) so playback can be foot-synced (`references/motion-quality.md`).
5. **Validate**: `python scripts/isoanim.py validate --manifest <m> --report-dir reports --game-speed walk=<u/s>`; fix findings; re-run. Exit code 1 = errors.
6. **Preview**: `isoanim preview --debug` (GIF + contact sheets with pivot and foot markers); `isoanim compare` for before/after.
7. **Integrate** with the Phaser adapter (`references/phaser-integration.md`): `CharacterAssetLoader`, `registerPhaserAnimations`, `IsometricCharacterController`, `GridPathfinder` or your own `PathfindingAdapter`, `PhaserDepthManager`. Keep a `syncMode: 'naive'` switch to compare old vs new movement.
8. **Test** (`npm test`, `npm run test:py`, `npm run test:e2e`), then give the user the report: passed, problems, automatic corrections, pending items, previews, integration status.

## Commands
`python scripts/isoanim.py <doctor|analyze|split|bg|align|atlas|process|articulated|from-frames|validate|preview|compare|generate-demo> --help`
Exit codes: 0 ok · 1 validation errors · 2 bad usage/input · 3 missing tool.

## Conventions (see `references/isometric-conventions.md`)
Directions are SCREEN compass names `S SW W NW N NE E SE`. Cartesian +x is NOT east: with the default projection +x walks down-right (SE). Always go through `IsoProjection` + `DirectionResolver`. Atlas frame names: `<anim>/<DIR>/<index>`; Phaser animation keys: `<id>:<anim>/<DIR>`.

## Environment
Python ≥3.9 + Pillow; Node ≥18. Optional: Blender, ffmpeg, image providers. `python scripts/isoanim.py doctor` lists what is present.
