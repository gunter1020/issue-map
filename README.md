# issue-map

**English** · [繁體中文](README.zh-TW.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

Draws the blocking relationships between your GitHub Issues as a one-page dev map: **which issues
can be picked up now, which are waiting on what, and where the critical path runs.**

```bash
bunx issue-map@latest
```

Run it inside the repo you want to look at. A browser tab opens; every refresh re-fetches from
GitHub. GitHub Issues stays the source of truth — this page is a snapshot and cannot change status.

## Why

An agent takes one issue per round, so what you decide each round is **which one**. That answer is
in no single issue; it lives between them — who blocks whom, how many sub-issues a parent is still
waiting on, how long the longest chain is. GitHub shows you one issue at a time. This page shows
the picture.

It is built around [mattpocock/skills](https://github.com/mattpocock/skills) — write the workflow
as a skill, let the agent run it — which is where the default labels and commands come from.

## Usage

| Command                                             | What you get                         |
| --------------------------------------------------- | ------------------------------------ |
| `bunx issue-map@latest`                             | Server on a free port, browser opens |
| `bunx -p issue-map@latest issue-map-build`          | Static file at `dist/issue-map.html` |
| `bunx -p issue-map@latest issue-map-build out.html` | Static file at a path you name       |

- The repo comes from `gh` reading the git remote in your cwd — nothing to fill in.
- `ISSUE_MAP_PORT` pins the port. Pinned is strict: it fails rather than moving if taken.
- `ISSUE_MAP_OPEN=0` stops the browser tab.
- A static file goes stale. Use the server when you need the current state.
- Where scripts cannot run (a strict CSP, some preview panes) the file falls back to a plain
  listing of the issues rather than a blank page.
- `@latest` takes the newest version on npm; pin one with `bunx issue-map@0.2.0`.

## Requirements

- **Bun** — these scripts use `Bun.build`, `Bun.serve` and `Bun.file`; Node will not run them.
- **`gh` CLI, logged in**, with read access to the target repo.
- A git remote pointing at GitHub.

No runtime dependencies.

## Language

Switch in the top right: English (default), 繁體中文, 简体中文, 日本語. The choice is remembered in
the browser and is not tied to a repo — language is the reader's preference, not a project setting.

CLI output (build messages, errors) is English only.

## Configuration

Everything has a default — it runs with nothing set. The defaults live in `CONFIG` in
`scripts/issue-map.ts`.

| Environment variable       | Default                           | Meaning                                                                        |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `GH_REPO`                  | inferred from the git in cwd      | Map another repo (`gh`'s own variable; forks and multiple remotes are its job) |
| `ISSUE_MAP_PARENT_HEADING` | `Parent`                          | Body heading under which a sub-issue points at its parent                      |
| `ISSUE_MAP_LABELS_UNREADY` | `needs-triage,needs-info`         | Not assessed yet, cannot be handed to anyone                                   |
| `ISSUE_MAP_LABELS_READY`   | `ready-for-agent,ready-for-human` | Assessed and ready to work on                                                  |
| `ISSUE_MAP_LABELS_ACTIVE`  | `in-progress`                     | Somebody is on it, with or without an assignee                                 |
| `ISSUE_MAP_LABELS_HUMAN`   | `ready-for-human`                 | Needs a person, so the next step is not an implementation command              |
| `ISSUE_MAP_CMD_IMPLEMENT`  | `/implement`                      | Command the map suggests when an issue is ready                                |
| `ISSUE_MAP_CMD_TRIAGE`     | `/triage`                         | Command the map suggests when it still needs assessing                         |
| `ISSUE_MAP_PORT`           | an OS-assigned free port          | Port for the server                                                            |
| `ISSUE_MAP_OPEN`           | on                                | `0` stops the browser tab                                                      |

Three worth knowing:

- **Label vocabulary.** The ready/unready defaults are four of the five canonical
  [triage labels](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/triage-labels.md)
  from mattpocock/skills. If the target repo uses different names, set them. When none of these
  labels appear at all, triage stops being a gate — otherwise every issue would come out as "needs
  triage". (`in-progress` is this tool's own; the skills have no "somebody is on it" label.)
- **Command names.** `/implement` and `/triage` are the
  [`implement`](https://github.com/mattpocock/skills/tree/main/skills/engineering/implement) and
  [`triage`](https://github.com/mattpocock/skills/tree/main/skills/engineering/triage) skills. Point
  them at something that exists in the target repo, or the map tells people to run what isn't there.
- **Closed siblings need native sub-issues.** The map asks GitHub only for the closed issues an
  open one still points at, and children come from the native sub-issue relation. With the
  `## Parent` body convention a group's _closed_ children never appear, so its progress looks
  smaller than it is. Linking them once in the issue's Sub-issues panel brings them back; the body
  convention can stay, the native relation wins anyway.

## When it fails

`gh api graphql failed: …` — `gh` is not logged in, or your cwd is not inside the target repo's git
tree.

## Files

| File                         | Responsibility                                                           |
| ---------------------------- | ------------------------------------------------------------------------ |
| `scripts/issue-map.ts`       | Snapshot, status and next step, produces the HTML. Knobs in its `CONFIG` |
| `scripts/issue-map-model.ts` | Pure data model: grouping, critical path, layout. Shared by both sides   |
| `scripts/issue-map-i18n.ts`  | Strings for the four languages, plus the lookup                          |
| `scripts/issue-map-page.ts`  | Browser-side code, bundled into the HTML at build time                   |
| `scripts/issue-map.html`     | The template. Two placeholder blocks get filled in                       |
| `scripts/issue-map-serve.ts` | Local server, re-fetches on every request                                |
| `scripts/mutate.ts`          | Mutation testing: break one line, see whether a test goes red            |

## Developing in this repo

```bash
bun install
bun run issue-map:serve   # --watch; no browser tab (you would get one per save)
bun run issue-map         # build the file only, to dist/issue-map.html
bun run check             # lint + format:check + typecheck
bun test                  # the pure model layer
```

This repo has no issues of its own yet, so point `GH_REPO=<owner>/<repo>` at one that has tickets to
get anything drawn.

**Tests.** `tests/` only guards what would make the map lie or make it unreadable; looks (colour,
shape, spacing) are deliberately not asserted. A new guard test has to be verified in reverse — put
the defect it claims to catch back into the product code and confirm it goes red:

```bash
bun run mutate scripts/issue-map-model.ts tests/issue-map-layout.test.ts
```

**Adding to `scripts/issue-map-i18n.ts`.** `EN` is the original and defines the keys; the three
translations are typed from it, so a missing key or a missing `{n}` placeholder turns
`bun run typecheck` red. Keys needing English plurals are written `{ one, other }`; Chinese and
Japanese take a single string. The model never builds sentences — `nextStep` is a structured value
like `{ kind: 'waitChildren', count: 2 }`, assembled into words here.

## Two design decisions

- **The page cannot change status.** No button writes back to GitHub. Status has exactly one source
  of truth, and a second entry point makes them disagree.
- **No separate short name.** Stations are labelled with the first few characters of the title.
  A hand-maintained short name in the issue body would be a second source of truth — editing the
  title would not update it. The list below carries the full titles.
