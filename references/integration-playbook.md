# Integration playbook (diagnosis first)

Before editing, produce this report for the user (inspect with Read/grep only):

1. Phaser version (`package.json`, CDN tag) and bundler.
2. Folder layout; where assets and scenes live.
3. Spritesheet format (grid/atlas, frame sizes, direction/row order, background colour or transparency).
4. Current movement code (velocity, tweens, Arcade physics?), current animation code (`anims.create`, `play`), who picks direction.
5. Collision (tilemap, Arcade, custom grid) and pathfinding library, if any.
6. Coordinate convention: tile size, origin, camera rotation, how screen↔world is converted.
7. Input (keyboard, pointer), events/hooks other systems rely on.
8. Problems observed: foot slide (compare stride vs speed), flicker at octant boundaries, abrupt stops, wrong depth, pivots jumping, mirrored frames drifting.

Then: plan (small steps, files to touch, adapters needed, rollback = old spritesheets untouched) → get a go-ahead if the plan changes gameplay code → implement → run tests → report (passed / problems / auto-corrections / pending / previews / integration status).

Report template: `isoanim validate --report-dir reports` writes `validation-report.md` with the first five items; add the diagnosis and integration status by hand.
