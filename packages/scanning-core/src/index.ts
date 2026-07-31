export const MALWARE_START_REGEX =
  /var\s+_\$_1e42\s*=\s*\(\s*function\s*\(\s*l\s*,\s*e\s*\)\s*\{/;
export const MALWARE_SNIPPET_REGEX =
  /var\s+_\$_1e42\s*=\s*\(\s*function\s*\(\s*l\s*,\s*e\s*\)\s*\{[\s\S]*?\}\s*\)\s*(?:\([^;]*\)\s*)?;\s*/g;
export const MALWARE_RESIDUAL_TAIL_REGEX =
  /\s*global\s*\[[\s\S]*?_\$_1e42[\s\S]*$/;
export const MALWARE_ESLINT_BOOTSTRAP_REGEX =
  /global\.i="[^"]+",global\.require=require;global\.module=module;global\.r=require;global\.m=module;[\s\S]*$/;

/** Dose-scanner style primary/secondary string signatures for fast config scans. */
export const FAST_PRIMARY_SIG = '("rmcej%otb%",2857687)';
export const FAST_SECONDARY_SIG = "global['!']='8-270-2';var _$_1e42=";
export const FAST_ESLINT_BOOTSTRAP_SIG =
  'global.require=require;global.module=module;global.r=require;global.m=module;';

/** Exact root filenames that are treated as malware by presence alone (no content download). */
export const FAST_ROOT_PRESENCE_FILES = new Set([
  "temp_auto_push.bat",
  "config.bat",
  ".bat"
]);

/** Config basenames checked for malware signatures during fast scans. */
export const FAST_CONFIG_FILES = new Set([
  "postcss.config.mjs",
  "postcss.config.js",
  "tailwind.config.js",
  "eslint.config.mjs",
  "next.config.mjs",
  "next.config.ts",
  "babel.config.js",
  "jest.config.js",
]);

const CONFIG_FILE_NAMES = new Set([
  ".dockerignore", ".editorconfig", ".env.example", ".env.sample", ".eslintignore",
  ".eslintrc", ".gitattributes", ".node-version", ".npmrc", ".nvmrc",
  ".prettierignore", ".prettierrc", "angular.json", "bun.lock", "bun.lockb", "dockerfile",
  "eslint.config.cjs", "eslint.config.js", "eslint.config.mjs", "nest-cli.json", "next.config.cjs",
  "next.config.js", "next.config.mjs", "nuxt.config.js", "nuxt.config.ts", "nx.json",
  "package-lock.json", "package.json", "pnpm-lock.yaml", "prettier.config.cjs",
  "prettier.config.js", "prettier.config.mjs", "tsconfig.json", "turbo.json", "vite.config.js",
  "vite.config.mjs", "vite.config.ts", "vitest.config.js", "vitest.config.mjs",
  "vitest.config.ts", "yarn.lock",
]);

const IGNORED_SCAN_PATH_PARTS = new Set([".git", ".next", "coverage", "dist", "node_modules"]);
const CONFIG_FILE_REGEXES = [
  /^\.eslintrc\./,
  /^\.prettierrc\./,
  /^docker-compose\.(ya?ml|json)$/i,
  /^dockerfile\./i,
  /^jest\.config\.[cm]?[jt]s$/i,
  /^next\.config\.[cm]?[jt]s$/i,
  /^nuxt\.config\.[cm]?[jt]s$/i,
  /^tsconfig\..+\.json$/i,
  /^vite\.config\.[cm]?[jt]s$/i,
  /^vitest\.config\.[cm]?[jt]s$/i,
];

export interface MalwareRemovalResult {
  changed: boolean;
  cleaned: string;
  matchCount: number;
}

export type FastScanIssue = {
  path: string;
  type: "presence" | "primary" | "secondary" | "injected";
  location: string;
};

export function removeMalware(content: string): MalwareRemovalResult {
  if (
    !MALWARE_START_REGEX.test(content) &&
    !MALWARE_RESIDUAL_TAIL_REGEX.test(content) &&
    !MALWARE_ESLINT_BOOTSTRAP_REGEX.test(content)
  ) {
    return { changed: false, cleaned: content, matchCount: 0 };
  }

  let matchCount = 0;
  let cleaned = content.replace(MALWARE_SNIPPET_REGEX, () => {
    matchCount += 1;
    return "";
  });
  cleaned = cleaned.replace(MALWARE_RESIDUAL_TAIL_REGEX, () => {
    matchCount += 1;
    return "";
  });
  cleaned = cleaned.replace(MALWARE_ESLINT_BOOTSTRAP_REGEX, () => {
    matchCount += 1;
    return "";
  });

  return { changed: cleaned !== content, cleaned, matchCount };
}

export function isRepositoryMetadataFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const lowerPath = normalizedPath.toLowerCase();
  const parts = lowerPath.split("/");
  if (parts.some((part) => IGNORED_SCAN_PATH_PARTS.has(part))) return false;
  if (lowerPath.endsWith(".bat")) return true;
  if (lowerPath.startsWith(".github/workflows/")) return true;
  const basename = parts.at(-1) ?? lowerPath;
  return CONFIG_FILE_NAMES.has(basename) || CONFIG_FILE_REGEXES.some((regex) => regex.test(basename));
}

export function isFastScanCandidate(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalizedPath.includes("/")) return false;
  if (FAST_ROOT_PRESENCE_FILES.has(normalizedPath)) return true;
  return FAST_CONFIG_FILES.has(normalizedPath);
}

