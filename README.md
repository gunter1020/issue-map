# issue-map

**English** · [繁體中文](README.zh-TW.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

Draws the blocking relationships between your GitHub Issues as a one-page dev map: **which issues
can be picked up now, which are waiting on what, and where the critical path runs.**

GitHub Issues stays the source of truth. This page is only a snapshot — you cannot change status on
it, so no second source of truth grows out of it.

## Why this exists

It started with [mattpocock/skills](https://github.com/mattpocock/skills). Once the team adopted
that way of working — write the workflow as a skill, let the agent run it — filing an issue got
cheap: think of something, open a ticket, hand it to a skill. So the issue count grew fast. That is
the process working, not a problem.

The problem is the next step. An agent takes one issue per round, so what you actually decide each
round is **which one**. That answer is in no single issue; it lives between them: who blocks whom,
how many sub-issues a parent is still waiting on, how long the longest chain is. GitHub Issues only
ever shows you one issue at a time, so assembling that picture means opening them one by one — and
doing it again tomorrow.

This page is that picture.

## Usage

Run it inside **the repo you want to look at**:

```bash
bunx issue-map@latest
```

`@latest` takes the newest version on npm; pin one with `bunx issue-map@0.2.0`.

It serves on a free port the OS picks **and opens your browser**; the startup line prints the
directory it is mapping and the URL, so several repos can serve at once without clashing. Pin the
port with `ISSUE_MAP_PORT` — that one is strict, and fails instead of moving if it is taken. Every
refresh re-fetches from GitHub, so what you see is the current state. The repo is what `gh` infers
from the git remote in your cwd — nothing to fill in.

Set `ISSUE_MAP_OPEN=0` if you don't want the tab.

If all you want is a static HTML file (`-p` is what picks the other bin; without it you get the
server):

```bash
bunx -p issue-map@latest issue-map-build            # writes dist/issue-map.html
bunx -p issue-map@latest issue-map-build out.html
```

A snapshot is a snapshot — it goes stale. Use the server above when you need the current state.

## Language

Switch in the top right. **English is the default**; Traditional Chinese, Simplified Chinese and
Japanese are also supported. The choice is remembered in the browser (`issue-map:locale` in
localStorage) and is not tied to a repo — language is the preference of whoever is reading, not a
setting of the project. `navigator.language` is deliberately ignored: English is the default, and
guessing wrong just means changing it back on every visit.

Every string lives in `scripts/issue-map-i18n.ts`, the single source for every sentence on the page:

- `EN` is the original, and the place the keys are defined. The three translations are typed from
  it, so missing a key turns `bun run typecheck` red.
- The placeholder names inside a sentence (`{n}`, `{issues}`) are part of the type too — miss one
  and it will not compile. Otherwise the missing one prints as a literal `{n}` on the page, and
  you would only find it by reaching that exact cell.
- Keys that need English plurals are written `{ one, other }`; Chinese and Japanese take a single
  string (`Intl.PluralRules` only has `other` for those languages).

The model and fetch side **no longer builds sentences**: `nextStep` is a structured value such as
`{ kind: 'waitChildren', count: 2 }`, and so are group names. The words are assembled in the i18n
layer. If the snapshot stored sentences, switching language would mean re-fetching from GitHub.

The CLI side (build messages, errors) is English only and does not follow the page's language
setting: it is the output of `bunx issue-map`, read by whoever ran the command, not part of the
page. `scripts/mutate.ts` is the exception — it is an in-repo tool, so it stays Chinese.

## Requirements

- **Bun.** These scripts use `Bun.build`, `Bun.serve`, `Bun.file` and bun's `spawnSync`; Node will
  not run them.
- **`gh` CLI, logged in**, with read access to the target repo.
- The target repo has a git remote pointing at GitHub.
- No runtime dependencies; devDependencies are only types and lint/format tools.

## Configuration

Everything has a default — it runs with nothing set. The defaults live in `CONFIG` in
`scripts/issue-map.ts`.

| Environment variable       | Default                           | Meaning                                                                                                                                                                      |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GH_REPO`                  | inferred from the git in cwd      | Set it to map another repo (`gh`'s own variable; forks and multiple remotes are its job too)                                                                                 |
| `ISSUE_MAP_PARENT_HEADING` | `Parent`                          | The body heading under which a sub-issue points at its parent. A native GitHub sub-issue relation wins when present, and only native ones show _closed_ siblings (see below) |
| `ISSUE_MAP_LABELS_UNREADY` | `needs-triage,needs-info`         | Carrying one means it is not assessed yet and cannot be handed to anyone                                                                                                     |
| `ISSUE_MAP_LABELS_READY`   | `ready-for-agent,ready-for-human` | Only with one of these does an issue count as assessed and ready to work on                                                                                                  |
| `ISSUE_MAP_LABELS_ACTIVE`  | `in-progress`                     | Carrying one means somebody is on it, with or without an assignee                                                                                                            |
| `ISSUE_MAP_LABELS_HUMAN`   | `ready-for-human`                 | These need a person, so the next step is not an implementation command                                                                                                       |
| `ISSUE_MAP_CMD_IMPLEMENT`  | `/implement`                      | The command the map tells you to run when an issue is ready                                                                                                                  |
| `ISSUE_MAP_CMD_TRIAGE`     | `/triage`                         | The command the map tells you to run when it still needs assessing                                                                                                           |
| `ISSUE_MAP_PORT`           | an OS-assigned free port          | Port for the server                                                                                                                                                          |
| `ISSUE_MAP_OPEN`           | on                                | Set `0` to stop opening the browser (the `bun --watch` dev mode has it off)                                                                                                  |

Three worth thinking through:

- **Label vocabulary**: if the target repo does not use this set, replace them with its own names.
  The code detects it — when the snapshot contains none of the ready/unready labels at all, triage
  is not used as a gate; otherwise every issue would come out as "needs triage".
- **Command names**: `/implement` and `/triage` are Claude Code skills. If the target repo has no
  such skills you must change them, or the map will tell people to run something that does not
  exist.
- **Closed siblings need native sub-issues**: the map asks GitHub only for the closed issues an
  open one still points at — its blockers, its parent, and that parent's children. Children come
  from GitHub's native sub-issue relation, so with the `## Parent` body convention a group's
  _closed_ children never appear and its progress looks smaller than it is. Open issues are not
  affected. The alternative is scanning every closed issue in the repo, which on an old repo means
  dozens of requests to find a handful of issues. If a group predates native sub-issues, linking
  its children once (the issue's Sub-issues panel) brings the closed ones back; the body convention
  can stay, the native relation wins anyway.

## When it fails

- `gh api graphql failed: …` — `gh` is not logged in, or your cwd is not inside the target repo's
  git tree.

## Files

| File                         | Responsibility                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/issue-map.ts`       | Takes the snapshot, derives each issue's status and next step, produces the HTML. Porting knobs live in its `CONFIG`                       |
| `scripts/issue-map-model.ts` | Pure data model: grouping, critical path. Shared by both sides                                                                             |
| `scripts/issue-map-i18n.ts`  | Strings for the four languages, plus the lookup. Single source for every sentence on the page                                              |
| `scripts/issue-map-page.ts`  | Browser-side code, bundled into the HTML at build time                                                                                     |
| `scripts/issue-map.html`     | The template. Two placeholder blocks (`issue-map-data`, `issue-map-code`) get filled in                                                    |
| `scripts/issue-map-serve.ts` | Local server, re-fetches on every request                                                                                                  |
| `scripts/mutate.ts`          | Mutation testing: break one line and see whether a test goes red. Use it to verify guard tests in reverse instead of editing files by hand |

## Developing in this repo

```bash
bun install
bun run issue-map:serve   # --watch, restarts on change; deliberately does not open a tab (you would get one per save)
bun run issue-map         # build the file only, to dist/issue-map.html
bun run check             # lint + format:check + typecheck
bun test                  # the pure model layer (grouping, critical path, layout)
```

This repo has no issues of its own yet, so point `GH_REPO=<owner>/<repo>` at one that has tickets to
get anything drawn.

`tests/` only guards things that would make the map lie or make it unreadable; looks (colour, shape,
spacing) are deliberately not asserted. A new guard test has to be verified in reverse — put the
defect it claims to catch back into the product code and confirm it goes red:

```bash
bun run mutate scripts/issue-map-model.ts tests/issue-map-layout.test.ts
```

## Two design decisions, know them before you change things

- **This page cannot change status.** No button writes back to GitHub. That is deliberate: status
  has exactly one source of truth, and a second entry point makes them disagree.
- **Issue titles stay off the map.** Nodes carry only the number; names are in the list below. A
  short-name section in the body was tried, and it is a second source of truth for the title —
  editing the title does not update it; shortening titles mechanically does not read.
