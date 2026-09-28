import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function historicalSourceTreeSha256(repoRoot) {
    const root = resolve(repoRoot);
    const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
    const trackedDiff = execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root, env: gitEnv });
    const untrackedPaths = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, env: gitEnv })
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const hash = createHash('sha256').update('to4-source-tree-v1\0').update(trackedDiff);
    for (const path of untrackedPaths) {
        const filePath = resolve(root, path);
        const stat = lstatSync(filePath);
        hash.update('\0untracked\0').update(path).update('\0').update(String(stat.mode & 0o777)).update('\0');
        if (stat.isSymbolicLink()) throw new Error(`Unsupported untracked source symlink: ${path}`);
        else if (stat.isFile()) {
            const bytes = readFileSync(filePath);
            hash.update('file\0').update(String(bytes.length)).update('\0').update(bytes);
        } else throw new Error(`Unsupported untracked source entry: ${path}`);
    }
    return hash.digest('hex');
}

export function assertEvidenceLabelsMatchProvenance(labelFile, provenance, sourceName) {
    if (labelFile && (labelFile.recordsSha256 !== provenance.recordsSha256
        || labelFile.sourceCommit !== provenance.sourceCommit
        || labelFile.sourceTreeSha256 !== provenance.sourceTreeSha256)) {
        throw new Error(`${sourceName} labels must match this export, source commit and source tree.`);
    }
}
