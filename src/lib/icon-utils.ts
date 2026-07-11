import type { LucideIcon } from "lucide-react";
import {
  Book,
  Bot,
  Box,
  Briefcase,
  Camera,
  Circle,
  Cloud,
  Code,
  Coffee,
  Compass,
  Cpu,
  Crown,
  Database,
  Feather,
  FileText,
  Flag,
  Flame,
  FolderOpen,
  FolderTree,
  Gem,
  Gift,
  GitBranch,
  Globe,
  Heart,
  Home,
  Key,
  Lamp,
  Layers,
  Map as MapIcon,
  Music,
  Palette,
  PenTool,
  Puzzle,
  Rocket,
  Scissors,
  Settings,
  Shield,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Star,
  Sun,
  Target,
  Terminal,
  Umbrella,
  Wand,
  Wrench,
  Zap,
} from "lucide-react";

const COMMON_LUCIDE_ICONS: Record<string, LucideIcon> = {
  book: Book,
  bot: Bot,
  box: Box,
  briefcase: Briefcase,
  camera: Camera,
  circle: Circle,
  cloud: Cloud,
  code: Code,
  coffee: Coffee,
  compass: Compass,
  cpu: Cpu,
  crown: Crown,
  database: Database,
  feather: Feather,
  "file-text": FileText,
  flag: Flag,
  flame: Flame,
  "folder-open": FolderOpen,
  "folder-tree": FolderTree,
  gem: Gem,
  gift: Gift,
  "git-branch": GitBranch,
  globe: Globe,
  heart: Heart,
  home: Home,
  key: Key,
  lamp: Lamp,
  layers: Layers,
  map: MapIcon,
  music: Music,
  palette: Palette,
  "pen-tool": PenTool,
  puzzle: Puzzle,
  rocket: Rocket,
  scissors: Scissors,
  settings: Settings,
  shield: Shield,
  "shield-check": ShieldCheck,
  "shield-off": ShieldOff,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  target: Target,
  terminal: Terminal,
  umbrella: Umbrella,
  wand: Wand,
  wrench: Wrench,
  zap: Zap,
};

const asyncIconCache = new Map<string, Promise<LucideIcon | null>>();

function pascalToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function kebabToPascal(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function normalizeKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return pascalToKebab(trimmed);
}

export function resolveCommonLucideIcon(name: string | null | undefined): LucideIcon | null {
  const key = normalizeKey(name);
  return key ? COMMON_LUCIDE_ICONS[key] ?? null : null;
}

export function loadLucideIcon(name: string | null | undefined): Promise<LucideIcon | null> {
  const key = normalizeKey(name);
  if (!key) return Promise.resolve(null);

  const common = COMMON_LUCIDE_ICONS[key];
  if (common) return Promise.resolve(common);

  const cached = asyncIconCache.get(key);
  if (cached) return cached;

  const promise = import("lucide-react").then((mod) => {
    const icons = (mod as typeof mod & { icons?: Record<string, LucideIcon> }).icons;
    const original = name?.trim() ?? "";
    return icons?.[original] ?? icons?.[kebabToPascal(key)] ?? null;
  });
  asyncIconCache.set(key, promise);
  return promise;
}
