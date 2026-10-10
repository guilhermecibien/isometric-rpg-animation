# Installation

Two separate things: installing the **skill** (so Codex finds it) and installing the **tools** the skill runs (Python/Node packages).

## 1. Install the skill (Codex ≥ skills support, VS Code extension or CLI)
Codex discovers skill folders containing `SKILL.md` in `.agents/skills` (repo), `$HOME/.agents/skills` (user), `/etc/codex/skills` (admin). Source: OpenAI Codex skills documentation (checked 2026-10). Older setups used `~/.codex/skills`; if your Codex only scans that, link there instead.

```bash
git clone https://github.com/guilhermecibien/isometric-rpg-animation ~/tools/isometric-rpg-animation

# local to one game repo
mkdir -p <game>/.agents/skills && ln -s ~/tools/isometric-rpg-animation <game>/.agents/skills/isometric-rpg-animation
# shared for your user
mkdir -p ~/.agents/skills && ln -s ~/tools/isometric-rpg-animation ~/.agents/skills/isometric-rpg-animation
```
Windows (PowerShell, admin or developer mode): `New-Item -ItemType SymbolicLink -Path $HOME\.agents\skills\isometric-rpg-animation -Target C:\tools\isometric-rpg-animation` or just copy the folder. Restart Codex if the skill does not show up (`/skills` or `$` lists it). Disable without deleting via `[[skills.config]] path=... enabled=false` in `~/.codex/config.toml`.

## 2. Install the tools
```bash
cd ~/tools/isometric-rpg-animation
python3 -m pip install -r requirements.txt     # Pillow (required). Or: pip install -e .  → `isoanim` command
npm install                                    # TypeScript, vitest, vite, phaser (dev), playwright (dev)
python3 scripts/isoanim.py doctor              # shows what is present
```
Optional: Blender ≥3.6 (3D path), ffmpeg (mp4 previews, not required), `npx playwright install chromium` (e2e).

## 3. Use the library in a game
`npm install /path/to/isometric-rpg-animation` (or add as a git dependency), `npm run build` in the skill folder, then `import … from 'isometric-rpg-animation'` and `'isometric-rpg-animation/phaser'`. Phaser is a peer dependency (`^3.80`). Or copy `src/core` + `src/phaser` + `src/pipeline` into your project (MIT).

## 4. Providers (optional)
Nothing requires one. To plug a tool in, implement `AnimationProvider` or wrap an executable with `CommandProvider` (`isometric-rpg-animation/providers/node`): it receives a JSON request file path and prints a JSON result. Secrets: only environment variable *names* go in config (`apiKeyEnv`).

## 5. Demo, tests, update
```bash
npm run assets:demo && npm run demo            # http://localhost:5173
npm test && npm run test:py && npx playwright install chromium && npm run test:e2e
npm run validate:skill
git pull && npm install && python3 -m pip install -r requirements.txt   # update; re-run tests
```
