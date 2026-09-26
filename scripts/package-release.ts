// ビルド済みのアプリを、VPS に置けるリリースの tar.gz にまとめる (設計書 20.6)。
// 使い方: node scripts/package-release.ts <版の名前>。先に pnpm build と、apps/web の pnpm bundle-cli を動かしておく。
// 版の名前は build-<コミットの短い hash> か v<数字>.<数字>.<数字> の形にする (VPS の funmary-update が同じ形を確かめる)。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { generateThirdPartyLicenses } from './third-party-licenses.ts';

const VERSION_PATTERN = /^(build-[0-9a-f]{7,40}|v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?)$/;

const root = join(import.meta.dirname, '..');
const webDir = join(root, 'apps/web');
const outDir = join(root, 'release');

const version = process.argv[2];
if (!version || !VERSION_PATTERN.test(version)) {
	console.error('版の名前を build-<hash> か v<数字>.<数字>.<数字> の形で指定してください。');
	process.exit(1);
}

const stageName = `funmary-${version}`;
const stage = join(outDir, stageName);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// adapter-node の出力。server/migrations はビルドが写したもの
cpSync(join(webDir, 'build'), join(stage, 'build'), { recursive: true });
cpSync(join(webDir, 'dist/cli.js'), join(stage, 'cli.js'));
// cli.js が自分の隣から探す
cpSync(join(root, 'packages/db/migrations'), join(stage, 'migrations'), { recursive: true });
cpSync(join(root, 'deploy'), join(stage, 'deploy'), { recursive: true });
// 本番の入口。環境変数を整えてから、build/ の adapter-node の入口を読み込む
cpSync(join(webDir, 'dist/server.js'), join(stage, 'server.js'));

// 本番の依存は better-sqlite3 だけ。版は apps/web/package.json (catalog を解決したもの) に合わせる
const webPackage = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8')) as {
	dependencies: Record<string, string>;
};
const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
const sqliteVersion =
	/^ {4}better-sqlite3:\n {6}specifier: [^\n]+\n {6}version: (\d+\.\d+\.\d+)/m.exec(lockfile)?.[1];
if (!webPackage.dependencies['better-sqlite3'] || !sqliteVersion) {
	throw new Error('better-sqlite3 の版を pnpm-lock.yaml から読めませんでした');
}
writeFileSync(
	join(stage, 'package.json'),
	JSON.stringify(
		{
			name: 'funmary-release',
			version: '0.0.0',
			private: true,
			type: 'module',
			// 版は完全に固定する。リリースのたびに違う版が入らないようにするため
			dependencies: { 'better-sqlite3': sqliteVersion },
		},
		null,
		'\t',
	) + '\n',
);

const licenses = generateThirdPartyLicenses(root);
writeFileSync(join(stage, 'THIRD_PARTY_LICENSES.txt'), licenses);
writeFileSync(join(outDir, 'THIRD_PARTY_LICENSES.txt'), licenses);

/** ファイルの相対パス (/ 区切り) の順に、パスと中身を混ぜた hash。中身が同じなら、いつ作っても同じになる */
function hashTree(dir: string): string {
	const hash = createHash('sha256');
	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : 1,
		)) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) walk(path);
			else {
				hash.update(relative(dir, path).replaceAll('\\', '/') + '\0');
				hash.update(readFileSync(path));
				hash.update('\0');
			}
		}
	};
	walk(dir);
	return hash.digest('hex');
}

const buildHash = hashTree(stage);
writeFileSync(join(outDir, 'build-hash.txt'), `${buildHash}\n`);

const tarball = `${stageName}.tar.gz`;
// tar は Windows 10 以降にも入っている。展開したときに funmary-<版>/ の下へ出る
execFileSync('tar', ['-czf', tarball, stageName], { cwd: outDir, stdio: 'inherit' });
const sha256 = createHash('sha256')
	.update(readFileSync(join(outDir, tarball)))
	.digest('hex');
writeFileSync(join(outDir, `${tarball}.sha256`), `${sha256}  ${tarball}\n`);

console.log(`${tarball}: sha256 ${sha256}`);
console.log(`ビルド結果の hash: ${buildHash}`);
