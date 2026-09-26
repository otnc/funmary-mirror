import { describe, expect, it } from 'vitest';
import { resolveHolidays, type HolidaySource } from './holidays.ts';

const stored = (date: string, name: string, source: HolidaySource = 'cabinetOffice') => ({
	date,
	name,
	source,
});

/** 年ごとに、1 月 1 日と 11 月 3 日だけを返す推定 */
const estimate = (year: number) => [
	{ date: `${year}-01-01`, name: `元日 (推定 ${year})` },
	{ date: `${year}-11-03`, name: `文化の日 (推定 ${year})` },
];

describe('resolveHolidays', () => {
	it('保存された祝日は、そのまま出どころ付きで返す', () => {
		const result = resolveHolidays({
			stored: [stored('2026-01-01', '元日'), stored('2026-05-03', '憲法記念日', 'bundled')],
			estimate,
			throughYear: 2026,
		});
		expect(result).toEqual([
			{ date: '2026-01-01', name: '元日', source: 'cabinetOffice' },
			{ date: '2026-05-03', name: '憲法記念日', source: 'bundled' },
		]);
	});

	it('保存された最後の年より先の年は、推定で補い、推定と分かるようにする', () => {
		const result = resolveHolidays({
			stored: [stored('2027-12-31', '架空の祝日')],
			estimate,
			throughYear: 2029,
		});
		expect(result.map((h) => [h.date, h.source])).toEqual([
			['2027-12-31', 'cabinetOffice'],
			['2028-01-01', 'estimated'],
			['2028-11-03', 'estimated'],
			['2029-01-01', 'estimated'],
			['2029-11-03', 'estimated'],
		]);
	});

	it('保存された年の中は推定で補わない (CSV にない日は祝日ではない)', () => {
		const result = resolveHolidays({
			stored: [stored('2026-01-01', '元日')],
			estimate,
			throughYear: 2026,
		});
		expect(result.map((h) => h.date)).toEqual(['2026-01-01']);
	});

	it('何も保存されていなければ、fromYear から throughYear までを推定で返す', () => {
		const result = resolveHolidays({ stored: [], estimate, fromYear: 2030, throughYear: 2031 });
		expect(result.map((h) => h.date)).toEqual([
			'2030-01-01',
			'2030-11-03',
			'2031-01-01',
			'2031-11-03',
		]);
		expect(result.every((h) => h.source === 'estimated')).toBe(true);
	});

	it('日付の順に並べる', () => {
		const result = resolveHolidays({
			stored: [stored('2026-11-03', 'b'), stored('2026-01-01', 'a')],
			estimate,
			throughYear: 2026,
		});
		expect(result.map((h) => h.date)).toEqual(['2026-01-01', '2026-11-03']);
	});

	it('年度をまたいでも同じ規則で動く (年を固定しない)', () => {
		for (const last of [2024, 2027, 2040]) {
			const result = resolveHolidays({
				stored: [stored(`${last}-01-01`, '元日')],
				estimate,
				throughYear: last + 1,
			});
			expect(result.filter((h) => h.source === 'estimated').map((h) => h.date)).toEqual([
				`${last + 1}-01-01`,
				`${last + 1}-11-03`,
			]);
		}
	});
});
