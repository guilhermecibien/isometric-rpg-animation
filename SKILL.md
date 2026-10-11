---
name: isometric-rpg-animation
description: Create, generate, fix, validate and integrate natural 2D isometric character/monster animations (idle, walk, run, attack, hit, death, 4/8 directions) into a Phaser.js RPG, Dofus-style. Use when the user gives a front character reference, spritesheets, or reports foot sliding, jittery frames, wrong directions, bad depth sorting or broken click/keyboard movement. Not for 3D games, non-isometric platformers, or pure art generation with no game integration.
---

# Isometric RPG animation

Pipeline: reference/spritesheet → analysis → production path → frame cleanup → validation → atlas+manifest → Phaser integration → tests. A single front reference may be expanded into an eight-direction animation set using Codex image generation, then treated as source art for the same validation and integration pipeline.
The repo you are in is both this skill and a library. Paths below are relative to the skill folder (`$SKILL`).

## Rules that must not be broken
- Never claim visual understanding you do not have. `scripts/isoanim.py analyze` is pixel statistics only (`semanticAnalysis: false`). If you have no vision model, ask the user only for the facts listed in `needsInput`.
- Diagnose before editing the game. Write the diagnosis + plan first, then change code incrementally. Keep the game's own pathfinding, collision and input; plug into them through adapters.
- Never delete old spritesheets. Never strip magenta (or any colour) automatically: `bg detect` first, then explicit `--color`.
- Passing validation ≠ natural motion. Report objective results and heuristic warnings separately, and tell the user what still needs their eyes (previews + demo).
- Do not invent test output. Run the commands and quote results; say what could not be run.
- Image generation is a source-art step, not proof of animation quality. Preserve the reference identity and visual style, generate transparent individual frames or direction sheets, and inspect every result before assembling it. Do not claim generated side/back views faithfully match unseen reference details.
- For image-model output, generate a single horizontal strip per animation and direction to keep generation costs practical. Require transparent gutters between every pose. Never cut an AI-generated strip on an assumed fixed grid: use `scripts/check_sheet_gutters.py` to verify and split at the actual gutters. If it fails, regenerate that strip with wider spacing; use individual frames only for a persistently failing direction/clip.
- **Each direction must be orientation-reviewed, by eye, before it is accepted.** Size/pivot/foot checks cannot tell a front view from a back view; a "SW" row drawn from behind passes them all and then plays as a character walking down-left while facing away. Run `isoanim orientation` on the generated set AND again on the final game sheet (after any row reordering), look at the compass sheet, and record what each cell actually faces. A mismatch means regenerate that direction, never "fix" it in code by swapping rows. Rules for generating the diagonals are in `references/front-reference-generation.md`.
- Do not overwrite the supplied reference or previous generated frames. Save each pass in a new, clearly named output folder; retain the prompt set and the selected frames.

## Workflow
1. **Diagnose the project** (read-only): Phaser version, asset layout, spritesheet format, movement/animation code, collision, pathfinding, coordinate convention (camera rotation, tile size), input. Checklist and report template: `references/integration-playbook.md`.
2. **Pick the production path** from what exists (details: `references/production-paths.md`):
   - existing spritesheets → `isoanim process --spec` (path 1)
   - cut-out parts available → `isoanim articulated --rig` (path 2)
   - 3D model / Blender available → `scripts/blender_render_sprites.py` then `isoanim from-frames` (path 3, untested in CI)
   - one front reference and no sprites → use the built-in image generation tool to produce one well-spaced source strip per direction and animation (path 4), split it at verified gutters, then `isoanim from-frames`; read `references/front-reference-generation.md`. Use the visible reference image as input, request a transparent background, and preserve each selected output in the project.
   - another external generator → implement `AnimationProvider` (`src/providers`), then `from-frames`. Never assume that provider is available.
3. **Analyze references**: `python scripts/isoanim.py analyze --image ref.png --out analysis.json`, merge into `character-manifest.json` (`references/manifest-format.md`).
4. **Produce frames** with the chosen path; configure profile (humanoid/quadruped/flying/legless), FPS, frame counts, loops, events, 4 or 8 directions. For a front-reference generation set, make 8 screen directions (`S SW W NW N NE E SE`) and these minimum clips: idle 4–8 looping frames; walk and/or run 6–8 looping frames per direction; attack/cast 6–12 frames with an impact event; hit 3–5 frames; die 6–10 frames ending in a held final pose. Locomotion needs `stride` (world cells per cycle) so playback can be foot-synced (`references/motion-quality.md`).
5. **Review orientation**: `python scripts/isoanim.py orientation --manifest <m> --out-dir reports` (or `--sheet <game-sheet.png> --rows <game row order> --frame-size WxH` for a flat game sheet). It draws each direction where it points on screen with a travel arrow. Open the image, fill `orientation-review.json` (`observed` = the screen direction the figure really faces), check with `orientation --check`, then copy it next to the manifest. Do this before step 6; re-do it for the final in-game row order.
6. **Validate**: `python scripts/isoanim.py validate --manifest <m> --report-dir reports --game-speed walk=<u/s>`; fix findings; re-run. Exit code 1 = errors. Add `--require-orientation` so a missing or wrong orientation review fails.
7. **Preview**: `isoanim preview --debug` (GIF + contact sheets with pivot and foot markers); `isoanim compare` for before/after.
8. **Integrate** with the Phaser adapter (`references/phaser-integration.md`): `CharacterAssetLoader`, `registerPhaserAnimations`, `IsometricCharacterController`, `GridPathfinder` or your own `PathfindingAdapter`, `PhaserDepthManager`. Keep a `syncMode: 'naive'` switch to compare old vs new movement.
9. **Test** (`npm test`, `npm run test:py`, `npm run test:e2e`), then give the user the report: passed, problems, automatic corrections, pending items, previews, integration status.

## Commands
`python scripts/isoanim.py <doctor|analyze|split|bg|align|atlas|process|articulated|from-frames|orientation|validate|preview|compare|generate-demo> --help`
Exit codes: 0 ok · 1 validation errors · 2 bad usage/input · 3 missing tool.

## Conventions (see `references/isometric-conventions.md`)
Directions are SCREEN compass names `S SW W NW N NE E SE`. Cartesian +x is NOT east: with the default projection +x walks down-right (SE). Always go through `IsoProjection` + `DirectionResolver`. Atlas frame names: `<anim>/<DIR>/<index>`; Phaser animation keys: `<id>:<anim>/<DIR>`.

## Environment
Python ≥3.9 + Pillow; Node ≥18. Optional: Blender, ffmpeg, image providers. `python scripts/isoanim.py doctor` lists what is present.
