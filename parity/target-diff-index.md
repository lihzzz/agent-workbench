# Target Diff Index

This is a target-side routing index only. It does not prove parity, does not replace source evidence,
and cannot close any P item.

Source status: `source-pending`

## Ledger Counts

| Ledger ID | Candidate files |
|---|---:|
| P01 | 0 |
| P02 | 1 |
| P03 | 6 |
| P04 | 32 |
| P05 | 4 |
| P06 | 0 |
| P07 | 0 |
| P08 | 0 |
| P09 | 6 |
| P10 | 84 |

## Feature Tags

| Feature tag | Files |
|---|---:|
| app-shell | 12 |
| archive-preview | 3 |
| branch-context | 2 |
| codex-model-fallback | 6 |
| file-io | 1 |
| input-history | 3 |
| preload-ipc-contract | 4 |
| prompt-templates | 10 |
| session-export | 2 |
| session-persistence | 23 |
| settings-contract | 8 |
| skills | 2 |
| subagents | 8 |
| todo-checklist | 1 |
| tool-rendering | 4 |
| usage-dashboard | 7 |

## Entries

| Path | Status | Candidate ledger IDs | Feature tags |
|---|---|---|---|
| `electron-builder.config.js` | M | P10 | app-shell |
| `electron/src/ipc/claude-sessions.ts` | M | P04, P10 | session-persistence |
| `electron/src/ipc/files.ts` | M | P02 | file-io |
| `electron/src/ipc/prompt-templates.ts` | A | P10 | prompt-templates |
| `electron/src/ipc/sessions.ts` | M | P04, P10 | session-persistence |
| `electron/src/ipc/subagents.ts` | A | P10 | subagents |
| `electron/src/ipc/terminal.ts` | M | P04, P10 | session-persistence |
| `electron/src/lib/__tests__/claude-model-cache.test.ts` | A | P09, P10 | codex-model-fallback |
| `electron/src/lib/__tests__/prompt-template-registry.test.ts` | A | P10 | prompt-templates |
| `electron/src/lib/__tests__/subagent-registry.test.ts` | A | P10 | subagents |
| `electron/src/lib/claude-model-cache.ts` | M | P09, P10 | codex-model-fallback |
| `electron/src/lib/prompt-template-registry.ts` | A | P10 | prompt-templates |
| `electron/src/lib/subagent-registry.ts` | A | P10 | subagents |
| `electron/src/main.ts` | M | P10 | preload-ipc-contract |
| `electron/src/preload.ts` | M | P10 | preload-ipc-contract |
| `pnpm-lock.yaml` | M | P10 | app-shell |
| `shared/lib/session-persistence.ts` | M | P04, P10 | session-persistence |
| `shared/types/builtin-prompt-templates.ts` | A | P10 | prompt-templates |
| `shared/types/builtin-subagents.ts` | A | P10 | subagents |
| `shared/types/engine.ts` | M | P10 | preload-ipc-contract |
| `shared/types/prompt-template.ts` | A | P10 | prompt-templates |
| `shared/types/subagent.ts` | A | P10 | subagents |
| `src/components/AgentContext.tsx` | M | P10 | app-shell |
| `src/components/AppLayout.tsx` | M | P10 | app-shell |
| `src/components/AppSidebar.tsx` | M | P10 | app-shell |
| `src/components/MessageBubble.tsx` | M | P05, P10 | tool-rendering |
| `src/components/SettingsView.tsx` | M | P10 | settings-contract |
| `src/components/ToolCall.tsx` | M | P05, P10 | todo-checklist, tool-rendering |
| `src/components/input-bar/BranchIndicator.tsx` | A | P10 | branch-context |
| `src/components/input-bar/InputBar.tsx` | M | P03 | input-history |
| `src/components/input-bar/TemplateVarForm.tsx` | A | P10 | prompt-templates |
| `src/components/input-bar/input-bar-utils.ts` | M | P03 | input-history |
| `src/components/input-bar/useInputHistory.ts` | A | P03 | input-history |
| `src/components/settings/ArchivedSettings.tsx` | A | P03, P10 | archive-preview, settings-contract |
| `src/components/settings/CostDashboardSettings.tsx` | A | P04, P10 | settings-contract, usage-dashboard |
| `src/components/settings/MiniBarChart.tsx` | A | P04, P10 | settings-contract, usage-dashboard |
| `src/components/settings/PromptTemplateSettings.tsx` | A | P10 | prompt-templates, settings-contract |
| `src/components/settings/SkillsSettings.tsx` | A | P10 | settings-contract, skills |
| `src/components/settings/SubagentSettings.tsx` | A | P10 | settings-contract, subagents |
| `src/components/sidebar/BranchSection.tsx` | M | P10 | branch-context |
| `src/components/sidebar/FolderSection.tsx` | M | P10 | app-shell |
| `src/components/sidebar/PinnedSection.tsx` | M | P10 | app-shell |
| `src/components/sidebar/ProjectSection.tsx` | M | P10 | app-shell |
| `src/components/sidebar/SessionItem.tsx` | M | P03, P10 | archive-preview |
| `src/components/sidebar/SidebarActionsContext.tsx` | M | P10 | app-shell |
| `src/hooks/app-layout/useAppSessionActions.ts` | M | P04, P10 | session-persistence |
| `src/hooks/session/types.ts` | M | P04, P10 | session-persistence |
| `src/hooks/session/useSessionCrud.ts` | M | P04, P10 | session-persistence |
| `src/hooks/session/useSessionPane.ts` | M | P04, P10 | session-persistence |
| `src/hooks/session/useSessionPersistence.ts` | M | P04, P10 | session-persistence |
| `src/hooks/session/useSessionRestart.ts` | M | P04, P10 | session-persistence |
| `src/hooks/session/useSessionRevival.ts` | M | P04, P10 | session-persistence |
| `src/hooks/useACP.ts` | M | P04, P10 | session-persistence |
| `src/hooks/useAppOrchestrator.ts` | M | P04, P10 | session-persistence |
| `src/hooks/useClaude.ts` | M | P04, P10 | session-persistence |
| `src/hooks/useCodex.ts` | M | P04, P09, P10 | codex-model-fallback, session-persistence |
| `src/hooks/useEngineBase.ts` | M | P04, P10 | session-persistence |
| `src/hooks/useFolderManager.ts` | M | P10 | app-shell |
| `src/hooks/usePromptTemplates.ts` | A | P10 | prompt-templates |
| `src/hooks/useSessionManager.ts` | M | P04, P10 | session-persistence |
| `src/hooks/useSkills.ts` | A | P10 | skills |
| `src/hooks/useSubagents.ts` | A | P10 | subagents |
| `src/hooks/useUsageData.ts` | A | P04, P10 | usage-dashboard |
| `src/lib/background/claude-handler.ts` | M | P04, P10 | session-persistence |
| `src/lib/background/codex-web-search.test.ts` | M | P09, P10 | codex-model-fallback |
| `src/lib/background/context-usage.test.ts` | M | P04, P10 | session-persistence |
| `src/lib/background/session-store.ts` | M | P04, P10 | session-persistence |
| `src/lib/engine-colors.ts` | A | P10 | app-shell |
| `src/lib/engine/leaked-tool-parse.test.ts` | A | P05, P10 | tool-rendering |
| `src/lib/engine/leaked-tool-parse.ts` | A | P05, P10 | tool-rendering |
| `src/lib/model-utils.test.ts` | M | P09, P10 | codex-model-fallback |
| `src/lib/model-utils.ts` | M | P09, P10 | codex-model-fallback |
| `src/lib/prompt-template.test.ts` | A | P10 | prompt-templates |
| `src/lib/session/model-usage.test.ts` | A | P04, P10 | usage-dashboard |
| `src/lib/session/model-usage.ts` | A | P04, P10 | usage-dashboard |
| `src/lib/session/records.ts` | M | P04, P10 | session-persistence |
| `src/lib/session/session-export.test.ts` | A | P04, P10 | session-export |
| `src/lib/session/session-export.ts` | A | P04, P10 | session-export |
| `src/lib/session/usage-aggregation.test.ts` | A | P04, P10 | usage-dashboard |
| `src/lib/session/usage-aggregation.ts` | A | P04, P10 | usage-dashboard |
| `src/lib/sidebar/grouping.ts` | M | P03, P10 | archive-preview |
| `src/stores/settings-store.ts` | M | P10 | settings-contract |
| `src/types/engine-hook.ts` | M | P04, P10 | session-persistence |
| `src/types/index.ts` | M | P10 | app-shell |
| `src/types/prompt-template.ts` | A | P10 | prompt-templates |
| `src/types/session.ts` | M | P04, P10 | session-persistence |
| `src/types/subagent.ts` | A | P10 | subagents |
| `src/types/window.d.ts` | M | P10 | preload-ipc-contract |
