// SSH で VPS に反映を頼む (deploy.yml)。VPS では funmary-update が版の名前を確かめ、update.sh が反映する。
// 環境変数: HEAD_SHA、DEPLOY_HOST、DEPLOY_SSH_KEY、DEPLOY_KNOWN_HOSTS (Environment production の secret)、
// DEPLOY_ENABLED (false なら反映しない)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { releaseVersion } from '../release/release-version.ts';

/** DEPLOY_ENABLED が false のときだけ止める。止めたいときは明示する */
export function isDeployEnabled(value: string | undefined): boolean {
	return value !== 'false';
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value)
		throw new Error(
			`環境変数 ${name} がありません (Environment production の secret を確かめてください)`,
		);
	return value;
}

if (import.meta.main) {
	if (!isDeployEnabled(process.env['DEPLOY_ENABLED'])) {
		console.log('DEPLOY_ENABLED が false なので、反映しません');
	} else {
		const version = releaseVersion(process.env['HEAD_SHA'] ?? '');
		const host = requiredEnv('DEPLOY_HOST');
		const sshDir = join(homedir(), '.ssh');
		const keyFile = join(sshDir, 'deploy_key');
		mkdirSync(sshDir, { recursive: true, mode: 0o700 });
		writeFileSync(keyFile, `${requiredEnv('DEPLOY_SSH_KEY')}\n`, { mode: 0o600 });
		// ホストの公開鍵を固定する。接続先がすり替わっていれば、接続しない
		writeFileSync(join(sshDir, 'known_hosts'), `${requiredEnv('DEPLOY_KNOWN_HOSTS')}\n`);
		try {
			// この鍵で入ると、VPS 側が決めたコマンドだけが動く。ここで渡す版の名前は、VPS 側でも形を確かめる
			execFileSync(
				'ssh',
				[
					'-i',
					keyFile,
					'-o',
					'IdentitiesOnly=yes',
					'-o',
					'BatchMode=yes',
					'-o',
					'StrictHostKeyChecking=yes',
					`funmary-deploy@${host}`,
					version,
				],
				{ stdio: 'inherit' },
			);
		} finally {
			rmSync(keyFile, { force: true });
		}
	}
}
