import { describe, expect, it } from 'vitest';
import { DEFAULT_PERIODS, findPeriod } from './periods.ts';

describe('findPeriod', () => {
	it('番号に対応する時限を返す', () => {
		expect(findPeriod(3)).toEqual({ number: 3, start: '13:10', end: '14:40' });
	});

	it('存在しない番号なら undefined を返す', () => {
		expect(findPeriod(0)).toBeUndefined();
		expect(findPeriod(7)).toBeUndefined();
	});

	it('渡した時限の一覧から探す', () => {
		const custom = [{ number: 1, start: '08:50', end: '10:20' }];
		expect(findPeriod(1, custom)).toEqual(custom[0]);
	});
});

describe('DEFAULT_PERIODS', () => {
	it('時限は 1 から順に並び、前の時限が終わってから次が始まる', () => {
		DEFAULT_PERIODS.forEach((period, index) => {
			expect(period.number).toBe(index + 1);
			expect(period.start < period.end).toBe(true);
			const previous = DEFAULT_PERIODS[index - 1];
			if (previous) expect(previous.end < period.start).toBe(true);
		});
	});
});
