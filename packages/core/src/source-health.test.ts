import { describe, expect, it } from 'vitest';
import {
	INITIAL_SOURCE_HEALTH,
	isSourceDisabled,
	isUnhealthy,
	recordFailure,
	recordSuccess,
	shouldAttempt,
	type SourceHealth,
} from './source-health.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const at = (iso: string) => new Date(iso);
const options = { intervalMs: HOUR };

/** n 回続けて失敗した状態を作る。1 分ずつ後の時刻に記録する */
function failTimes(n: number, health: SourceHealth = INITIAL_SOURCE_HEALTH) {
	let current = health;
	let becameUnhealthy = false;
	for (let i = 0; i < n; i++) {
		const result = recordFailure(current, at(`2026-09-26T00:0${i}:00Z`), 'つながらない', options);
		current = result.health;
		becameUnhealthy ||= result.becameUnhealthy;
	}
	return { health: current, becameUnhealthy };
}

describe('recordSuccess', () => {
	it('最終成功時刻を残し、失敗の回数を 0 に戻し、次は通常の間隔にする', () => {
		const { health } = failTimes(2);
		const result = recordSuccess(health, at('2026-09-26T01:00:00Z'), options);
		expect(result.health).toMatchObject({
			consecutiveFailures: 0,
			lastSuccessAt: at('2026-09-26T01:00:00Z'),
			lastAttemptAt: at('2026-09-26T01:00:00Z'),
			nextAttemptAt: at('2026-09-26T02:00:00Z'),
			lastError: null,
		});
		expect(result.recovered).toBe(false);
	});

	it('不調から成功に戻ったときは recovered にする', () => {
		const { health } = failTimes(3);
		expect(recordSuccess(health, at('2026-09-26T05:00:00Z'), options).recovered).toBe(true);
	});

	it('前回の内容の hash は、渡されたときだけ更新し、渡されなければ残す', () => {
		const first = recordSuccess(INITIAL_SOURCE_HEALTH, at('2026-09-26T00:00:00Z'), {
			...options,
			contentHash: 'abc',
		});
		expect(first.health.contentHash).toBe('abc');
		const second = recordSuccess(first.health, at('2026-09-26T01:00:00Z'), options);
		expect(second.health.contentHash).toBe('abc');
	});
});

describe('recordFailure', () => {
	it('失敗を数え、最後の試行の時刻とエラーを残す。最終成功時刻は変えない', () => {
		const success = recordSuccess(INITIAL_SOURCE_HEALTH, at('2026-09-25T00:00:00Z'), options);
		const { health } = recordFailure(
			success.health,
			at('2026-09-26T00:00:00Z'),
			'HTTP 500',
			options,
		);
		expect(health).toMatchObject({
			consecutiveFailures: 1,
			lastSuccessAt: at('2026-09-25T00:00:00Z'),
			lastAttemptAt: at('2026-09-26T00:00:00Z'),
			lastError: 'HTTP 500',
		});
	});

	it('2 回目までは不調にせず、通常の間隔 (または retryMs) で次を試す', () => {
		const one = recordFailure(INITIAL_SOURCE_HEALTH, at('2026-09-26T00:00:00Z'), 'x', options);
		expect(one.health.nextAttemptAt).toEqual(at('2026-09-26T01:00:00Z'));
		expect(isUnhealthy(one.health)).toBe(false);
		const withRetry = recordFailure(INITIAL_SOURCE_HEALTH, at('2026-09-26T00:00:00Z'), 'x', {
			intervalMs: HOUR,
			retryMs: 15 * MINUTE,
		});
		expect(withRetry.health.nextAttemptAt).toEqual(at('2026-09-26T00:15:00Z'));
	});

	it('3 回続けて失敗したら不調にし、そのとき 1 回だけ becameUnhealthy を返す', () => {
		const two = failTimes(2);
		expect(two.becameUnhealthy).toBe(false);
		const three = recordFailure(two.health, at('2026-09-26T00:02:00Z'), 'x', options);
		expect(three.becameUnhealthy).toBe(true);
		expect(isUnhealthy(three.health)).toBe(true);
		// 不調のまま失敗が続いても、知らせるのは 1 回だけ
		const four = recordFailure(three.health, at('2026-09-26T03:00:00Z'), 'x', options);
		expect(four.becameUnhealthy).toBe(false);
	});

	it('不調の間は、次の試行までの間隔を倍々に広げ、6 時間を上限にする', () => {
		const start = at('2026-09-26T00:00:00Z');
		let health = failTimes(2).health;
		const gaps: number[] = [];
		for (let i = 0; i < 6; i++) {
			const result = recordFailure(health, start, 'x', options);
			health = result.health;
			gaps.push((health.nextAttemptAt!.getTime() - start.getTime()) / HOUR);
		}
		// 3 回目: 2 時間、4 回目: 4 時間、5 回目以降: 6 時間 (上限)
		expect(gaps).toEqual([2, 4, 6, 6, 6, 6]);
	});

	it('エラーの文が長ければ切り詰める', () => {
		const { health } = recordFailure(
			INITIAL_SOURCE_HEALTH,
			at('2026-09-26T00:00:00Z'),
			'あ'.repeat(1000),
			options,
		);
		expect(health.lastError!.length).toBeLessThanOrEqual(300);
	});
});

describe('shouldAttempt', () => {
	it('一度も試していなければ試す', () => {
		expect(shouldAttempt(INITIAL_SOURCE_HEALTH, at('2026-09-26T00:00:00Z'))).toBe(true);
	});

	it('次の試行の時刻になるまでは試さない', () => {
		const { health } = recordFailure(
			INITIAL_SOURCE_HEALTH,
			at('2026-09-26T00:00:00Z'),
			'x',
			options,
		);
		expect(shouldAttempt(health, at('2026-09-26T00:59:59Z'))).toBe(false);
		expect(shouldAttempt(health, at('2026-09-26T01:00:00Z'))).toBe(true);
	});
});

describe('isSourceDisabled', () => {
	it('SOURCES_DISABLED に書かれた取得元だけ止める', () => {
		expect(isSourceDisabled(['portal', 'hope'], 'hope')).toBe(true);
		expect(isSourceDisabled(['portal'], 'syllabus')).toBe(false);
		expect(isSourceDisabled([], 'portal')).toBe(false);
	});
});
