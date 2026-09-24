import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseClassChangePage } from './parse.ts';

function fixture(name: string): string {
	return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

describe('parseClassChangePage', () => {
	it('実物の休講一覧から休講を取り出す。行のない補講と教室変更は 0 件になる', () => {
		expect(parseClassChangePage(fixture('cancellation-only.html'), { academicYear: 2026 })).toEqual(
			{
				kind: 'ok',
				cancellations: [
					{
						date: '2026-09-25',
						period: 5,
						lessonName: '起業家としての自立1～4',
						teacher: '未来　太郎',
						campus: '本学',
						comment: '補講なし',
						makeupPlan: 'none',
					},
				],
				makeups: [],
				roomChanges: [],
				rejectedRows: 0,
			},
		);
	});

	it('3 種類の表を列の名前で取り出す。列の順番、列名の空白、知らない列、閉じタグの抜けに左右されない', () => {
		expect(parseClassChangePage(fixture('all-kinds.html'), { academicYear: 2026 })).toEqual({
			kind: 'ok',
			cancellations: [
				{
					// 1 月から 3 月は、年度の翌年になる
					date: '2027-01-18',
					period: 2,
					lessonName: '情報処理演習Ⅰ',
					teacher: '架空　花子',
					campus: '本学',
					comment: '補講あり 日時は後日連絡',
					makeupPlan: 'planned',
				},
				{
					date: '2026-04-07',
					period: 1,
					lessonName: '英語 I',
					teacher: null,
					campus: '本学',
					comment: null,
					makeupPlan: null,
				},
			],
			makeups: [
				{
					date: '2027-01-23',
					period: 3,
					lessonName: '情報処理演習Ⅰ',
					teacher: '架空　花子',
					campus: '本学',
					room: 'R791',
					comment: null,
				},
			],
			roomChanges: [
				{
					date: '2026-10-02',
					period: 4,
					lessonName: '線形代数学',
					teacher: '架空　次郎',
					campus: '本学',
					fromRoom: '484',
					toRoom: '講堂',
				},
			],
			rejectedRows: 0,
		});
	});
});

/** 休講の表だけを持つ画面を作る。rows は [日付, 時限, 授業名] の組 */
function cancellationPage(
	rows: readonly (readonly [string, string, string])[],
	headers = ['日付', '時限', '授業名'],
): string {
	const cells = rows
		.map(
			(row) =>
				`<tr>${row.map((cell, i) => `<td data-col-responsive-title="${headers[i]}">${cell}</td>`).join('')}</tr>`,
		)
		.join('');
	return `<main>
		<h4 id="cancel-lecture-information">休講情報</h4><div><table><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>${cells}</table></div>
		<h4 id="sup-lecture-information">補講情報</h4><div></div>
		<h4 id="classroom-exchanged-lecture-information">教室変更情報</h4><div></div>
	</main>`;
}

describe('parseClassChangePage の失敗の扱い', () => {
	const options = { academicYear: 2026 };

	it('ログインの画面に戻されたら、ログインが要ると返す', () => {
		const html = `<form><input name="ctl00$MainContent$LoginId"><input type="password" name="ctl00$MainContent$LoginPassword"></form>`;
		expect(parseClassChangePage(html, options)).toEqual({ kind: 'login-required' });
	});

	it('休講などの見出しがない画面は、構造が変わったとみなす', () => {
		expect(parseClassChangePage('<main><h4>お知らせ</h4></main>', options)).toMatchObject({
			kind: 'structure-changed',
		});
	});

	it('見出しの id が変わっても、見出しの文字で表を見つける', () => {
		const html = cancellationPage([['09/25', '5時限', '線形代数学']]).replaceAll(
			/ id="[^"]+"/g,
			'',
		);
		expect(parseClassChangePage(html, options)).toMatchObject({
			kind: 'ok',
			cancellations: [{ date: '2026-09-25', period: 5, lessonName: '線形代数学' }],
		});
	});

	it('必須の列がない表は、構造が変わったとみなす', () => {
		const html = cancellationPage([['09/25', '線形代数学', '']], ['日付', '科目の名前', '備考']);
		expect(parseClassChangePage(html, options)).toMatchObject({ kind: 'structure-changed' });
	});

	it('形の合わない行は捨てて数える。存在しない日付と、範囲の外の時限も捨てる', () => {
		const rows: [string, string, string][] = [
			['09/25', '5時限', '線形代数学'],
			['09/26', '1時限', '英語 I'],
			['09/28', '2時限', '物理学'],
			['09/29', '3時限', '化学'],
			['09/30', '4時限', '生物学'],
			['02/30', '1時限', '存在しない日付'],
		];
		const result = parseClassChangePage(cancellationPage(rows), options);
		expect(result).toMatchObject({ kind: 'ok', rejectedRows: 1 });
		expect(result.kind === 'ok' && result.cancellations.map((c) => c.lessonName)).not.toContain(
			'存在しない日付',
		);
	});

	it('捨てた行が 2 割を超えたら、結果全体を信用しない', () => {
		const rows: [string, string, string][] = [
			['09/25', '5時限', '線形代数学'],
			['9月25日', '5時限', '日付の形が違う'],
			['09/25', '7時限', '時限が範囲の外'],
		];
		expect(parseClassChangePage(cancellationPage(rows), options)).toMatchObject({
			kind: 'structure-changed',
		});
	});
});

describe('parseClassChangePage に崩れた HTML を与える', () => {
	const kinds = ['ok', 'login-required', 'structure-changed'];
	const real = fixture('all-kinds.html');

	it('でたらめな文字列でも例外を投げず、3 つの結果のどれかを返す', () => {
		fc.assert(
			fc.property(fc.string({ unit: 'binary', maxLength: 2000 }), (html) => {
				expect(kinds).toContain(parseClassChangePage(html, { academicYear: 2026 }).kind);
			}),
		);
	});

	it('実物に近い HTML を途中で切ったり、一部を消したりしても例外を投げない', () => {
		fc.assert(
			fc.property(
				fc.nat({ max: real.length }),
				fc.nat({ max: real.length }),
				fc.string({ maxLength: 20 }),
				(start, length, inserted) => {
					const broken = real.slice(0, start) + inserted + real.slice(start + length);
					expect(kinds).toContain(parseClassChangePage(broken, { academicYear: 2026 }).kind);
				},
			),
			{ numRuns: 300 },
		);
	});
});
