// Rebuild the recorded source revision in isolation and compare all shipped bytes.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const root = resolve(import.meta.dirname, '..');
const release = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'));
if (process.versions.node !== release.node) throw new Error(`Use Node ${release.node}`);
if (!/^[a-f0-9]{40}$/.test(release.source)) throw new Error('Expected a full source commit');
const scratch = mkdtempSync(join(tmpdir(), 'release-check-'));
try {
  const archive = execFileSync('git', ['archive', release.source], { cwd: root });
  execFileSync('tar', ['-x', '-C', scratch], { input: archive });
  // Use the release lockfile: dependencies may themselves need prebuilt artifacts.
  for (const file of ['package.json', 'package-lock.json']) {
    copyFileSync(join(root, file), join(scratch, file));
  }
  run('npm', ['ci', '--ignore-scripts'], scratch);
  run('npm', ['run', 'build'], scratch);
  run('diff', ['-r', join(root, 'dist'), join(scratch, 'dist')], root);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
