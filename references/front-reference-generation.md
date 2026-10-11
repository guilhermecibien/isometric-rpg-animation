# Front reference to isometric animation source art

Use this route when the user supplies one front-facing character image and wants a playable Dofus-style isometric character. It produces source frames, not a guaranteed finished animation: the generated frames must pass technical checks and visual review.

## Before generating

1. Inspect the reference and run `python3 scripts/isoanim.py analyze --image <reference> --out analysis.json`. This reports pixels and transparency, not character semantics.
2. Ask only for decisions the image cannot establish: weapon and hand, equipment that must appear from unseen sides, whether the action is attack or cast, and whether walk, run, or both are required. If no choice is provided, make the safest visible-style inference and disclose it.
3. Establish the shared contract: same character identity, proportions, costume, outline, palette, weapon, canvas size, ground-contact point and transparent background. Never add text, scenery, shadows detached from the feet, extra limbs, or another character.

## Generate the source set

Use the built-in image generation tool. Include the supplied reference image in every generation/edit call. Generate one horizontal multi-frame strip for each `(clip, direction)` pair: this keeps the number of generations manageable while preserving pose continuity.

The strip must contain exactly `[FRAME COUNT]` full-body poses in a single row, with generous **fully transparent vertical gutters** between poses. Ask for a target gutter of **48 px** and require at least **24 px** after generation. The gutters must run from top to bottom of the image; they are safe cut zones, not decorative spacing. Require no character pixel, outline, glow, shadow or loose artifact in them.

Before splitting, verify and split at the gutters actually found in the image:

```bash
python3 scripts/check_sheet_gutters.py --sheet <sheet.png> --cols <frame-count> --min-gutter 24 --out-dir frames/<clip>/<DIR>
```

This writes `0.png` through `<frame-count - 1>.png`, cutting at the verified gutter positions rather than equally dividing the sheet width. If the command exits non-zero, do not use `isoanim split --cols ...` and do not attempt to repair the boundary with a tighter crop. Regenerate that strip with a targeted spacing correction; use individual images only if the same direction/clip fails again. `isoanim split --auto` is not a safety check for generated strips: limbs separated by transparent gaps can be mistaken for independent frames.

Create all eight screen directions (manifest order `S SW W NW N NE E SE`). The game may store rows in another order (for example `N NE E SE S SW W NW`); the order is only a mapping, and the orientation review below is what proves each row faces its label. Direction names describe the screen-facing direction; map movement through `IsoProjection` and `DirectionResolver`, never by intuition about world axes.

For each direction, request the required clips:

| Clip | Frames | Playback | Required motion cue |
|---|---:|---|---|
| `idle` | 4–8 | loop | subtle breathing/weight shift; first and last poses must join |
| `walk` | 6–8 | loop | alternating planted feet, arms opposite legs, visible step cycle |
| `run` (when requested) | 6–8 | loop | longer stride and a flight phase |
| `attack` or `cast` | 6–12 | once | anticipation, impact/release, recovery; mark the impact frame |
| `hit` | 3–5 | once | quick recoil then recovery |
| `die` | 6–10 | once | fall to ground; final frame remains held |

### Direction view contract (the diagonals are where generation fails)

A single front reference makes the model default to front-facing or mirrored poses for every direction. Each direction must be requested with its own explicit view; put the row for the direction in the prompt's `[VIEW]` field verbatim:

| Direction | `[VIEW]` to request |
|---|---|
| `S` | straight from the FRONT, face and chest toward the viewer, walking toward the camera |
| `SW` | FRONT three-quarter view: face and chest visible, body turned toward screen-left, walking toward the bottom-left of the screen |
| `W` | LEFT-facing profile: face and chest toward screen-left, walking to the left |
| `NW` | BACK three-quarter view: mostly the back and back of the head, body turned away toward screen-left, walking toward the top-left, face hidden or only a sliver of the cheek |
| `N` | straight from BEHIND, back of head and back visible, no face, walking away from the camera |
| `NE` | BACK three-quarter view: mostly the back and back of the head, body turned away toward screen-right, walking toward the top-right |
| `E` | RIGHT-facing profile: face and chest toward screen-right, walking to the right |
| `SE` | FRONT three-quarter view: face and chest visible, body turned toward screen-right, walking toward the bottom-right of the screen |

