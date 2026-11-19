# Fixtures

Test fixtures that must keep working across releases.

- `saves/*.vN.json` — save files at schema version N. Every fixture is loaded through the
  migration chain by `game/src/platform/saves.test.ts` and must produce a valid save whose
  `lastSafePad` is a real pad in `content/`. Never edit an old fixture; add a new one when the
  schema changes.

Planned (Developer doc): saves around the goggles pickup, after each unlock, just before the
ending choice, postgame with all six recordings; timestamped input traces replayed at 30 and 60 fps.
