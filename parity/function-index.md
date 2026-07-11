# Function Index Mapping

This file maps the 10 function groups from `1.md` to the parity ledger.
It is an index only. It is not source-code evidence and cannot close any P item.

| Ledger ID | Function group | `1.md` sections | Notes |
|---|---|---|---|
| P01 | Logging governance | 8, 14.4 | Needs frozen logger code and engine event call-site evidence. |
| P02 | File read/write and File Preview | 9, 14.5 | Includes File Preview editing, `file:read`, `file:write`, and hardening split. |
| P03 | Input history and archived preview | 6, 10, 14.3, 14.5 | Combines searchable history and archive preview contracts. |
| P04 | Session restore and persistence | 11, 14.5 | Covers Space restore, delayed hydration, unload save, atomic writes. |
| P05 | Todo / Checklist | 12, 14.6 | Covers aliases, close controls, and stopped-state display. |
| P06 | Long-session virtualization | 7, 14.4 | Requires DOM-bound, tail, measurement, and search-jump evidence. |
| P07 | OpenCode engine | 4, 14.1 | Largest engine-lifecycle contract; source snapshot is required before implementation claims. |
| P08 | Relay collaboration | 5, 14.2 | Covers recipes, lanes, draft materialization, handoff, and Sidebar entry. |
| P09 | Codex configured model fallback | 13, 14.6 | Must be treated as H until both source and target use the conservative contract. |
| P10 | Defaults and contracts | 3, 15, 16, 17 | Cross-cutting defaults, settings, APIs, migrations, and test gates. |

## Evidence Rules

- `1.md` can identify where to inspect after the source snapshot is imported.
- A ledger item still needs frozen source file hashes, functions/components, fixtures, and contract output.
- Target-only behavior remains unaccepted until compared against frozen source behavior or promoted to a dual-side H item.
