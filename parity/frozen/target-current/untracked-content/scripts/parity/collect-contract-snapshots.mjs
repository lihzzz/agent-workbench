import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const PRELOAD_FILE = "electron/src/preload.ts";
const PACKAGE_FILE = "package.json";
const BUILD_CONFIG_FILES = [
  "electron-builder.config.js",
  "vite.config.ts",
  "tsup.config.ts",
  "tsup.electron.config.ts",
];
const DEFAULT_SURFACE_FILES = [
  "electron/src/lib/agent-registry.ts",
  "shared/types/engine.ts",
  "src/lib/engine-icons.ts",
  "src/lib/engine-colors.ts",
  "src/components/AppSidebar.tsx",
  "src/components/SettingsView.tsx",
  "src/components/FilePreviewOverlay.tsx",
  "src/components/TodoPanel.tsx",
  "src/components/input-bar/EnginePickerDropdown.tsx",
  "src/components/input-bar/InputBar.tsx",
  "src/components/sidebar/SessionItem.tsx",
  "src/components/split/SplitPaneHost.tsx",
  "src/components/settings/ArchivedSettings.tsx",
];
const DEFAULT_SURFACE_KEYWORDS = [
  "ACP",
  "Archived",
  "Archive",
  "Checklist",
  "Claude",
  "Code Review",
  "Codex",
  "Engine",
  "File Preview",
  "History",
  "Implement",
  "OpenCode",
  "Plan",
  "Relay",
  "Review",
  "Settings",
  "Split",
  "Todo",
];
const DEFAULT_SURFACE_JSX_ATTRIBUTES = new Set([
  "aria-label",
  "alt",
  "placeholder",
  "title",
  "value",
]);

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    target: "target",
    outputDir: null,
  };
  let positionalTargetSeen = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--workspace") {
      args.workspace = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--target") {
      args.target = readArgValue(argv, ++index, arg);
      continue;
    }

    if (arg === "--output-dir") {
      args.outputDir = readArgValue(argv, ++index, arg);
      continue;
    }

    if (!arg.startsWith("--") && !positionalTargetSeen) {
      args.target = arg;
      positionalTargetSeen = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function readArgValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function getRepoRoot(workspace) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getOutputBaseRepoRoot() {
  try {
    return getRepoRoot(process.cwd());
  } catch {
    return process.cwd();
  }
}

function resolveOutputDir(outputDir, target, outputBaseRepoRoot) {
  if (outputDir) {
    return path.resolve(outputDir);
  }

  return path.join(outputBaseRepoRoot, "parity", "snapshots", target);
}

function listTsFiles(repoRoot, relativeDir) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => path.posix.join(relativeDir, name));
}

function buildMainFiles(repoRoot) {
  return [
    "electron/src/main.ts",
    ...listTsFiles(repoRoot, "electron/src/ipc"),
    "electron/src/lib/updater.ts",
    "electron/src/lib/prerelease-check.ts",
  ];
}

function buildSharedTypeFiles(repoRoot) {
  return [
    ...listTsFiles(repoRoot, "shared/types"),
    "shared/lib/session-persistence.ts",
    "src/types/session.ts",
    "src/types/window.d.ts",
  ];
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(getRepoRoot(path.resolve(args.workspace)));
const outputBaseRepoRoot = getOutputBaseRepoRoot();
const outputDir = resolveOutputDir(args.outputDir, args.target, outputBaseRepoRoot);
const mainFiles = buildMainFiles(repoRoot);
const sharedTypeFiles = buildSharedTypeFiles(repoRoot);

function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readSource(relativePath));
}

function parseSource(relativePath) {
  const sourceText = readSource(relativePath);
  return ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, getScriptKind(relativePath));
}

