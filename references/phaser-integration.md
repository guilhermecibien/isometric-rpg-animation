# Phaser integration

Targets Phaser 3 (typings checked against phaser@3.90). The library has **no runtime import of Phaser**; the adapter only calls scene APIs (`load.json/atlas`, `cache.json`, `textures`, `add.sprite/ellipse`, `anims.create`, `input.keyboard.addKeys`, `input.on`). Phaser 4 is not verified.

```ts
import { IsoProjection, GridPathfinder } from 'isometric-rpg-animation';
import { CharacterAssetLoader, registerPhaserAnimations, IsometricCharacterController, PhaserDepthManager, PointerInput } from 'isometric-rpg-animation/phaser';

const projection = new IsoProjection({ tileWidth: 64, tileHeight: 32, origin: { x: 500, y: 100 } });
const manifest = await new CharacterAssetLoader(this).load({ id: 'hero', manifestUrl: 'characters/hero/character-manifest.json' }); // rejects with a clear message on missing/invalid assets
registerPhaserAnimations(this, manifest);   // optional: for code that uses sprite.anims

const hero = new IsometricCharacterController({
  scene: this, manifest, projection, start: { x: 2.5, y: 2.5 },
  movement: { walkSpeed: 1.4, runSpeed: 3.3, acceleration: 14, deceleration: 18 },
  collision: { isWalkable: (x, y) => map.walkable(x, y) },   // YOUR collision
  pathfinding: myAdapter,                                     // YOUR pathfinder (PathfindingAdapter) or new GridPathfinder(...)
  keyboard: true,
});
new PointerInput(this, projection).attach((world) => hero.moveTo(world));
// scene.update(time, delta): hero.update(time, delta)   // scene shutdown: hero.destroy()
```

## Responsibilities
| Piece | File | Notes |
|---|---|---|
| `IsoProjection`, `DirectionResolver` | core/iso, core/directions | engine-free |
| `AnimationStateMachine` | core/stateMachine | priorities, queue, interrupts, timeouts; custom states via config |
| `IsometricAnimationController` | core/animationController | picks animation+direction+frame+rate; events; owns the frame clock |
| `MovementController` | core/movement | keyboard + path, accel, collision sliding, cancel/halt |
| `AnimationRegistry` | core/animationRegistry | profiles, fallbacks, mirror/nearest direction |
| `FootAnchorController`, `IsometricDepthManager` | core | pivot/origin, shadow, painter order |
| `CharacterAssetLoader`, `registerPhaserAnimations` | phaser/assetLoader | |
| `IsometricCharacterController` | phaser/characterController | glue: sprite + shadow + above |
| `KeyboardInput`, `PointerInput` | phaser/input | screen-space WASD, click-to-world |
| `DebugOverlay`, `PhaserDepthManager` | phaser | |

Frames are driven by the core clock (`sprite.setFrame`), not Phaser's anim player, so events, variable durations and foot-sync are deterministic and unit-testable. `registerPhaserAnimations` exists for projects that also want native anims.

## Integrating into an existing game (incremental)
1. Keep existing movement; first only replace the art + manifest and run the demo with the new character.
2. Wrap existing collision/pathfinding in `CollisionAdapter`/`PathfindingAdapter`. Do not rewrite them.
3. Feed speeds in world units/s; check `isoanim validate --game-speed walk=<u/s> run=<u/s>`.
4. Keep `syncMode: 'naive'` available to compare against the old behaviour; remove it later.
5. Monsters: same controller with `profile: quadruped|flying|legless`; drive `moveTo`/`attack()`/`hit()`/`die()` from your AI (patrol/chase/flee are the AI's job; the controller only animates them).
