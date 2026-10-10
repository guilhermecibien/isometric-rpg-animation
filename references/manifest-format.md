# character-manifest.json

Schema: `schemas/character-manifest.schema.json`. Validated by `src/pipeline/manifest.ts` and `python/isoanim/manifest.py` (kept identical; both have tests).

```jsonc
{
  "schemaVersion": 1,
  "id": "hero",                       // identifier, also the Phaser texture key
  "profile": "humanoid",              // humanoid | quadruped | flying | legless (see src/core/animationRegistry.ts)
  "frame": { "width": 128, "height": 128 },
  "pivot": { "x": 64, "y": 90 },      // ground contact point inside the frame, identical in every frame
  "shadow": { "rx": 17, "ry": 8.5 },
  "atlas": { "image": "hero.png", "data": "hero.json" },   // Phaser JSON-array atlas; frame names "<anim>/<DIR>/<i>"
  "animations": {
    "walk": {
      "frames": 8, "fps": 10, "loop": true,
      "directions": ["S","SW","W","NW","N","NE","E","SE"],
      "events": [{ "frame": 1, "name": "footstep" }],
      "cycleTravel": { "E": { "x": 49.8, "y": 0 } },     // screen px the BODY moves per loop (locomotion)
      "footMarkers": { "E": [[{ "id": "L", "x": 12.1, "y": -2.5, "contact": true }]] },  // per frame, pivot-relative
      "frameDurations": [1,1,1,2,1,1,1,2]                 // optional multipliers for variable timing
    }
  },
  "source": { "method": "procedural|existing-spritesheet|articulated-2d|blender|frames-tree", "license": "...", "projection": { "tileWidth": 64, "tileHeight": 32, "zScale": 40 } },
  "analysis": { "analyzedBy": "local-metadata", "semanticAnalysis": false, "needsInput": [] }
}
```

- `cycleTravel` = world stride (cells per loop) projected by the runtime projection. It drives playback rate: `rate = groundSpeed / (|cycleTravel| · fps / frames)`.
- `footMarkers` are optional but enable slide validation. Without them `validate` reports `foot.nodata`/`foot.nocontacts` (info/warning), never a pass.
- `analysis.semanticAnalysis` must stay `false` unless a vision model/human actually filled the fields.
