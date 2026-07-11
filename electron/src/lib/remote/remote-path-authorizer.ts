import path from "path";
import fs from "fs";
import { getDataDir } from "../data-dir";
import type { RemotePathRef } from "@shared/types/remote";

interface StoredProject {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  spaceId?: string;
}

export interface AuthorizedRemotePath {
  project: StoredProject;
  repoRoot: string;
  resolvedPath: string;
  relativePath: string;
}

function projectsFilePath(): string {
  return path.join(getDataDir(), "projects.json");
}

function readProjects(): StoredProject[] {
  try {
    const raw = fs.readFileSync(projectsFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is StoredProject => (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as StoredProject).id === "string" &&
      typeof (entry as StoredProject).path === "string" &&
      typeof (entry as StoredProject).name === "string"
    ));
  } catch {
    return [];
  }
}

function realpathIfExists(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function assertRelativeSegment(value: string, field: string): void {
  if (!value || path.isAbsolute(value)) {
    throw new Error(`${field} must be a relative path segment`);
  }
  const normalized = path.normalize(value);
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`${field} escapes the project root`);
  }
}

function assertContained(root: string, candidate: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "") return;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside the authorized root`);
  }
}

function selectRepoRoot(projectRoot: string, ref: RemotePathRef): string {
  const repoRef = ref.worktreeId ?? ref.repoId;
  if (!repoRef) return projectRoot;
  assertRelativeSegment(repoRef, ref.worktreeId ? "worktreeId" : "repoId");
  return realpathIfExists(path.join(projectRoot, repoRef));
}

export class RemotePathAuthorizer {
  authorize(ref: RemotePathRef): AuthorizedRemotePath {
    if (!ref || typeof ref.projectId !== "string") {
      throw new Error("projectId is required");
    }

    const project = readProjects().find((entry) => entry.id === ref.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const projectRoot = realpathIfExists(project.path);
    const repoRoot = selectRepoRoot(projectRoot, ref);
    assertContained(projectRoot, repoRoot, "Repository");

    const relativePath = ref.relativePath?.trim() || ".";
    if (relativePath !== ".") {
      assertRelativeSegment(relativePath, "relativePath");
    }

    const resolvedPath = realpathIfExists(path.join(repoRoot, relativePath));
    assertContained(repoRoot, resolvedPath, "Path");

    return {
      project,
      repoRoot,
      resolvedPath,
      relativePath: relativePath === "." ? "" : path.relative(repoRoot, resolvedPath),
    };
  }
}
