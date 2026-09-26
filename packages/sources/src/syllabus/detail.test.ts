import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseSyllabusDetail } from './detail.ts';

const fixture = readFileSync(new URL('./fixtures/detail.html', import.meta.url), 'utf8');

describe('シラバスの詳細の解析', () => {
	it('基本情報を取り出す', () => {
		const result = parseSyllabusDetail(fixture);
		if (result.kind !== 'ok') throw new Error(`読めるはず: ${JSON.stringify(result)}`);
		expect(result.detail).toMatchObject({
			name: '架空の科目入門1～4',
			teacher: '架空　太郎',
			credits: 2,
			term: 'fall',
		});
	});

	it('教員名の先頭の記号 (◎ など) は、名前に含めない', () => {
		const result = parseSyllabusDetail(fixture);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.detail.teacher).not.toContain('◎');
	});

	it('表の項目は、名前をキーにして attributes に入れる。空の項目 (-) は入れない', () => {
		const result = parseSyllabusDetail(fixture);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.detail.attributes.get('配当年次')).toBe('1年');
		expect(result.detail.attributes.get('授業形態')).toBe('講義');
		expect(result.detail.attributes.get('Course')).toBe('Introduction to Sample');
		expect(result.detail.attributes.get('開講期')).toBe('後期');
		expect(result.detail.attributes.has('実務家教員区分')).toBe(false);
	});

	it('本文の項目は、改行を保ったまま sections に入れる', () => {
		const result = parseSyllabusDetail(fixture);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.detail.sections.get('授業の概要')).toBe(
			'概要の 1 行目です。\n概要の 2 行目です。',
		);
		expect(result.detail.sections.get('授業の到達目標')).toContain('2. 到達目標の 2 です。');
		expect(result.detail.sections.get('授業内容とスケジュール')).toBe(
			'1. イントロダクション\n2. 基礎\n3. まとめ',
		);
	});

	it('開講期の表記を、Term にする', () => {
		const termOf = (label: string) => {
			const html = fixture.replace('>後期<', `>${label}<`);
			const result = parseSyllabusDetail(html);
			return result.kind === 'ok' ? result.detail.term : result.kind;
		};
		expect(termOf('前期')).toBe('spring');
		expect(termOf('後期')).toBe('fall');
		expect(termOf('通年')).toBe('full-year');
		expect(termOf('1Q')).toBe('q1');
		expect(termOf('4Q')).toBe('q4');
		// 読めない表記は、推測せず、読めなかったものとして知らせる
		expect(termOf('未定')).toBe('invalid');
	});

	it('夏期集中と冬期集中は、開講期の表記か授業名から見分ける', () => {
		const termOf = (html: string) => {
			const result = parseSyllabusDetail(html);
			return result.kind === 'ok' ? result.detail.term : result.kind;
		};
		expect(termOf(fixture.replace('>後期<', '>夏期集中<'))).toBe('summer-intensive');
		expect(termOf(fixture.replace('>後期<', '>集中<').replace('入門1～4', '入門　冬期集中'))).toBe(
			'winter-intensive',
		);
	});

	it('単位数が数字でなければ、単位数を空にして続ける', () => {
		const html = fixture.replace('2単位', '未定');
		const result = parseSyllabusDetail(html);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.detail.credits).toBeNull();
	});

	it('授業名がなければ、構造が変わったものとして知らせる', () => {
		const html = fixture.replace('授業名', '科目の名前');
		expect(parseSyllabusDetail(html).kind).toBe('invalid');
	});

	it('文字数の上限を超える項目は、切る', () => {
		const long = 'あ'.repeat(20_000);
		const result = parseSyllabusDetail(fixture.replace('概要の 1 行目です。', long));
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.detail.sections.get('授業の概要')!.length).toBeLessThanOrEqual(10_000);
	});

	it('制御文字は除く', () => {
		const result = parseSyllabusDetail(
			fixture.replace('概要の 1 行目です。', 'あ\u0000い\u0007う'),
		);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.detail.sections.get('授業の概要')).toContain('あいう');
	});

	it('崩れた HTML でも、例外にならず、結果を返す', () => {
		fc.assert(
			fc.property(fc.string(), (html) => {
				const result = parseSyllabusDetail(html);
				expect(['ok', 'invalid']).toContain(result.kind);
			}),
			{ numRuns: 200 },
		);
	});

	it('日本語の見出しを含む崩れた HTML でも、例外にならない', () => {
		const parts = ['<th>', '</th>', '<td>', '授業名', '開講期', '単位数', '<tr>', '<br>', '<span>'];
		fc.assert(
			fc.property(fc.array(fc.constantFrom(...parts), { maxLength: 40 }), (list) => {
				const result = parseSyllabusDetail(list.join(''));
				expect(['ok', 'invalid']).toContain(result.kind);
			}),
			{ numRuns: 200 },
		);
	});
});
