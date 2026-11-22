# Triage Labels

The skills speak in terms of issue categories, canonical triage roles, and active hand-off status. This table maps those roles to the actual label strings present in this repo's GitHub tracker (`gh label list`).

## 類別（Category）

| Role        | Label in our tracker | Meaning                 |
| ----------- | -------------------- | ----------------------- |
| bug         | `bug`                | Something isn't working |
| enhancement | `enhancement`        | New feature or request  |

## 狀態（Status）

| Role              | Label in our tracker | Meaning                                  |
| ----------------- | -------------------- | ---------------------------------------- |
| `needs-triage`    | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`    | Requires human implementation            |
| `wontfix`         | `wontfix`            | Will not be worked on                    |

## 手動維護（Manual hand-off）

| Role          | Label in our tracker | Meaning                                                         |
| ------------- | -------------------- | --------------------------------------------------------------- |
| `in-progress` | `in-progress`        | Somebody is on it（對應 `src/issue-map.ts` 的 `CONFIG.active`） |

When a skill mentions a role (e.g. "apply the AFK-ready triage label" or "remove the active label"), use the corresponding label string from this file.
