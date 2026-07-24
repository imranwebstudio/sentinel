import assert from "node:assert/strict";
import test from "node:test";
import {
  FAST_PRIMARY_SIG,
  isFastScanCandidate,
  isRepositoryMetadataFile,
  needsFastContentRead,
  removeMalware,
  scanFastFileContent,
} from "../src/index.js";

test("preserves legacy malware removal behavior", () => {
  const input = "export default {};\nvar _$_1e42=(function(l,e){return l[e];})(window,document);\n";
  const result = removeMalware(input);
  assert.equal(result.changed, true);
  assert.equal(result.matchCount, 1);
  assert.equal(result.cleaned.trim(), "export default {};");
});

test("preserves legacy metadata eligibility behavior", () => {
  assert.equal(isRepositoryMetadataFile("apps/api/tsconfig.build.json"), true);
  assert.equal(isRepositoryMetadataFile(".github/workflows/ci.yml"), true);
  assert.equal(isRepositoryMetadataFile("src/index.ts"), false);
  assert.equal(isRepositoryMetadataFile("node_modules/pkg/package.json"), false);
});

test("fast scan candidates are root-only dose-scanner targets", () => {
  assert.equal(isFastScanCandidate("config.bat"), true);
  assert.equal(isFastScanCandidate("temp_auto_push.bat"), true);
  assert.equal(isFastScanCandidate("postcss.config.mjs"), true);
  assert.equal(isFastScanCandidate(".gitignore"), false);
  assert.equal(isFastScanCandidate("src/config.bat"), false);
  assert.equal(needsFastContentRead("config.bat"), false);
  assert.equal(needsFastContentRead("postcss.config.mjs"), true);
  assert.equal(needsFastContentRead(".gitignore"), false);
});

test("fast content scan detects primary signature and skips gitignore", () => {
  const primary = scanFastFileContent("postcss.config.mjs", `module.exports = {};\n${FAST_PRIMARY_SIG}\n`);
  assert.equal(primary.length, 1);
  assert.equal(primary[0]?.type, "primary");

  const ignored = scanFastFileContent(".gitignore", "node_modules\nconfig.bat\n");
  assert.equal(ignored.length, 0);
});
