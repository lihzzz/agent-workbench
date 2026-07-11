import { lazy, Suspense, type ReactNode } from "react";
import type { UIMessage } from "@/types";
import { hasMcpRenderer } from "../lib/mcp-tool-metadata";

const BashContent = lazy(() => import("./BashContent").then((mod) => ({ default: mod.BashContent })));
const WriteContent = lazy(() => import("./WriteContent").then((mod) => ({ default: mod.WriteContent })));
const EditContent = lazy(() => import("./EditContent").then((mod) => ({ default: mod.EditContent })));
const ReadContent = lazy(() => import("./ReadContent").then((mod) => ({ default: mod.ReadContent })));
const SearchContent = lazy(() => import("./SearchContent").then((mod) => ({ default: mod.SearchContent })));
const WebSearchContent = lazy(() => import("./WebSearchContent").then((mod) => ({ default: mod.WebSearchContent })));
const WebFetchContent = lazy(() => import("./WebFetchContent").then((mod) => ({ default: mod.WebFetchContent })));
const TodoWriteContent = lazy(() => import("./TodoWriteContent").then((mod) => ({ default: mod.TodoWriteContent })));
const EnterPlanModeContent = lazy(() => import("./PlanContent").then((mod) => ({ default: mod.EnterPlanModeContent })));
const ExitPlanModeContent = lazy(() => import("./PlanContent").then((mod) => ({ default: mod.ExitPlanModeContent })));
const AskUserQuestionContent = lazy(() => import("./AskUserQuestion").then((mod) => ({ default: mod.AskUserQuestionContent })));
const GenericContent = lazy(() => import("./GenericContent").then((mod) => ({ default: mod.GenericContent })));
const ToolSearchContent = lazy(() => import("./ToolSearchContent").then((mod) => ({ default: mod.ToolSearchContent })));
const SkillContent = lazy(() => import("./SkillContent").then((mod) => ({ default: mod.SkillContent })));
const McpToolContent = lazy(() => import("../McpToolContent").then((mod) => ({ default: mod.McpToolContent })));

function ExpandedToolFallback() {
  return <div className="h-6 w-full" />;
}

function withSuspense(node: ReactNode) {
  return <Suspense fallback={<ExpandedToolFallback />}>{node}</Suspense>;
}

/** Routes a UIMessage to its tool-specific expanded renderer. */
export function ExpandedToolContent({ message }: { message: UIMessage }) {
  switch (message.toolName) {
    case "Bash":
      return withSuspense(<BashContent message={message} />);
    case "Write":
      return withSuspense(<WriteContent message={message} />);
    case "Edit":
      return withSuspense(<EditContent message={message} />);
    case "Read":
      return withSuspense(<ReadContent message={message} />);
    case "Grep":
    case "Glob":
      return withSuspense(<SearchContent message={message} />);
    case "TodoWrite":
      return withSuspense(<TodoWriteContent message={message} />);
    case "EnterPlanMode":
      return withSuspense(<EnterPlanModeContent message={message} />);
    case "ExitPlanMode":
      return withSuspense(<ExitPlanModeContent message={message} />);
    case "WebSearch":
      return withSuspense(<WebSearchContent message={message} />);
    case "WebFetch":
      return withSuspense(<WebFetchContent message={message} />);
    case "AskUserQuestion":
      return withSuspense(<AskUserQuestionContent message={message} />);
    case "ToolSearch":
      return withSuspense(<ToolSearchContent message={message} />);
    case "Skill":
      return withSuspense(<SkillContent message={message} />);
    default:
      // Check for specialized MCP tool renderers
      if (message.toolName && hasMcpRenderer(message.toolName)) {
        return withSuspense(<McpToolContent message={message} />);
      }
      return withSuspense(<GenericContent message={message} />);
  }
}
