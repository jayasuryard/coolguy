/**
 * CLI: `npm run validate` — fails (exit 1) on broken authored content.
 * Runs on Node's built-in TypeScript type stripping (Node 22.18+), no build step.
 */
import { fileURLToPath } from 'node:url';
import { loadContent } from './loadContent.ts';
import { validateContent } from './validateContent.ts';

const root = fileURLToPath(new URL('../content', import.meta.url));
const models = fileURLToPath(new URL('../game/public/assets/models', import.meta.url));
const content = loadContent(root, models);
const errors = validateContent(content);

if (errors.length) {
  console.error(`✗ content: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const objects = content.world.cells.reduce((n, c) => n + c.objects.length, 0);
console.log(
  `✓ content ok — ${content.world.cells.length} authored cells, ${objects} objects, ` +
    `${content.versions.length} versions, ${content.missions.length} missions, ${content.facts.length} facts, ` +
    `${content.modelNames?.length ?? 0} kit pieces`,
);
