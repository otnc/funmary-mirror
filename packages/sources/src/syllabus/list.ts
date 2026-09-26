// 公開シラバスの検索結果 (Lesson/SyllabusList) を解析する (設計書 9.4)。
// 列は位置ではなく、data-col-responsive-title 属性の名前で読む。ページ送りは ASP.NET の
// __doPostBack なので、次のページを頼むときに送る hidden の値も、ここで取り出す。
import type { Element, Root } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { select, selectAll } from 'hast-util-select';
import { toText } from 'hast-util-to-text';
import { normalizeLabel } from '../html/table.ts';

export interface SyllabusListRow {
	/** シラバスの番号 (授業コード) */
	readonly lessonId: string;
	readonly year: number;
	readonly name: string;
	readonly courseEnglish: string | null;
	readonly teacher: string | null;
	readonly lessonType: string | null;
}

export type SyllabusListResult =
	| {
			readonly kind: 'ok';
			/** "検索結果(341)" の件数 */
			readonly total: number;
			readonly rows: readonly SyllabusListRow[];
			/** 形が合わずに捨てた行の数 */
			readonly rejectedRows: number;
			/** 次のページを頼むときに、そのまま送る hidden の値 */
			readonly hidden: ReadonlyMap<string, string>;
			/** ページ送りに出ている、最大のページ番号 */
			readonly maxPageLinked: number;
	  }
	| { readonly kind: 'invalid'; readonly reason: string };

const MAX_TEXT_LENGTH = 300;

const clean = (text: string) =>
	text
		.replace(/\p{Cc}/gu, '')
		.trim()
		.slice(0, MAX_TEXT_LENGTH);

function cellsByName(row: Element): Map<string, string> {
	const cells = new Map<string, string>();
	for (const child of row.children) {
		if (child.type !== 'element' || child.tagName !== 'td') continue;
		const title = child.properties['dataColResponsiveTitle'];
		if (typeof title === 'string') cells.set(normalizeLabel(title), clean(toText(child)));
	}
	return cells;
}

export function parseSyllabusList(html: string): SyllabusListResult {
	let tree: Root;
	try {
		tree = fromHtml(html);
	} catch {
		return { kind: 'invalid', reason: 'HTML を読めませんでした' };
	}

	const headings = selectAll('h1, h2, h3, h4', tree).map((h) => toText(h));
	const totalText = headings
		.map((h) => /検索結果\s*[(（]\s*(\d+)\s*[)）]/.exec(h)?.[1])
		.find(Boolean);
	if (totalText === undefined) return { kind: 'invalid', reason: '検索結果の件数がありません' };

	const hidden = new Map<string, string>();
	for (const input of selectAll('input[type="hidden"]', tree)) {
		const name = input.properties['name'];
		if (typeof name === 'string') {
			const value = input.properties['value'];
			hidden.set(name, typeof value === 'string' ? value : '');
		}
	}

	const rows: SyllabusListRow[] = [];
	let rejectedRows = 0;
	const grid = select('table[id$="GridView"]', tree);
	for (const row of grid ? selectAll('tr', grid) : []) {
		const cells = cellsByName(row);
		if (!cells.has(normalizeLabel('授業コード'))) continue;
		const lessonId = cells.get('授業コード') ?? '';
		const year = Number(cells.get('履修年度'));
		const name = cells.get('授業科目名') ?? '';
		if (!/^\d{1,10}$/.test(lessonId) || !Number.isInteger(year) || year < 2000 || name === '') {
			rejectedRows++;
			continue;
		}
		rows.push({
			lessonId,
			year,
			name,
			courseEnglish: cells.get('Course') || null,
			teacher: cells.get('担当教員名') || null,
			lessonType: cells.get('授業形態') || null,
		});
	}

	const pageNumbers = [...html.matchAll(/'Page\$(\d+)'/g)].map((m) => Number(m[1]));
	return {
		kind: 'ok',
		total: Number(totalText),
		rows,
		rejectedRows,
		hidden,
		maxPageLinked: pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1,
	};
}