function getScriptKind(relativePath) {
  if (relativePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (relativePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (relativePath.endsWith(".js")) return ts.ScriptKind.JS;
  if (relativePath.endsWith(".json")) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

function getText(sourceFile, node) {
  return node.getText(sourceFile).replace(/\s+/g, " ").trim();
}

function getPropertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return name.getText();
}

function getStringLiteralText(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function isPropertyAccessNamed(expression, objectName, methodName) {
  return ts.isPropertyAccessExpression(expression)
    && expression.name.text === methodName
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === objectName;
}

function collectIpcRendererCalls(sourceFile, node, apiPath, calls) {
  function visit(current) {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      const method = current.expression.name.text;
      const target = current.expression.expression;
      if (ts.isIdentifier(target) && target.text === "ipcRenderer") {
        const channel = getStringLiteralText(current.arguments[0]);
        if (channel) {
          calls.push({
            apiPath,
            method,
            channel,
          });
        }
      }
    }
    ts.forEachChild(current, visit);
  }

  visit(node);
}

function collectApiPaths(sourceFile, objectNode, prefix, apiPaths, ipcCalls) {
  for (const property of objectNode.properties) {
    if (ts.isPropertyAssignment(property)) {
      const name = getPropertyNameText(property.name);
      const apiPath = [...prefix, name].join(".");
      if (ts.isObjectLiteralExpression(property.initializer)) {
        collectApiPaths(sourceFile, property.initializer, [...prefix, name], apiPaths, ipcCalls);
      } else {
        apiPaths.push({
          path: apiPath,
          kind: ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer)
            ? "function"
            : "value",
        });
        collectIpcRendererCalls(sourceFile, property.initializer, apiPath, ipcCalls);
      }
      continue;
    }

    if (ts.isMethodDeclaration(property)) {
      const apiPath = [...prefix, getPropertyNameText(property.name)].join(".");
      apiPaths.push({
        path: apiPath,
        kind: "function",
      });
      collectIpcRendererCalls(sourceFile, property, apiPath, ipcCalls);
    }
  }
}

function collectPreloadApi() {
  const sourceFile = parseSource(PRELOAD_FILE);
  const apiPaths = [];
  const apiIpcCalls = [];
  const allIpcCalls = [];

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(sourceFile) === "contextBridge"
      && node.expression.name.text === "exposeInMainWorld"
    ) {
      const rootName = getStringLiteralText(node.arguments[0]);
      const exposedObject = node.arguments[1];
      if (rootName && exposedObject && ts.isObjectLiteralExpression(exposedObject)) {
        collectApiPaths(sourceFile, exposedObject, [rootName], apiPaths, apiIpcCalls);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  collectIpcRendererCalls(sourceFile, sourceFile, null, allIpcCalls);

  const uniqueApiIpcCalls = dedupeObjects(apiIpcCalls, (item) =>
    [item.apiPath ?? "", item.method, item.channel].join("\u0000"),
  );
  const uniqueRendererChannels = dedupeObjects(allIpcCalls, (item) =>
    [item.method, item.channel].join("\u0000"),
  );

  return {
    apiPaths: apiPaths.sort(comparePath),
    apiIpcCalls: uniqueApiIpcCalls.sort(compareChannelThenPath),
    ipcRendererChannels: uniqueRendererChannels
      .map(({ method, channel }) => ({ method, channel }))
      .sort(compareChannelThenMethod),
  };
}

function collectMainIpcChannels() {
  const channels = [];
  const emittedEvents = [];
  const registeredModules = [];

  for (const file of mainFiles) {
    if (!existsSync(path.join(repoRoot, file))) {
      continue;
    }

    const sourceFile = parseSource(file);

    function visit(node) {
      if (ts.isCallExpression(node)) {
        if (isPropertyAccessNamed(node.expression, "ipcMain", "handle") || isPropertyAccessNamed(node.expression, "ipcMain", "on")) {
          const channel = getStringLiteralText(node.arguments[0]);
          if (channel) {
            channels.push({
              channel,
              direction: "renderer-to-main",
              method: node.expression.name.text,
            });
          }
        }

        if (file === "electron/src/main.ts" && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "register") {
          const expression = getText(sourceFile, node.expression.expression);
          if (expression.endsWith("Ipc")) {
            registeredModules.push(expression);
          }
        }

        if (ts.isIdentifier(node.expression) && node.expression.text === "safeSend") {
          const channel = getStringLiteralText(node.arguments[1]);
          if (channel) {
            emittedEvents.push({
              channel,
              direction: "main-to-renderer",
              method: "safeSend",
            });
          }
        }

        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "send") {
          const targetText = getText(sourceFile, node.expression.expression);
          const channel = getStringLiteralText(node.arguments[0]);
          if (channel && targetText.includes("webContents")) {
            emittedEvents.push({
              channel,
              direction: "main-to-renderer",
              method: "webContents.send",
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return {
    registeredModules: [...new Set(registeredModules)].sort(),
    ipcMainChannels: dedupeObjects(channels, channelKey).sort(compareChannelThenMethod),
    emittedEvents: dedupeObjects(emittedEvents, channelKey).sort(compareChannelThenMethod),
  };
}

function literalToValue(sourceFile, node, constants) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isIdentifier(node) && constants.has(node.text)) return constants.get(node.text);
  if (ts.isObjectLiteralExpression(node)) {
    const output = {};
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        output[getPropertyNameText(property.name)] = literalToValue(sourceFile, property.initializer, constants);
      }
    }
    return sortObject(output);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => literalToValue(sourceFile, element, constants));
  }
  return { expression: getText(sourceFile, node) };
}

function collectSettingsDefaults() {
  const file = "electron/src/lib/app-settings.ts";
  const sourceFile = parseSource(file);
  const constants = new Map();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (ts.isObjectLiteralExpression(declaration.initializer)) {
        constants.set(declaration.name.text, literalToValue(sourceFile, declaration.initializer, constants));
      }
    }
  }

  return {
    notificationDefaults: constants.get("NOTIFICATION_DEFAULTS") ?? null,
    appSettingsDefaults: constants.get("DEFAULTS") ?? null,
  };
}

function collectSharedTypeSnapshot() {
  const files = sharedTypeFiles.filter((file) => existsSync(path.join(repoRoot, file)));
  const declarations = [];

  for (const file of files) {
    const sourceFile = parseSource(file);

    function visit(node) {
      if (ts.isInterfaceDeclaration(node)) {
        declarations.push({
          file,
          kind: "interface",
          name: node.name.text,
          heritage: node.heritageClauses?.map((clause) => getText(sourceFile, clause)) ?? [],
          properties: node.members
            .filter(ts.isPropertySignature)
            .map((member) => ({
              name: getPropertyNameText(member.name),
              optional: !!member.questionToken,
              type: member.type ? getText(sourceFile, member.type) : "unknown",
            })),
        });
      }

      if (ts.isTypeAliasDeclaration(node)) {
        declarations.push({
          file,
          kind: "type",
          name: node.name.text,
          type: getText(sourceFile, node.type),
        });
      }

      if (isExportedVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            declarations.push({
              file,
              kind: "const",
              name: declaration.name.text,
              type: declaration.type ? getText(sourceFile, declaration.type) : null,
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return {
    declarations: declarations.sort(compareDeclaration),
  };
}

function collectSessionSerializationSnapshot(sharedTypesSnapshot) {
  const sessionFiles = new Set([
    "shared/lib/session-persistence.ts",
    "src/types/session.ts",
  ]);
  const declarations = sharedTypesSnapshot.declarations.filter((declaration) => sessionFiles.has(declaration.file));

  return {
    declarations,
  };
}

function collectPackageDependenciesSnapshot() {
  if (!existsSync(path.join(repoRoot, PACKAGE_FILE))) {
    return {
      exists: false,
    };
  }

  const packageJson = readJson(PACKAGE_FILE);
  return {
    exists: true,
    name: packageJson.name ?? null,
    version: packageJson.version ?? null,
    packageManager: packageJson.packageManager ?? null,
    main: packageJson.main ?? null,
    type: packageJson.type ?? null,
    engines: sortObject(packageJson.engines ?? {}),
    dependencies: sortObject(packageJson.dependencies ?? {}),
    devDependencies: sortObject(packageJson.devDependencies ?? {}),
    optionalDependencies: sortObject(packageJson.optionalDependencies ?? {}),
    peerDependencies: sortObject(packageJson.peerDependencies ?? {}),
    pnpm: sortObject(packageJson.pnpm ?? {}),
  };
}

function collectBuildConfigSnapshot() {
  return {
    files: BUILD_CONFIG_FILES.map((file) => {
      if (!existsSync(path.join(repoRoot, file))) {
        return {
          file,
          exists: false,
        };
      }

      const sourceFile = parseSource(file);
      const exportedConfig = collectExportedConfig(sourceFile);
      return {
        file,
        exists: true,
        exportedConfig,
      };
    }),
  };
}

function collectExportedConfig(sourceFile) {
  const configs = [];

  function visit(node) {
    if (ts.isExportAssignment(node)) {
      configs.push({
        kind: "export-default",
        value: extractConfigValue(sourceFile, node.expression),
      });
    }

    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.left.getText(sourceFile) === "module.exports"
    ) {
      configs.push({
        kind: "module-exports",
        value: extractConfigValue(sourceFile, node.right),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return configs;
}

function extractConfigValue(sourceFile, node) {
  if (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && ["defineConfig", "defineTsupConfig"].includes(node.expression.text)
    && node.arguments[0]
  ) {
    return literalToValue(sourceFile, node.arguments[0], new Map());
  }

  return literalToValue(sourceFile, node, new Map());
}

function collectDefaultSurfaceSnapshot() {
  const files = DEFAULT_SURFACE_FILES.map(collectDefaultSurfaceFile);
  return {
    builtInAgents: collectNamedObjectLiterals("electron/src/lib/agent-registry.ts", /^BUILTIN_/),
    engineIcons: collectNamedObjectLiterals("src/lib/engine-icons.ts", /^ENGINE_ICONS$/),
    engineAccents: collectNamedObjectLiterals("src/lib/engine-colors.ts", /^ACCENTS$/),
    files,
  };
}

function collectDefaultSurfaceFile(file) {
  const absolutePath = path.join(repoRoot, file);
  if (!existsSync(absolutePath)) {
    return {
      file,
      exists: false,
    };
  }

  const sourceFile = parseSource(file);
  const imports = [];
  const exports = [];
  const jsxStrings = [];
  const keywordStrings = [];

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const moduleName = getStringLiteralText(node.moduleSpecifier);
      if (moduleName) imports.push(moduleName);
    }

    if (isExportedDeclaration(node)) {
      const name = getDeclarationName(node);
      if (name) {
        exports.push({
          name,
          kind: declarationKind(node),
        });
      }
    }

    if (isExportedVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.push({
            name: declaration.name.text,
            kind: "const",
          });
        }
      }
    }

    if (ts.isJsxAttribute(node) && DEFAULT_SURFACE_JSX_ATTRIBUTES.has(node.name.text)) {
      const value = getJsxAttributeValueText(node.initializer);
      if (value) {
        jsxStrings.push({
          attribute: node.name.text,
          value,
        });
      }
    }

    if (ts.isJsxText(node)) {
      const value = normalizeInlineText(node.getText(sourceFile));
      if (value) {
        jsxStrings.push({
          attribute: "jsxText",
          value,
        });
      }
    }

    if (ts.isStringLiteralLike(node)) {
      const value = normalizeInlineText(node.text);
      if (value && DEFAULT_SURFACE_KEYWORDS.some((keyword) => value.includes(keyword))) {
        keywordStrings.push(value);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return {
    file,
    exists: true,
    imports: [...new Set(imports)].sort(),
    exports: dedupeObjects(exports, (item) => `${item.kind}:${item.name}`).sort(compareKindThenName),
    jsxStrings: dedupeObjects(jsxStrings, (item) => `${item.attribute}:${item.value}`).sort(compareAttributeThenValue),
    keywordStrings: [...new Set(keywordStrings)].sort(),
  };
}

function collectNamedObjectLiterals(file, namePattern) {
  const absolutePath = path.join(repoRoot, file);
  if (!existsSync(absolutePath)) {
    return [];
  }

  const sourceFile = parseSource(file);
  const constants = [];

  function visit(node) {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) {
      ts.forEachChild(node, visit);
      return;
    }

    if (namePattern.test(node.name.text) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      constants.push({
        file,
        name: node.name.text,
        value: literalToValue(sourceFile, node.initializer, new Map()),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return constants.sort(compareName);
}

function isExportedVariableStatement(node) {
  return ts.isVariableStatement(node)
    && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function isExportedDeclaration(node) {
  return (
    ts.isFunctionDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
  ) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function getDeclarationName(node) {
  return node.name && ts.isIdentifier(node.name) ? node.name.text : null;
}

function declarationKind(node) {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  return "unknown";
}

function getJsxAttributeValueText(initializer) {
  if (!initializer) {
    return "true";
  }

  if (ts.isStringLiteral(initializer)) {
    return normalizeInlineText(initializer.text);
  }

  if (ts.isJsxExpression(initializer) && initializer.expression && ts.isStringLiteralLike(initializer.expression)) {
    return normalizeInlineText(initializer.expression.text);
  }

  return null;
}

function normalizeInlineText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function dedupeObjects(items, getKey) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function channelKey(item) {
  return [item.channel, item.direction, item.method].join("\u0000");
}

function comparePath(a, b) {
  return a.path.localeCompare(b.path);
}

function compareChannelThenPath(a, b) {
  return a.channel.localeCompare(b.channel)
    || String(a.apiPath ?? "").localeCompare(String(b.apiPath ?? ""))
    || a.method.localeCompare(b.method);
}

function compareChannelThenMethod(a, b) {
  return a.channel.localeCompare(b.channel)
    || a.method.localeCompare(b.method)
    || String(a.apiPath ?? "").localeCompare(String(b.apiPath ?? ""));
}

function compareDeclaration(a, b) {
  return a.file.localeCompare(b.file)
    || a.name.localeCompare(b.name)
    || a.kind.localeCompare(b.kind);
}

function compareKindThenName(a, b) {
  return a.kind.localeCompare(b.kind)
    || a.name.localeCompare(b.name);
}

function compareAttributeThenValue(a, b) {
  return a.attribute.localeCompare(b.attribute)
    || a.value.localeCompare(b.value);
}

function compareName(a, b) {
  return a.name.localeCompare(b.name);
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const preloadApi = collectPreloadApi();
const ipcChannels = collectMainIpcChannels();
const settingsDefaults = collectSettingsDefaults();
const sharedTypes = collectSharedTypeSnapshot();
const sessionSerialization = collectSessionSerializationSnapshot(sharedTypes);
const packageDependencies = collectPackageDependenciesSnapshot();
const buildConfig = collectBuildConfigSnapshot();
const defaultSurface = collectDefaultSurfaceSnapshot();

writeJson(path.join(outputDir, "preload-api.json"), preloadApi);
writeJson(path.join(outputDir, "ipc-channels.json"), ipcChannels);
writeJson(path.join(outputDir, "settings-defaults.json"), settingsDefaults);
writeJson(path.join(outputDir, "shared-types.json"), sharedTypes);
writeJson(path.join(outputDir, "session-serialization.json"), sessionSerialization);
writeJson(path.join(outputDir, "package-dependencies.json"), packageDependencies);
writeJson(path.join(outputDir, "build-config.json"), buildConfig);
writeJson(path.join(outputDir, "default-surface.json"), defaultSurface);

console.log(`Wrote ${args.target} contract snapshots from ${repoRoot} to ${outputDir}`);
