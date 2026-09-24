import { describe, expect, it } from 'vitest';
import { formatPeriod } from './period-label.ts';

describe('formatPeriod', () => {
	it('時限の番号と時刻を 1 行にする', () => {
		expect(formatPeriod({ number: 3, start: '13:10', end: '14:40' })).toBe('3 限 13:10-14:40');
	});
});
