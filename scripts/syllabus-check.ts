// 公開シラバスの取得を、手元で 1 回だけ確かめる (開発者が行う)。ログインは要らない。
// 使い方: node scripts/syllabus-check.ts [詳細を取る科目の数 (既定は 3)] [年度 (既定は今年度)]
// 一覧のすべてのページ (18 ページほど) は取るが、詳細は、指定した数の科目だけ取る。
// 大学のサーバーに負荷をかけないよう、リクエストの間は 2 秒あける。
import { fetchSyllabusCatalog } from '../packages/sources/src/index.ts';

const detailLimit = Number(process.argv[2] ?? 3);
const now = new Date();
const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const defaultYear = jst.getUTCMonth() >= 3 ? jst.getUTCFullYear() : jst.getUTCFullYear() - 1;
const academicYear = Number(process.argv[3] ?? defaultYear);

let detailsRequested = 0;
const result = await fetchSyllabusCatalog({
	fetch: (url, init) => fetch(url, init),
	academicYear,
	needsDetail: () => detailsRequested++ < detailLimit,
});

if (result.kind === 'ok') {
	const withDetail = result.entries.filter((e) => e.detail !== null);
	console.log(`${result.year} 年度: 科目 ${result.entries.length} 件を集めました`);
	console.log(
		`詳細を取った科目 ${withDetail.length} 件、読めなかった科目 ${result.failedDetails} 件`,
	);
	for (const { row, detail } of withDetail) {
		console.log(
			`  ${row.lessonId} ${detail?.name ?? ''} | ${detail?.term} | ${detail?.credits ?? '-'} 単位 | 項目 ${detail?.attributes.size} 本文 ${detail?.sections.size}`,
		);
	}
} else if (result.kind === 'year-unavailable') {
	console.log(
		`${academicYear} 年度はまだありません。選べる年度: ${result.availableYears.join(', ')}`,
	);
} else {
	console.log(`${result.kind}: ${result.message}`);
	process.exitCode = 1;
}
