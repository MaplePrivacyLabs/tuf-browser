// Checks that this prebuilt release is exactly what its recorded source revision builds to.
//
// release.json names the source commit and the toolchain. The check derives the expected
// package.json from the source, requires every other tracked file to match the source, then
// rebuilds the source with the committed lockfile and compares dist/ byte for byte.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { preparationScripts, releaseManifest } from "./release-policy.mjs";

const NODE = "26.13.1";
const TYPESCRIPT = "6.0.3";
const FULL_COMMIT = /^[a-f0-9]{40}$/;
// Files a release generates from its source; every other tracked file must equal the source.
const GENERATED = [":!dist", ":!package.json", ":!package-lock.json", ":!release.json"];

const root = resolve(import.meta.dirname, "..");

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const showJson = (revision, file) =>
  JSON.parse(execFileSync("git", ["show", `${revision}:${file}`], { cwd: root, encoding: "utf8" }));

function readRelease() {
  const release = readJson(join(root, "release.json"));
  if (!FULL_COMMIT.test(release.source)) throw new Error("Expected a full source commit");
  if (release.node !== NODE || release.typescript !== TYPESCRIPT) {
    throw new Error("Unexpected release toolchain");
  }
  if (process.versions.node !== release.node) throw new Error(`Use Node ${release.node}`);
  return release;
}

function checkReleaseFiles(release) {
  const expected = releaseManifest(showJson(release.source, "package.json"));
  if (expected.name !== "@freedomofpress/tuf-browser") throw new Error("Unexpected package");
  if (expected.devDependencies.typescript !== release.typescript) throw new Error("Compiler pin mismatch");

  const manifest = readJson(join(root, "package.json"));
  for (const hook of preparationScripts) {
    if (Object.hasOwn(manifest.scripts ?? {}, hook)) throw new Error(`Forbidden release hook: ${hook}`);
  }
  if (Object.hasOwn(manifest, "workspaces")) throw new Error("Forbidden release workspaces");
  if (!isDeepStrictEqual(manifest, expected)) {
    throw new Error("package.json differs from the source release transformation");
  }
  if (!isDeepStrictEqual(readJson(join(root, "package-lock.json")), showJson(release.source, "package-lock.json"))) {
    throw new Error("package-lock.json differs from the source release transformation");
  }
  // Entry-point code, build configuration and any additional tracked consumption files must match
  // the source too.
  run("git", ["diff", "--exit-code", release.source, "--", ".", ...GENERATED], root);
}

function checkBuild(release, scratch) {
  const archive = join(scratch, "source.tar");
  run("git", ["archive", "--output", archive, release.source], root);
  run("tar", ["-xf", archive, "-C", scratch], root);
  rmSync(archive);
  for (const file of ["package.json", "package-lock.json"]) {
    copyFileSync(join(root, file), join(scratch, file));
  }
  run("npm", ["ci", "--ignore-scripts"], scratch);
  run("node", [join(scratch, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"], scratch);
  run("diff", ["-r", join(root, "dist"), join(scratch, "dist")], root);
}

const release = readRelease();
checkReleaseFiles(release);
const scratch = mkdtempSync(join(tmpdir(), "release-check-"));
try {
  checkBuild(release, scratch);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
