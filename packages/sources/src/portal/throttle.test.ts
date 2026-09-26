import { describe, expect, it } from 'vitest';
import { PORTAL_MIN_INTERVAL_MS, clampPortalInterval, portalAttemptAllowed } from './throttle.ts';

const MINUTE = 60 * 1000;

describe('clampPortalInterval', () => {
	it('間隔の下限は 60 分。それより短く指定しても、60 分になる', () => {
		expect(PORTAL_MIN_INTERVAL_MS).toBe(60 * MINUTE);
		expect(clampPortalInterval(15 * MINUTE)).toBe(60 * MINUTE);
		expect(clampPortalInterval(0)).toBe(60 * MINUTE);
		expect(clampPortalInterval(-1)).toBe(60 * MINUTE);
	});

	it('下限より長い間隔は、そのまま使う', () => {
		expect(clampPortalInterval(6 * 60 * MINUTE)).toBe(6 * 60 * MINUTE);
	});
});

describe('portalAttemptAllowed', () => {
	const last = new Date('2026-10-01T07:00:00Z');

	it('一度も試していなければ、試してよい', () => {
		expect(portalAttemptAllowed(null, last)).toEqual({ allowed: true });
	});

	it('前回の試行から 60 分たっていなければ、試さず、いつなら試せるかを返す', () => {
		const now = new Date('2026-10-01T07:59:59Z');
		expect(portalAttemptAllowed(last, now)).toEqual({
			allowed: false,
			retryAt: new Date('2026-10-01T08:00:00Z'),
		});
	});

	it('60 分たっていれば、試してよい', () => {
		expect(portalAttemptAllowed(last, new Date('2026-10-01T08:00:00Z'))).toEqual({ allowed: true });
	});

	it('失敗した試行も数える (失敗したからといって、すぐに再試行しない)', () => {
		// 呼ぶ側は、成功でも失敗でも、最後に接続を試みた時刻を渡す
		expect(portalAttemptAllowed(last, new Date('2026-10-01T07:15:00Z')).allowed).toBe(false);
	});
});
