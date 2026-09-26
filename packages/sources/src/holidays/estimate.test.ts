import { describe, expect, it } from 'vitest';
import { estimateHolidays } from './estimate.ts';

describe('estimateHolidays', () => {
	it('ある年の祝日を、日付の順に返す', () => {
		for (const year of [2028, 2035, 2049]) {
			const holidays = estimateHolidays(year);
			expect(holidays.length).toBeGreaterThanOrEqual(15);
			expect(holidays.every((h) => h.date.startsWith(`${year}-`))).toBe(true);
			expect(holidays.map((h) => h.date)).toEqual(holidays.map((h) => h.date).sort());
			expect(holidays[0]).toEqual({ date: `${year}-01-01`, name: '元日' });
		}
	});

	it('データのない年は空を返す', () => {
		expect(estimateHolidays(2100)).toEqual([]);
		expect(estimateHolidays(1900)).toEqual([]);
	});
});
