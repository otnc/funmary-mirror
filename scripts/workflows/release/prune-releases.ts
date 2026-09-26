// 古い自動リリースを消す (release.yml)。build- で始まるものを、新しいものから KEEP 個だけ残す。
// v で始まる正式なリリースには触れない。消すものの選び方は prune-releases.jq に書いてある。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const keep = Number(process.env['KEEP'] ?? '10');
// 0 以下だと、新しいリリースまで全部消えてしまう
if (!Number.isInteger(keep) || keep < 1) {
	throw new Error(`KEEP は 1 以上の整数にしてください: ${process.env['KEEP']}`);
}

const filter = readFileSync(new URL('./prune-releases.jq', import.meta.url), 'utf8');
// gh の --jq は、環境変数を $ENV で読める
const output = execFileSync(
	'gh',
	['release', 'list', '--limit', '200', '--json', 'tagName,createdAt', '--jq', filter],
	{ encoding: 'utf8', env: { ...process.env, KEEP: String(keep) } },
);

for (const tag of output.split('\n').filter(Boolean)) {
	console.log(`古いリリースを消します: ${tag}`);
	execFileSync('gh', ['release', 'delete', tag, '--cleanup-tag', '--yes'], { stdio: 'inherit' });
}
