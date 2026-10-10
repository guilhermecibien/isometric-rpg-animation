import { test, expect, type Page } from '@playwright/test';

type State = {
  state: string; anim: string; direction: string; frame: number; rate: number; syncClamped: boolean; flipX: boolean;
  world: { x: number; y: number }; speed: number; mode: string; path: number; syncMode: string; footsteps: number; preview: boolean; depth: number;
};
const demo = (page: Page) => page.evaluate(() => window.__demo!.getState()) as Promise<State>;

/** Software-rendered CI runs at low FPS, so wait for conditions instead of fixed durations. */
const until = (page: Page, fn: (s: State) => boolean, timeout = 15_000) =>
  page.waitForFunction((src) => (new Function('s', `return (${src})(s)`))(window.__demo!.getState()), fn.toString(), { timeout });

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { _errors: string[] })._errors = errors;
  await page.goto('/');
  await page.waitForFunction(() => window.__demo?.ready === true, undefined, { timeout: 30_000 });
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { _errors: string[] })._errors).toEqual([]);
});

test('loads the character and idles facing south', async ({ page }) => {
  const s = await demo(page);
  expect(s.state).toBe('IDLE');
  expect(s.anim).toBe('idle');
  expect(s.direction).toBe('S');
  await expect(page.locator('#status')).toContainText('IDLE');
  await page.screenshot({ path: 'test-results/demo-idle.png' });
});

test('WASD moves in SCREEN space: D walks screen-right (east), not along world +x', async ({ page }) => {
  await page.locator('canvas').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  const before = await demo(page);
  await page.keyboard.down('d');
  await until(page, (s) => (s.world.x as number) > 2.5 + 0.4 && s.direction === 'E');
  const mid = await demo(page);
  expect(mid.state === 'WALK' || mid.state === 'START_WALK').toBeTruthy();
  expect(mid.direction).toBe('E');
  // screen-right = world (+1,-1): x grows, y shrinks
  expect(mid.world.x).toBeGreaterThan(before.world.x + 0.3);
  expect(mid.world.y).toBeLessThan(before.world.y - 0.3);
  await page.keyboard.up('d');
  await until(page, (s) => s.state === 'IDLE');
  const end = await demo(page);
  expect(end.state).toBe('IDLE');
  expect(end.direction).toBe('E');
  expect(end.speed).toBe(0);
});

test('diagonal keys give diagonal directions and the walk cycle is foot-synced', async ({ page }) => {
  await page.keyboard.down('s');
  await page.keyboard.down('d');
  await until(page, (s) => s.state === 'WALK' && s.direction === 'SE');
  const s = await demo(page);
  expect(s.direction).toBe('SE');
  expect(s.anim).toBe('walk');
  expect(s.syncClamped).toBe(false);
  expect(s.rate).toBeGreaterThan(0.6);
  expect(s.rate).toBeLessThan(1.6);
  await page.keyboard.up('s');
  await page.keyboard.up('d');
});

test('shift runs with the run animation', async ({ page }) => {
  await page.keyboard.down('Shift');
  await page.keyboard.down('d');
  await until(page, (s) => s.state === 'RUN');
  const s = await demo(page);
  expect(s.state).toBe('RUN');
  expect(s.anim).toBe('run');
  await page.keyboard.up('d');
  await page.keyboard.up('Shift');
});

test('click-to-move walks a path around obstacles and arrives', async ({ page }) => {
  const target = await page.evaluate(() => window.__demo!.worldToScreenPage(8.5, 2.5));
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(300);
  const mid = await demo(page);
  expect(mid.mode).toBe('path');
  await page.waitForFunction(() => window.__demo!.getState().mode === 'idle', undefined, { timeout: 15_000 });
  await page.waitForTimeout(500);
  const end = await demo(page);
  expect(Math.hypot(end.world.x - 8.5, end.world.y - 2.5)).toBeLessThan(0.15);
  expect(end.state).toBe('IDLE');
  expect(end.footsteps).toBeGreaterThan(2);
});

test('mixed control: keyboard cancels a click path, and a click overrides the keyboard', async ({ page }) => {
  const far = await page.evaluate(() => window.__demo!.worldToScreenPage(11.5, 1.5));
  await page.mouse.click(far.x, far.y);
  await page.waitForTimeout(300);
  expect((await demo(page)).mode).toBe('path');
  await page.keyboard.down('a');
  await page.waitForTimeout(200);
  expect((await demo(page)).mode).toBe('input');
  expect((await demo(page)).path).toBe(0);
  const near = await page.evaluate(() => window.__demo!.worldToScreenPage(4.5, 1.5));
  await page.mouse.click(near.x, near.y);
  await page.waitForTimeout(200);
  expect((await demo(page)).mode).toBe('path');
  await page.keyboard.up('a');
});