Rules learned from a real failure (SW came out as a back view, NW looked right, the "front" 3/4 views were nearly frontal):
- **Facing = direction of travel.** The face and chest (or the back) must point where the character walks. A head turned over the shoulder toward a different direction is a failure; so is a body that faces the camera while the feet travel sideways.
- **Never derive a direction by mirroring or by reusing another one.** `SW` is not `NW` flipped vertically and `SE` is not `SW` flipped unless the art is truly symmetric (carried item or asymmetric hair makes it asymmetric). Generate the left and right 3/4 views separately; mirror only if the user explicitly asks for mirrored art, and then say so in the report.
- `SW`/`SE` are FRONT three-quarter (you see the face); `NW`/`NE` are BACK three-quarter (you see the back). They are never interchangeable: a front-3/4 left and a back-3/4 left are different drawings.
- Keep 3/4 views at roughly 45° to the camera, not almost frontal. If `SE` is indistinguishable from `S` at thumbnail size, regenerate it with a stronger turn.
- Generate every direction with the same reference image attached so identity holds, and add the row from the table above; do not paraphrase it into "turn right" (the model reads that as the character's right hand, not the screen's right).

Use a prompt contract like this, replacing only bracketed fields:

```text
Asset type: 2D isometric RPG animation source frames
Input image: supplied front-reference character; preserve its identity and visible art style
Request: exactly [FRAME COUNT] sequential [CLIP] poses in one horizontal strip, direction [DIRECTION]
View: [VIEW — the row for this direction in the table above, verbatim]
Projection: Dofus-style 2D isometric, screen-facing direction [DIRECTION]
Continuity: same proportions, face, hair, clothing, equipment, palette, outline weight, scale and ground-contact position in every pose
Motion: [MOTION CUE]
Layout: one row of [FRAME COUNT] cells. Place one full body centered in each cell. Leave 48 px of completely empty transparent background between cells and at both outer edges; no part of any body, outline, effect or shadow may enter this gap.
Output: [FRAME COUNT] poses of the same character, transparent background, no labels, no text, no scenery, no watermark
Avoid: a different view than requested, mirrored or reused views from other directions, overlapping poses, touching poses, duplicate limbs, cropping, floating feet, different weapons or costumes, perspective changes, panels or borders
```

For attack/cast, include the chosen weapon or effect and require the impact/release pose to be visually unambiguous. Do not invent unseen equipment as a fact; label it as a generation choice in the report.

## Select, normalize, validate

0. **Orientation gate (blocking).** Before cutting, and again on the final game sheet, run `python3 scripts/isoanim.py orientation --manifest <m> --out-dir reports` (flat sheet: `--sheet walk.png --rows <game order> --frame-size WxH`). Open `orientation-sheet.png`: every direction is drawn where it points on screen with a travel arrow. For each cell record in `orientation-review.json` which direction the figure really faces, then `isoanim orientation --check`. Any mismatch (SW showing the back, NW facing right, a "3/4" that is really frontal) means regenerate that direction with the view contract above; do not swap or mirror rows to hide it.
1. Inspect each generated strip and reject drift, cropped limbs, direction mistakes, detached equipment, incompatible shadows, overlapping poses, or artifacts inside a gutter. Regenerate only the failed direction/clip strip with a targeted correction.
2. Verify and split every strip with `check_sheet_gutters.py`; never use equal-width cutting. Normalize selected frames so every frame has one canvas size and the same foot pivot. Keep the originals and put selected frames in a versioned project folder.
3. Build the atlas and manifest with `isoanim from-frames`. Set `loop: true` for idle/walk/run, `loop: false` for attack/cast/hit/die, add the attack/cast impact event, and add `stride` plus foot markers for walk/run.
4. Run `python3 scripts/isoanim.py validate --manifest <m> --report-dir reports --game-speed walk=<u/s>` and make debug previews. Use `--require-orientation`. Fix technical errors, then review all direction changes and loops in the Phaser demo.

The validator can verify pivots, dimensions, loop closure and measured foot sliding; it cannot prove anatomy, convincing weight, or character identity. Report those visual checks separately.
