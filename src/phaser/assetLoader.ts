import type Phaser from 'phaser';
import type { Logger } from '../core/types.js';
import { silentLogger } from '../core/types.js';
import { parseManifest, expectedFrameNames, type CharacterManifest } from '../pipeline/manifest.js';

export interface CharacterAssetSource {
  id: string;
  /** URL of character-manifest.json. The atlas image/json are resolved relative to it. */
  manifestUrl: string;
}

const manifestKey = (id: string) => `${id}:manifest`;

function dirname(url: string): string {
  const i = url.lastIndexOf('/');
  return i < 0 ? '' : url.slice(0, i + 1);
}

/**
 * Loads a character in two steps because the atlas paths live inside the manifest:
 *   1. fetch the manifest through Phaser's loader (so it is cached with the game)
 *   2. queue the atlas and wait for it
 * Missing or malformed assets reject with a descriptive error instead of failing silently.
 */
export class CharacterAssetLoader {
  constructor(private readonly scene: Phaser.Scene, private readonly log: Logger = silentLogger) {}

  /** Promise-based loading usable from `create()` or any later point. */
  load(src: CharacterAssetSource): Promise<CharacterManifest> {
    const { scene } = this;
    if (scene.textures.exists(src.id) && scene.cache.json.exists(manifestKey(src.id))) {
      return Promise.resolve(this.getManifest(src.id));
    }
    return new Promise<CharacterManifest>((resolve, reject) => {
      const loader = scene.load;
      const failed: string[] = [];
      const onError = (file: Phaser.Loader.File) => failed.push(file.src || file.key);
      const cleanup = () => loader.off('loaderror', onError);
      loader.on('loaderror', onError);

      const stage2 = () => {
        let manifest: CharacterManifest;
        try {
          if (failed.length) throw new Error(`Failed to load manifest for "${src.id}": ${failed.join(', ')}`);
          manifest = parseManifest(scene.cache.json.get(manifestKey(src.id)));
        } catch (e) {
          cleanup();
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        const base = dirname(src.manifestUrl);
        loader.once('complete', () => {
          cleanup();
          if (failed.length) { reject(new Error(`Failed to load atlas files for "${src.id}": ${failed.join(', ')}`)); return; }
          try { this.verifyAtlas(src.id, manifest); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); return; }
          resolve(manifest);
        });
        loader.atlas(src.id, base + manifest.atlas.image, base + manifest.atlas.data);
        loader.start();
      };

      loader.once('complete', stage2);
      loader.json(manifestKey(src.id), src.manifestUrl);
      loader.start();
    });
  }

  /** Queue-style variant for `preload()`: manifest only; call `queueAtlas` in `create`/after. */
  queueManifest(src: CharacterAssetSource): void {
    this.scene.load.json(manifestKey(src.id), src.manifestUrl);
  }

  getManifest(id: string): CharacterManifest {
    const raw = this.scene.cache.json.get(manifestKey(id));
    if (!raw) throw new Error(`Manifest for "${id}" is not loaded`);
    return parseManifest(raw);
  }

  private verifyAtlas(id: string, m: CharacterManifest): void {
    const tex = this.scene.textures.get(id);
    const have = new Set(tex.getFrameNames());
    const missing = expectedFrameNames(m).filter((n) => !have.has(n));
    if (missing.length) {
      throw new Error(`Atlas "${id}" is missing ${missing.length} frame(s) declared by the manifest, e.g. ${missing.slice(0, 3).join(', ')}`);
    }
    this.log.info(`Loaded "${id}" (${have.size} frames)`);
  }
}

/** Create Phaser animations for every animation/direction (idempotent). */
export function registerPhaserAnimations(scene: Phaser.Scene, manifest: CharacterManifest): string[] {
  const keys: string[] = [];
  for (const [anim, a] of Object.entries(manifest.animations)) {
    for (const dir of a.directions) {
      const key = `${manifest.id}:${anim}/${dir}`;
      keys.push(key);
      if (scene.anims.exists(key)) continue;
      scene.anims.create({
        key,
        frames: Array.from({ length: a.frames }, (_, i) => ({ key: manifest.id, frame: `${anim}/${dir}/${i}` })),
        frameRate: a.fps,
        repeat: a.loop ? -1 : 0,
      });
    }
  }
  return keys;
}