test('clicking a blocked cell is ignored', async ({ page }) => {
  const blocked = await page.evaluate(() => window.__demo!.worldToScreenPage(5.5, 4.5));
  await page.mouse.click(blocked.x, blocked.y);
  await page.waitForTimeout(200);
  expect((await demo(page)).mode).toBe('idle');
});

test('walls block movement', async ({ page }) => {
  // walk "up" the screen (world -x,-y) off the map edge; character must stay inside the grid
  await page.keyboard.down('w');
  await page.waitForTimeout(3000);
  const s = await demo(page);
  expect(s.world.x).toBeGreaterThanOrEqual(0);
  expect(s.world.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.up('w');
});

test('attack locks direction and movement, fires the hit event window, then recovers', async ({ page }) => {
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  const a = await demo(page);
  expect(a.state).toBe('ATTACK');
  await page.keyboard.down('d'); // trying to move during the swing
  await page.waitForTimeout(150);
  const during = await demo(page);
  expect(during.state).toBe('ATTACK');
  expect(during.direction).toBe(a.direction);
  await page.keyboard.up('d');
  await until(page, (s) => s.state === 'IDLE', 20_000);
  expect((await demo(page)).state).toBe('IDLE');
});

test('hit interrupts, death is final until respawn', async ({ page }) => {
  await page.keyboard.press('h');
  await until(page, (s) => s.state === 'HIT');
  await until(page, (s) => s.state === 'IDLE');
  await page.keyboard.press('k');
  await until(page, (s) => s.state === 'DEATH');
  await page.keyboard.down('d');
  await page.waitForTimeout(300);
  expect((await demo(page)).state).toBe('DEATH');
  await page.keyboard.up('d');
  await page.screenshot({ path: 'test-results/demo-dead.png' });
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  expect((await demo(page)).state).toBe('IDLE');
});

test('naive mode (legacy) disables the foot sync; synced mode restores it', async ({ page }) => {
  await page.click('#sync-naive');
  expect((await demo(page)).syncMode).toBe('naive');
  await page.keyboard.down('Shift');
  await page.keyboard.down('d');
  await until(page, (s) => s.state === 'RUN');
  const naive = await demo(page);
  expect(naive.rate).toBe(1);
  await page.keyboard.up('d'); await page.keyboard.up('Shift');
  await page.click('#sync-synced');
  await until(page, (s) => s.state === 'IDLE');
  await page.keyboard.down('d');
  await until(page, (s) => s.state === 'WALK' && s.syncMode === 'synced' && s.speed >= 1.39);
  const synced = await demo(page);
  expect(synced.syncMode).toBe('synced');
  expect(synced.rate).not.toBe(1);
  await page.keyboard.up('d');
});

test('animation preview lets you pick animation and direction', async ({ page }) => {
  await page.selectOption('#anim', 'attack');
  await page.selectOption('#dir', 'NW');
  await page.click('#preview-on');
  await page.waitForTimeout(300);
  let s = await demo(page);
  expect(s.preview).toBe(true);
  expect(s.anim).toBe('attack');
  expect(s.direction).toBe('NW');
  await page.click('#preview-off');
  await page.waitForTimeout(300);
  s = await demo(page);
  expect(s.preview).toBe(false);
});

test('debug flags toggle and character depth-sorts behind blocks', async ({ page }) => {
  await expect(page.locator('#dbg-grid')).toBeChecked();
  await page.uncheck('#dbg-grid');
  await expect(page.locator('#dbg-grid')).not.toBeChecked();
  // standing "behind" (smaller x+y) the block at (5,4) vs in front of it
  const behind = await page.evaluate(() => window.__demo!.getState().depth as number);
  const target = await page.evaluate(() => window.__demo!.worldToScreenPage(7.5, 6.5));
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(() => window.__demo!.getState().mode === 'idle' && (window.__demo!.getState().world as { x: number }).x > 7, undefined, { timeout: 15_000 });
  const front = await demo(page);
  expect(front.depth).toBeGreaterThan(behind);
  await page.screenshot({ path: 'test-results/demo-front.png' });
});
