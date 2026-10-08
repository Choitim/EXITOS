# Name check: "ExitOS"

**Checked 2026-10-08.** "ExitOS" is treated as a **working title**. This page records what was
checked; it is **not a trademark clearance or legal advice**, and ExitOS makes no claim that the
name is free to use. Do a proper trademark search before any public launch or commercial use.

## What was checked

| Check                                         | Result                                                                                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm package `exitos`                          | `404` from the registry — currently **unclaimed**. `exit-os`, `@exitos/core`, `@exitos/cli` also `404`.                                                                                                                       |
| npm search "exitos"                           | 3 loosely related results, none in this domain.                                                                                                                                                                               |
| GitHub user/org `exitos`                      | **Taken** — an account created 2018-01-28 with 0 public repos. The project cannot use `github.com/exitos`. `exitos-dev` (`404`) and `exit-os` (`404`) appear available.                                                       |
| GitHub repositories named `*exitos*`          | 157 results; the top ones are unrelated (an energy-community scheduler `llorencburgas/exitOS` — 2 stars; a hobby kernel `SteveGremory/ExitOS`; an academic artifact `toast-lab/exitos`). None is a software-portability tool. |
| Domains (DNS A record seen)                   | `exitos.com`, `exitos.io`, `exitos.app`, `exitos.org` resolve (registered). `exitos.dev` returned no A record (not proof it is available).                                                                                    |
| Web search for an "ExitOS" software trademark | No direct hit — **inconclusive**, not clearance.                                                                                                                                                                              |

## Concerns

1. **"OS" suffix.** The product is not an operating system; it may confuse search results and
   implies more scope than a migration tool has.
2. **Search noise.** "éxitos" is Spanish for "successes", so ordinary search for `exitos` is noisy.
3. **GitHub handle taken.** The canonical `github.com/exitos` URL is unavailable.
4. **Duplicate repo names** exist (`exitOS` in unrelated domains).

## Recommendation

- **Keep "ExitOS" as the working title for v0.1 development.** Nothing found is a blocking
  conflict, and the npm name is free.
- **Before public launch**, either (a) accept the concerns and use an org such as `exitos-dev`
  with the npm package `exitos`, or (b) rename. If renaming, candidate names that were _available
  on npm and as GitHub handles at check time_ (not trademark-cleared): **`exitctl`**, **`exitkit`**.
  `carryover` and `moveout` GitHub handles are taken.
- Keep the rename cost low: the product name is isolated to a few constants
  (`packages/shared/src/brand.ts`) and the `exitos` bin name in `apps/cli/package.json`.

> Nothing in this repository claims ownership of the name, and nothing publishes under it.
