// Verify release metadata before rebuilding the recorded source revision.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const root = resolve(import.meta.dirname, '..');
const read = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const release = read('release.json');
const sha = /^[a-f0-9]{40}$/;
if (!sha.test(release.source)) throw new Error('Expected a full source commit');
if (release.node !== '26.13.1' || release.typescript !== '6.0.3') {
  throw new Error('Unexpected release toolchain');
}
if (process.versions.node !== release.node) throw new Error(`Use Node ${release.node}`);
const source = (file) => JSON.parse(execFileSync('git', ['show', `${release.source}:${file}`], { cwd: root, encoding: 'utf8' }));
const expected = source('package.json');
const expectedLock = source('package-lock.json');
delete expected.scripts.prepare;
if (expected.name === '@freedomofpress/sigstore-browser') {
  if (!sha.test(release.tufRelease)) throw new Error('Expected a full TUF release commit');
  const dependency = '@freedomofpress/tuf-browser';
  const spec = `git+https://github.com:443/MaplePrivacyLabs/tuf-browser.git#${release.tufRelease}`;
  expected.dependencies[dependency] = spec;
  expectedLock.packages[''].dependencies[dependency] = spec;
  const locked = expectedLock.packages[`node_modules/${dependency}`];
  locked.resolved = spec;
  // Git is pinned by its commit. npm ignores archive integrity for Git installs.
  delete locked.integrity;
} else if (expected.name !== '@freedomofpress/tuf-browser') {
  throw new Error('Unexpected package');
}
if (expected.devDependencies.typescript !== release.typescript) throw new Error('Compiler pin mismatch');
for (const hook of ['prepare', 'preinstall', 'install', 'postinstall']) {
  if (Object.hasOwn(read('package.json').scripts, hook)) throw new Error(`Forbidden release hook: ${hook}`);
}
for (const [file, value] of [['package.json', expected], ['package-lock.json', expectedLock]]) {
  if (!isDeepStrictEqual(read(file), value)) throw new Error(`${file} differs from the source release transformation`);
}
// Entry-point code, build configuration and any additional tracked consumption
// files must match the source too. Only these generated release files may differ.
run('git', ['diff', '--exit-code', release.source, '--', '.', ':!dist', ':!package.json', ':!package-lock.json', ':!release.json'], root);
const scratch = mkdtempSync(join(tmpdir(), 'release-check-'));
try {
  const archive = join(scratch, 'source.tar');
  run('git', ['archive', '--output', archive, release.source], root);
  run('tar', ['-xf', archive, '-C', scratch], root);
  rmSync(archive);
  for (const file of ['package.json', 'package-lock.json']) {
    copyFileSync(join(root, file), join(scratch, file));
  }
  run('npm', ['ci', '--ignore-scripts'], scratch);
  run('npm', ['run', 'build'], scratch);
  run('diff', ['-r', join(root, 'dist'), join(scratch, 'dist')], root);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
