import { describe, expect, it } from 'vitest';
import { addDays, isoWeekday } from './calendar-date.ts';
import { estimateAcademicTerms, resolveAcademicTerms, type StoredTerm } from './academic-terms.ts';

describe('addDays', () => {
	it('月や年をまたいで日付を足し引きする', () => {
		expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
		expect(addDays('2026-04-06', 0)).toBe('2026-04-06');
	});
});

describe('estimateAcademicTerms', () => {
	it('2026 年度は、実際の学年暦に近い値になる (前期は 4/6 から 7/24。後期の終わりは 2027/1/21)', () => {
		// 実際の学年暦 (前期 4/6 から 7/24、後期 9/24 から 1/21) を見て作った規則の確認。
		// 後期の始まりだけは "9 月の最終月曜" の規則で 9/28 になり、実際 (9/24) より遅い
		expect(estimateAcademicTerms(2026)).toEqual([
			{ term: 'spring', start: '2026-04-06', end: '2026-07-24' },
			{ term: 'fall', start: '2026-09-28', end: '2027-01-21' },
		]);
	});

	it('どの年度でも、前期は 4 月の第 1 月曜から金曜まで、後期は 9 月の最終月曜から木曜までになる', () => {
		for (let year = 2020; year <= 2060; year++) {
			const [spring, fall] = estimateAcademicTerms(year);
			expect(isoWeekday(spring!.start)).toBe(1);
			expect(Number(spring!.start.slice(5, 7))).toBe(4);
			expect(Number(spring!.start.slice(8))).toBeLessThanOrEqual(7);
			expect(isoWeekday(spring!.end)).toBe(5);

			expect(isoWeekday(fall!.start)).toBe(1);
			expect(fall!.start.startsWith(`${year}-09-`)).toBe(true);
			expect(Number(fall!.start.slice(8))).toBeGreaterThanOrEqual(24);
			expect(isoWeekday(fall!.end)).toBe(4);
			// 後期は翌年の 1 月に終わる
			expect(fall!.end.startsWith(`${year + 1}-01-`)).toBe(true);
			expect(spring!.end < fall!.start).toBe(true);
		}
	});
});

const stored = (
	term: StoredTerm['term'],
	start: string,
	end: string,
	source: StoredTerm['source'],
): StoredTerm => ({ term, start, end, source });

describe('resolveAcademicTerms', () => {
	it('何も保存されていなければ、前期と後期を推定で返し、推定と分かるようにする', () => {
		const result = resolveAcademicTerms(2026, []);
		expect(result.map((t) => [t.term, t.source])).toEqual([
			['spring', 'estimated'],
			['fall', 'estimated'],
		]);
		expect(result.find((t) => t.term === 'spring')).toMatchObject({
			start: '2026-04-06',
			end: '2026-07-24',
		});
	});

	it('保存された値を、推定より先に使う。保存されていない学期だけ推定で補う', () => {
		const result = resolveAcademicTerms(2026, [
			stored('spring', '2026-04-08', '2026-07-22', 'auto'),
		]);
		expect(result.find((t) => t.term === 'spring')).toEqual({
			term: 'spring',
			start: '2026-04-08',
			end: '2026-07-22',
			source: 'auto',
		});
		expect(result.find((t) => t.term === 'fall')?.source).toBe('estimated');
	});

	it('自動と手入力が両方あれば、管理者が入れた手入力を使う (取得した値が誤っているときに直せるように)', () => {
		const result = resolveAcademicTerms(2026, [
			stored('spring', '2026-04-06', '2026-07-24', 'auto'),
			stored('spring', '2026-04-07', '2026-07-23', 'manual'),
		]);
		expect(result.find((t) => t.term === 'spring')).toMatchObject({
			start: '2026-04-07',
			source: 'manual',
		});
	});

	it('1Q から 4Q や集中講義は、保存されていれば返し、なければ推定しない', () => {
		expect(resolveAcademicTerms(2026, []).map((t) => t.term)).toEqual(['spring', 'fall']);
		const result = resolveAcademicTerms(2026, [stored('q1', '2026-04-06', '2026-06-05', 'manual')]);
		expect(result.map((t) => t.term)).toEqual(['spring', 'q1', 'fall']);
		expect(result.find((t) => t.term === 'q1')?.source).toBe('manual');
	});

	it('開始日の順に並べる', () => {
		const result = resolveAcademicTerms(2026, [
			stored('summer-intensive', '2026-08-17', '2026-08-28', 'manual'),
		]);
		expect(result.map((t) => t.term)).toEqual(['spring', 'summer-intensive', 'fall']);
	});
});
