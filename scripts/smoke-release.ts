// できあがったリリースを、本番と同じ入口 (node server.js) で起動して、応答するかを確かめる。
// 使い方: node scripts/package-release.ts <版> のあとに、node scripts/smoke-release.ts <版>
// CI で動かす。環境変数ファイルの、空の値 (HOST=、PORT= など) の入ったままの形も、わざと再現する。
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const version = process.argv[2];
if (!version) throw new Error('使い方: node scripts/smoke-release.ts <版>');

const root = join(import.meta.dirname, '..');
const releaseDir = join(root, 'release', `funmary-${version}`);
const dataDir = mkdtempSync(join(tmpdir(), 'funmary-smoke-'));

// update.sh と同じく、better-sqlite3 だけを入れる
execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', {
	cwd: releaseDir,
	stdio: 'inherit',
});

// 本番の環境変数ファイルを再現する。.env.example を丸ごと写したときの、空の値も入れる
const env: NodeJS.ProcessEnv = {
	PATH: process.env['PATH'],
	NODE_ENV: 'production',
	DATA_DIR: dataDir,
	ORIGIN: 'https://funmary.example.com',
	ADDRESS_HEADER: 'X-Forwarded-For',
	XFF_DEPTH: '1',
	SESSION_SECRET: 'a'.repeat(43),
	ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
	VAPID_PUBLIC_KEY: 'p'.repeat(30),
	VAPID_PRIVATE_KEY: 'q'.repeat(30),
	GOOGLE_CLIENT_ID: 'x',
	GOOGLE_CLIENT_SECRET: 'y',
	PORTAL_USER_ID: 'u',
	PORTAL_PASSWORD: 'p',
	HOST: '',
	PORT: '',
	SHUTDOWN_TIMEOUT: '',
	BODY_SIZE_LIMIT: '',
};

const child = spawn(process.execPath, ['server.js'], { cwd: releaseDir, env, stdio: 'pipe' });
let output = '';
child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

async function waitForHealth(): Promise<string> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null)
			throw new Error(`起動できませんでした (終了コード ${child.exitCode})`);
		try {
			const response = await fetch('http://127.0.0.1:28461/healthz');
			if (response.ok) return await response.text();
		} catch {
			// まだ待ち受けていない
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	throw new Error('30 秒たっても /healthz に応答しません');
}

let exitCode = 0;
try {
	const body = await waitForHealth();
	if (!body.includes('"ok"')) throw new Error(`/healthz の内容が想定と違います: ${body}`);
	console.log(
		`リリース ${version} は、空の HOST と PORT のままでも 127.0.0.1:28461 で起動し、/healthz が ok を返しました`,
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	console.error('--- サーバーの出力 ---');
	console.error(output);
	exitCode = 1;
} finally {
	child.kill('SIGTERM');
	await new Promise((resolve) => child.once('exit', resolve));
	rmSync(dataDir, { recursive: true, force: true });
}
process.exit(exitCode);
