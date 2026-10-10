# Monsters

Same infrastructure, different profile. Profiles (src/core/animationRegistry.ts) define required/optional animations and state→animation fallbacks:

- `quadruped`: idle, walk required; run/bite/claw/charge/jump optional; ATTACK falls back through attack→bite→claw→charge.
- `flying`: idle required; WALK/RUN fall back to `fly`→walk→idle.
- `legless`: 4 directions by default; move/slither used for locomotion.
- Custom: `new AnimationRegistry({ profile: { id, anatomy: 'custom', directions: 4, required: [...], optional: [...], fallbacks: {...} } })`.

Species-specific actions (bite, jump, charge, claws) are ordinary animation keys; request them with `controller.animation.requestAction('ATTACK', { animKey: 'bite' })`. Add custom states (e.g. `CHARGE`) through the `states` table of the state machine.

AI contract (the game owns the AI): patrol/chase/approach → `moveTo(world)`; attack → `attack(dir?)`; flee → `moveTo(away, true)`; return → `moveTo(home)`; damage → `hit()`; death → `die()`. Listen to `frameEvent` (`hit`, `bite`) for damage timing and `actionComplete` for AI re-planning. Do not build AI inside this skill.

Legless/flying movers without a stride (no `cycleTravel`) play at nominal fps; set `fps` so the cycle feels right at the game's speed.
