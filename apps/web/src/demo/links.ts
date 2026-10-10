/**
 * The only addresses outside this site that the online demo mentions. They are NEVER requested by
 * the page: they appear as one ordinary link (opened by the visitor, in a new tab, with no referrer)
 * and as text to copy. The source-hygiene test allows these literals in this file and nowhere else.
 */
export const REPO_URL = 'https://github.com/Choitim/EXITOS';
export const CLONE_URL = 'https://github.com/Choitim/EXITOS.git';

/** The commands of the "Run it for real" panel, in the order a visitor types them. */
export const RUN_IT_COMMANDS: readonly string[] = [
  `git clone ${CLONE_URL}`,
  'cd EXITOS',
  'pnpm install',
  'pnpm build',
  'pnpm exitos demo',
];
