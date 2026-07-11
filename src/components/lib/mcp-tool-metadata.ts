const MCP_RENDERER_TOOL_NAMES = new Set([
  "mcp__Atlassian__searchJiraIssuesUsingJql",
  "mcp__Atlassian__getJiraIssue",
  "mcp__Atlassian__getVisibleJiraProjects",
  "mcp__Atlassian__getTransitionsForJiraIssue",
  "mcp__Atlassian__searchConfluenceUsingCql",
  "mcp__Atlassian__getConfluenceSpaces",
  "mcp__Atlassian__getConfluencePageDescendants",
  "mcp__Atlassian__createConfluencePage",
  "mcp__Atlassian__updateConfluencePage",
  "mcp__Atlassian__getPagesInConfluenceSpace",
  "mcp__Atlassian__search",
  "mcp__Atlassian__fetch",
  "mcp__Atlassian__getAccessibleAtlassianResources",
  "mcp__claude_ai_Atlassian__getAccessibleAtlassianResources",
  "mcp__Context7__resolve-library-id",
  "mcp__Context7__query-docs",
]);

const MCP_RENDERER_PATTERNS = [
  /Atlassian[/_]+searchJiraIssuesUsingJql$/,
  /Atlassian[/_]+getJiraIssue$/,
  /Atlassian[/_]+getVisibleJiraProjects$/,
  /Atlassian[/_]+getTransitionsForJiraIssue$/,
  /Atlassian[/_]+searchConfluenceUsingCql$/,
  /Atlassian[/_]+getConfluenceSpaces$/,
  /Atlassian[/_]+getConfluencePageDescendants$/,
  /Atlassian[/_]+createConfluencePage$/,
  /Atlassian[/_]+updateConfluencePage$/,
  /Atlassian[/_]+getPagesInConfluenceSpace$/,
  /Atlassian[/_]+search$/,
  /Atlassian[/_]+fetch$/,
  /Atlassian[/_]+getAccessibleAtlassianResources$/,
  /Context7[/_]+resolve-library-id$/,
  /Context7[/_]+query-docs$/,
];

export function hasMcpRenderer(toolName: string): boolean {
  return MCP_RENDERER_TOOL_NAMES.has(toolName) || MCP_RENDERER_PATTERNS.some((pattern) => pattern.test(toolName));
}

/** Extract a compact summary for the collapsed tool line. */
export function getMcpCompactSummary(toolName: string, toolInput: Record<string, unknown>): string {
  if (/searchJiraIssuesUsingJql/.test(toolName)) {
    return String(toolInput.jql ?? "").slice(0, 80);
  }
  if (/getJiraIssue/.test(toolName)) {
    return String(toolInput.issueIdOrKey ?? "");
  }
  if (/getVisibleJiraProjects/.test(toolName)) {
    return toolInput.searchString ? `"${toolInput.searchString}"` : "all projects";
  }
  if (/searchConfluenceUsingCql/.test(toolName)) {
    return String(toolInput.cql ?? "").slice(0, 80);
  }
  if (/getConfluencePageDescendants/.test(toolName)) {
    return `page ${toolInput.pageId ?? ""}`;
  }
  if (/createConfluencePage/.test(toolName)) {
    return String(toolInput.title ?? "").slice(0, 80);
  }
  if (/updateConfluencePage/.test(toolName)) {
    return toolInput.versionMessage
      ? String(toolInput.versionMessage).slice(0, 80)
      : `page ${toolInput.pageId ?? ""}`;
  }
  if (/getPagesInConfluenceSpace/.test(toolName)) {
    return toolInput.title ? `"${toolInput.title}"` : `space ${toolInput.spaceId ?? ""}`;
  }
  if (/Atlassian[/_]+search$/.test(toolName)) {
    return String(toolInput.query ?? "").slice(0, 80);
  }
  if (/Atlassian[/_]+fetch$/.test(toolName)) {
    const id = String(toolInput.id ?? "");
    const match = id.match(/(issue|page)\/(\d+)/);
    return match ? `${match[1]}/${match[2]}` : id.slice(0, 60);
  }
  if (/resolve-library-id$/.test(toolName)) {
    return String(toolInput.libraryName ?? toolInput.query ?? "").slice(0, 60);
  }
  if (/query-docs$/.test(toolName)) {
    return String(toolInput.query ?? "").slice(0, 60);
  }
  return "";
}