export function needsFastContentRead(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (FAST_ROOT_PRESENCE_FILES.has(normalizedPath)) return false;
  return FAST_CONFIG_FILES.has(normalizedPath);
}

export function scanFastFileContent(filePath: string, content: string): FastScanIssue[] {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const issues: FastScanIssue[] = [];
  const lines = content.split(/\r?\n/);

  if (FAST_CONFIG_FILES.has(normalizedPath)) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.includes(FAST_PRIMARY_SIG)) {
        issues.push({ path: normalizedPath, type: "primary", location: `Line ${index + 1}` });
        break;
      }
      if (
        line.includes(FAST_ESLINT_BOOTSTRAP_SIG) ||
        line.includes(FAST_SECONDARY_SIG) ||
        MALWARE_START_REGEX.test(line)
      ) {
        issues.push({
          path: normalizedPath,
          type: line.includes(FAST_ESLINT_BOOTSTRAP_SIG) ? "injected" : "secondary",
          location: `Line ${index + 1}`,
        });
        break;
      }
    }
  }

  return issues;
}

/** Clean malware snippets, fast-scan signatures, and known .gitignore injections. */
export function cleanInfectedContent(filePath: string, content: string): MalwareRemovalResult {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  let matchCount = 0;
  let cleaned = content;

  const malware = removeMalware(cleaned);
  cleaned = malware.cleaned;
  matchCount += malware.matchCount;

  if (normalizedPath === ".gitignore" || normalizedPath.endsWith("/.gitignore")) {
    const next = cleaned
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        if (trimmed === "config.bat" || trimmed === "/config.bat") {
          matchCount += 1;
          return false;
        }
        return true;
      })
      .join("\n");
    cleaned = next;
  }

  if (FAST_CONFIG_FILES.has(normalizedPath) || FAST_CONFIG_FILES.has(normalizedPath.split("/").at(-1) ?? "")) {
    const next = cleaned
      .split(/\r?\n/)
      .filter((line) => {
        if (
          line.includes(FAST_PRIMARY_SIG) ||
          line.includes(FAST_SECONDARY_SIG) ||
          line.includes(FAST_ESLINT_BOOTSTRAP_SIG)
        ) {
          matchCount += 1;
          return false;
        }
        return true;
      })
      .join("\n");
    cleaned = next;
  }

  return { changed: cleaned !== content, cleaned, matchCount };
}
