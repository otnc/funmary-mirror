import { describe, expect, it } from 'vitest';
import { bundledHolidays } from './bundled.ts';

describe('bundledHolidays', () => {
	it('同梱の祝日を、日付の順に読める', () => {
		const holidays = bundledHolidays();
		expect(holidays.length).toBeGreaterThan(1000);
		expect(holidays[0]).toEqual({ date: '1955-01-01', name: '元日' });
		const dates = holidays.map((h) => h.date);
		expect(dates).toEqual([...dates].sort());
	});

	it('学期の計算に使う近年の祝日が入っている (2026 年の元日と、勤労感謝の日)', () => {
		const dates = new Set(bundledHolidays().map((h) => h.date));
		expect(dates.has('2026-01-01')).toBe(true);
		expect(dates.has('2026-11-23')).toBe(true);
	});
});
