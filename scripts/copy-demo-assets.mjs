// Copies the example character into the demo's public folder (kept out of git to avoid duplicates).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets/examples/hero');
const dst = join(root, 'examples/phaser-demo/public/characters/hero');
if (!existsSync(join(src, 'character-manifest.json'))) {
  console.error('assets/examples/hero is missing. Run: npm run assets:demo');
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
for (const f of ['character-manifest.json', 'hero.png', 'hero.json']) cpSync(join(src, f), join(dst, f));
console.log('demo assets copied to', dst);
