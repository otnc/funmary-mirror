// リリースの tar.gz を作り、GitHub Releases に置く (release.yml)。
// 環境変数: HEAD_SHA (リリースにするコミット)、GH_TOKEN (gh が使う)
import { execFileSync } from 'node:child_process';
import { releaseVersion } from './release-version.ts';

const sha = process.env['HEAD_SHA'] ?? '';
const version = releaseVersion(sha);

// pnpm は Linux の Actions で動かすので、シェルを通さずに呼べる
execFileSync('pnpm', ['package-release', version], { stdio: 'inherit' });

// 同じ版を作り直したときは、置き換える
try {
	execFileSync('gh', ['release', 'delete', version, '--cleanup-tag', '--yes'], { stdio: 'ignore' });
} catch {
	// まだなければ、消すものがないだけ
}
execFileSync(
	'gh',
	[
		'release',
		'create',
		version,
		'--target',
		sha,
		'--title',
		version,
		'--notes',
		`main の ${sha} から自動で作ったリリースです。`,
		'--prerelease',
		`release/funmary-${version}.tar.gz`,
		`release/funmary-${version}.tar.gz.sha256`,
		'release/build-hash.txt',
		'release/THIRD_PARTY_LICENSES.txt',
	],
	{ stdio: 'inherit' },
);
console.log(`${version} を GitHub Releases に置きました`);
