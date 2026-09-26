// main とタグを otnc/funmary-mirror へ複製する (mirror.yml)。
// 環境変数: MIRROR_SSH_KEY (デプロイキーの秘密鍵)、GITHUB_HOST_KEY (GitHub の SSH のホスト鍵。接続先のすり替わりを防ぐ)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MIRROR_URL = 'git@github.com:otnc/funmary-mirror.git';

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`環境変数 ${name} がありません`);
	return value;
}

const sshDir = join(homedir(), '.ssh');
const keyFile = join(sshDir, 'mirror');
mkdirSync(sshDir, { recursive: true, mode: 0o700 });
writeFileSync(keyFile, `${requiredEnv('MIRROR_SSH_KEY')}\n`, { mode: 0o600 });
writeFileSync(join(sshDir, 'known_hosts'), `${requiredEnv('GITHUB_HOST_KEY')}\n`);

const git = (...args: string[]) =>
	execFileSync('git', args, {
		stdio: 'inherit',
		env: {
			...process.env,
			GIT_SSH_COMMAND: `ssh -i ${keyFile} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes`,
		},
	});

try {
	git('remote', 'add', 'mirror', MIRROR_URL);
	git('push', '--force', 'mirror', 'refs/remotes/origin/main:refs/heads/main');
	git('push', '--force', '--tags', 'mirror');
} finally {
	// 鍵は、成功しても失敗しても消す
	rmSync(keyFile, { force: true });
}
