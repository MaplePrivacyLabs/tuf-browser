// Classify from runner-controlled refs and tracked artifacts before installation.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const refs = [process.env.GITHUB_REF, process.env.GITHUB_HEAD_REF,
  process.env.GITHUB_BASE_REF, process.env.GITHUB_REF_NAME];
const releaseRef = refs.some(ref => ref === 'refs/heads/maple/release' || ref === 'maple/release');
const trackedOutput = execFileSync('git', ['ls-files', '--', 'dist'], { cwd: root, encoding: 'utf8' }).trim();
const manifest = existsSync(resolve(root, 'release.json'));
if ((releaseRef || trackedOutput) && !manifest) {
  throw new Error('Release refs and tracked distribution output require release.json');
}
const output = `release=${releaseRef || Boolean(trackedOutput) || manifest}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
process.stdout.write(output);
