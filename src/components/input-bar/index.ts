export { InputBar } from "./InputBar";
export type { InputBarProps } from "./InputBar";

// Re-export slash command utilities for external consumers (tests, other components)
export {
  LOCAL_CLEAR_COMMAND,
  LOCAL_COMPACT_COMMAND,
  getAvailableSlashCommands,
  getCommandPrefix,
  getSlashCommandReplacement,
  isCompactCommandText,
  isClearCommandText,
} from "./input-bar-utils";
