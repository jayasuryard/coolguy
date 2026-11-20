import type {
  ActorDef,
  ChapterDef,
  ContentBundle,
  FactDef,
  MissionDef,
  PhraseDef,
  RankDef,
  StepDef,
  VersionDef,
  WorldDef,
} from '@content/types';
import actors from '@content/story/actors.json';
import chapters from '@content/story/chapters.json';
import facts from '@content/story/facts.json';
import phrases from '@content/story/phrases.json';
import ranks from '@content/story/ranks.json';
import steps from '@content/story/steps.json';
import versions from '@content/world/versions.json';
import world from '@content/world/world.json';

const missions = import.meta.glob<MissionDef>('../../content/missions/*.json', {
  eager: true,
  import: 'default',
});

/** All authored content, bundled at build time. Validated by `npm run validate`. */
export const CONTENT: ContentBundle = {
  world: world as WorldDef,
  versions: versions as VersionDef[],
  facts: facts as FactDef[],
  ranks: ranks as RankDef[],
  phrases: phrases as PhraseDef[],
  chapters: chapters as ChapterDef[],
  actors: actors as ActorDef[],
  steps: steps as StepDef[],
  missions: Object.keys(missions)
    .sort()
    .map((k) => missions[k]!),
};

/** Bumped whenever authored content changes in a save-relevant way. */
export const CONTENT_VERSION = '0.2.0';
