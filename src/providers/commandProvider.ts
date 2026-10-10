import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnimationProvider, FrameRequest, FrameResult, ProviderConfig } from './index.js';

/**
 * Runs any external tool as a provider. The tool receives the path of a JSON
 * FrameRequest file and must print a JSON FrameResult on stdout. Node-only (not for browsers).
 */
export class CommandProvider implements AnimationProvider {
  readonly kind = 'command' as const;
  readonly id: string;
  private readonly command: string[];

  constructor(cfg: ProviderConfig) {
    if (!cfg.command?.length) throw new Error(`Provider "${cfg.id}": command is required`);
    this.id = cfg.id;
    this.command = cfg.command;
  }

  async isAvailable(): Promise<{ ok: boolean; reason?: string }> {
    return new Promise((resolve) => {
      const probe = process.platform === 'win32' ? 'where' : 'which';
      const c = spawn(probe, [this.command[0] as string], { stdio: 'ignore' });
      c.on('error', () => resolve({ ok: false, reason: `cannot probe for ${this.command[0]}` }));
      c.on('exit', (code) => resolve(code === 0 ? { ok: true } : { ok: false, reason: `${this.command[0]} not found on PATH` }));
    });
  }

  async generateFrames(req: FrameRequest): Promise<FrameResult> {
    const dir = await mkdtemp(join(tmpdir(), 'iso-anim-'));
    try {
      const file = join(dir, 'request.json');
      await writeFile(file, JSON.stringify(req));
      const [exe, ...args] = this.command.map((a) => a.replace('{request}', file));
      const out = await new Promise<string>((resolve, reject) => {
        const c = spawn(exe as string, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        c.stdout.on('data', (d) => (stdout += String(d)));
        c.stderr.on('data', (d) => (stderr += String(d)));
        c.on('error', reject);
        c.on('exit', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${this.id} exited with ${code}: ${stderr.trim()}`))));
      });
      const parsed = JSON.parse(out) as FrameResult;
      if (!Array.isArray(parsed.files) || parsed.files.length !== req.frames) {
        throw new Error(`${this.id} returned ${Array.isArray(parsed.files) ? parsed.files.length : 'no'} files, expected ${req.frames}`);
      }
      return parsed;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
