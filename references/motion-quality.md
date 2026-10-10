# Natural motion: what is implemented, and what it is not

## Implemented (objective, tested)
- **Foot sync**: `syncRate()` scales walk/run playback so feet advance as fast as the body (`src/core/footSync.ts`). Range 0.6–1.6×; outside it `syncClamped` is reported and the caller should switch walk↔run or accept slide.
- **Speed-aware states**: walk→run switching keeps cycle phase; direction changes keep phase (no restart stutter).
- **Acceleration/deceleration + turn-rate arcs** in `MovementController`; START_WALK/STOP_WALK animations cover the ramps where playback would be clamped.
- **Stop poses**: moving→still goes through STOP_WALK (if present) then IDLE, never freezing mid-stride.
- **Hysteresis** in `DirectionResolver` avoids direction flicker near octant boundaries.
- **Pixel stability**: sprite position rounded to whole pixels; one canvas size + pivot for every frame (validated).
- **Attachments** (weapons, scarves): author them in the frames; with the articulated path make them child parts so they inherit joint rotation. There is no runtime physics for accessories.
- **No pixel interpolation between frames**: frames are rendered per pose (procedural / rig / Blender) or taken from art. Do not tween sprites.
- **Foot-slide measurement**: with `footMarkers`+`cycleTravel`, planted feet must move `-bodyStep` per frame; residual px/frame is reported (`foot.slide`).
- **Diagnostics**: debug overlay (pivot, feet green=contact/orange=swing, path, grid, collisions, state), contact sheets and GIFs with `--debug`.

## Not provable by tools (heuristic / human)
Weight, anticipation, follow-through, silhouette readability, style consistency. Statistical checks (`motion.continuity`, `frames.scale`, `motion.loop-closure`) point at suspects; they cannot approve motion. Always review previews and the demo.

## Authoring rules of thumb
- Walk: even frame count (8), double support ≈ 2 of 8 frames, pelvis lowest in double support, arms opposite legs. Run: flight phase, bigger stride.
- Stance foot must move backward at exactly the body speed; swing foot lifts. The generator `python/isoanim/procedural.py` is an executable reference.
- Keep walk stride (world cells/loop) × fps / frames close to the game's walk speed (`--game-speed walk=<units/s>`).
- One-shots (attack/hit/death) use `events` (e.g. `hit` at the impact frame) so gameplay syncs damage to the animation, not to a timer.
