import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseSearchForm, parseSyllabusList } from './list.ts';

const fixture = readFileSync(new URL('./fixtures/list.html', import.meta.url), 'utf8');

describe('シラバス検索結果の解析', () => {
	it('件数と、各行の授業コード、科目名、教員、授業形態を取り出す', () => {
		const result = parseSyllabusList(fixture);
		if (result.kind !== 'ok') throw new Error(`読めるはず: ${JSON.stringify(result)}`);
		expect(result.total).toBe(45);
		expect(result.rows).toEqual([
			{
				lessonId: '900001',
				year: 2026,
				name: '架空の科目入門1～4',
				courseEnglish: 'Introduction to Sample',
				teacher: '架空　太郎',
				lessonType: '講義',
			},
			{
				lessonId: '900002',
				year: 2026,
				name: '架空の集中講義　夏期集中',
				courseEnglish: 'Sample Intensive',
				teacher: '架空　花子',
				lessonType: '集中講義',
			},
		]);
	});

	it('ページ送りで、次のページを頼むときに送る値 (hidden) を返す', () => {
		const result = parseSyllabusList(fixture);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.hidden.get('__VIEWSTATE')).toBe('dummy-viewstate');
		expect(result.hidden.get('__EVENTVALIDATION')).toBe('dummy-validation');
	});

	it('ページの番号の最大を返す', () => {
		const result = parseSyllabusList(fixture);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.maxPageLinked).toBe(3);
	});

	it('授業コードが数字でない行は、捨てて、数を返す', () => {
		const html = fixture.replace('>900002<', '>abc<').replace('lesson_id=900002', 'lesson_id=abc');
		const result = parseSyllabusList(html);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.rows).toHaveLength(1);
		expect(result.rejectedRows).toBe(1);
	});

	it('列の順番が入れ替わっても、名前で読む', () => {
		const html = fixture.replace(
			/(<td class="disp" data-col-responsive-title="授業コード">\d+<\/td>)(<td class="disp" data-col-responsive-title="授業科目名">[^<]*<\/td>)/g,
			'$2$1',
		);
		const result = parseSyllabusList(html);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.rows.map((r) => r.lessonId)).toEqual(['900001', '900002']);
	});

	it('検索結果の表がなければ (0 件など)、0 件の結果として返す', () => {
		const html = '<html><body><form><h3 class="title">検索結果(0)</h3></form></body></html>';
		const result = parseSyllabusList(html);
		expect(result).toMatchObject({ kind: 'ok', total: 0, rows: [] });
	});

	it('検索結果の見出しがなければ、構造が変わったものとして知らせる', () => {
		expect(parseSyllabusList('<html><body>メンテナンス中</body></html>').kind).toBe('invalid');
	});

	it('崩れた HTML でも、例外にならず、結果を返す', () => {
		fc.assert(
			fc.property(fc.string(), (html) => {
				expect(['ok', 'invalid']).toContain(parseSyllabusList(html).kind);
			}),
			{ numRuns: 200 },
		);
	});
});

describe('検索画面のフォームの解析', () => {
	it('年度の選択肢と、検索ボタンの名前、hidden の値を取り出す', () => {
		const result = parseSearchForm(fixture);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.form.years).toEqual([2026, 2025]);
		expect(result.form.yearField).toBe('ctl00$MainContent$param_Syllabus_year_eq');
		expect(result.form.submitField).toBe('ctl00$MainContent$SearchButton');
		expect(result.form.submitValue).toBe('検索の実行');
		expect(result.form.hidden.get('__VIEWSTATE')).toBe('dummy-viewstate');
	});

	it('検索のフォームがなければ、構造が変わったものとして知らせる', () => {
		expect(parseSearchForm('<html><body>メンテナンス中</body></html>').kind).toBe('invalid');
	});

	it('崩れた HTML でも、例外にならない', () => {
		fc.assert(
			fc.property(fc.string(), (html) => {
				expect(['ok', 'invalid']).toContain(parseSearchForm(html).kind);
			}),
			{ numRuns: 100 },
		);
	});
});
