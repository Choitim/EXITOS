import { Callout, CommandLine, CopyButton, SectionShell } from '../components/ui';
import { EXTERNAL_LINK_PROPS, sanitizeUrl } from '../lib/url';
import { REPO_URL, RUN_IT_COMMANDS } from './links';

/** Where to go from here: the same engine on the visitor's own computer, with the exact commands. */
export function RunItForReal() {
  const href = sanitizeUrl(REPO_URL);
  return (
    <div className="mt-10 sm:mt-14" data-testid="run-it-for-real">
      <SectionShell
        id="run-it-for-real"
        number={8}
        title="Run it for real"
        intro="The engine behind this page runs on your own computer. These commands run the same offline demo you just replayed: synthetic data, fake APIs, no account and no network."
      >
        <ol className="list-decimal space-y-4 pl-6 marker:font-semibold">
          {RUN_IT_COMMANDS.map((command, index) => (
            <li key={command} className="pl-1">
              <div className="flex flex-wrap items-start gap-x-3">
                <div className="min-w-0 flex-1 basis-64">
                  <CommandLine command={command} />
                </div>
                <CopyButton
                  text={command}
                  label={`Copy command ${index + 1}`}
                  testId={`copy-run-${index + 1}`}
                />
              </div>
            </li>
          ))}
        </ol>
        <p>
          Source code and documentation:{' '}
          {href === null ? (
            <code>{REPO_URL}</code>
          ) : (
            <a href={href} {...EXTERNAL_LINK_PROPS} data-testid="repo-link">
              github.com/Choitim/EXITOS
            </a>
          )}
          . Nothing on this page sends data to that address; the link only opens it in a new tab.
        </p>
        <Callout tone="warn" title="Before you trust it with real data" testId="prerelease-note">
          <p>
            ExitOS v0.1 is a <strong>pre-release</strong>. It has been tested against API-shaped
            fakes, <strong>not validated against live Notion or ClickUp workspaces</strong>. Try it
            on test workspaces first. v0.1 migrates Notion database rows to ClickUp tasks; moving
            pages to ClickUp Docs is experimental.
          </p>
        </Callout>
      </SectionShell>
    </div>
  );
}
