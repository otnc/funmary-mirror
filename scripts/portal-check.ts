// 学生ポータルへのログインと一覧の取得を、手元で 1 回だけ確かめる (開発者が自分のアカウントで行う)。
// 使い方: node --env-file=.env scripts/portal-check.ts [HTML の保存先]
// PORTAL_USER_ID と PORTAL_PASSWORD を、環境変数から読む。取得の間隔の下限 (60 分) は、この確認にも守る。
// 保存先を渡すと、取得した HTML を保存する。休講の一覧には、個人情報を含むことがあるので、公開の場所には置かない。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchPortalPage, parseClassChangePage } from '../packages/sources/src/index.ts';

const userId = process.env['PORTAL_USER_ID'];
const password = process.env['PORTAL_PASSWORD'];
if (!userId || !password) {
	throw new Error('PORTAL_USER_ID と PORTAL_PASSWORD を環境変数に書いてください (.env)');
}

// 前回の試みの時刻を残し、確認を繰り返してもポータルに負荷をかけないようにする
const stampFile = join(import.meta.dirname, '..', 'data', 'portal-check-last-attempt');
let lastAttemptAt: Date | null = null;
try {
	lastAttemptAt = new Date(readFileSync(stampFile, 'utf8').trim());
	if (Number.isNaN(lastAttemptAt.getTime())) lastAttemptAt = null;
} catch {
	// 初めての確認
}

const now = new Date();
const result = await fetchPortalPage({
	fetch: (url, init) => fetch(url, init),
	credentials: { userId, password },
	lastAttemptAt,
	now,
});
if (result.kind !== 'throttled') {
	mkdirSync(dirname(stampFile), { recursive: true });
	writeFileSync(stampFile, now.toISOString());
}

if (result.kind === 'ok') {
	console.log(`取得できました (${result.html.length} 文字)`);
	const savePath = process.argv[2];
	if (savePath) {
		writeFileSync(savePath, result.html);
		console.log(`HTML を ${savePath} に保存しました`);
	}
	// 年度は 4 月から 3 月まで
	const academicYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
	const parsed = parseClassChangePage(result.html, { academicYear });
	if (parsed.kind === 'ok') {
		console.log(
			`解析: 休講 ${parsed.cancellations.length} 件、補講 ${parsed.makeups.length} 件、` +
				`教室変更 ${parsed.roomChanges.length} 件、捨てた行 ${parsed.rejectedRows} 件`,
		);
	} else {
		console.log(`解析の結果: ${parsed.kind}`);
	}
} else if (result.kind === 'throttled') {
	console.log(
		`前回の試みから 60 分たっていません。${result.retryAt.toISOString()} 以降に試してください`,
	);
} else {
	console.log(`${result.kind}: ${result.message}`);
	process.exitCode = 1;
}
