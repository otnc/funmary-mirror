import { describe, expect, it, vi } from 'vitest';
import { fetchHolidays, HOLIDAY_CSV_URL } from './fetch.ts';

/** Shift_JIS ではなく ASCII だけで書いたテスト用の CSV (ASCII は Shift_JIS でも同じバイト列) */
function csvBytes(rows: string[]): Uint8Array {
	return new TextEncoder().encode(['date,name', ...rows].join('\n'));
}

type Body = ConstructorParameters<typeof Response>[0];

function response(body: Body, init: ResponseInit = {}) {
	return Promise.resolve(new Response(body, init));
}

describe('fetchHolidays', () => {
	it('取得して解析し、ETag を返す', async () => {
		const fetchMock = vi.fn(() =>
			response(csvBytes(['2026/1/1,New Year']), { headers: { etag: '"v1"' } }),
		);
		const result = await fetchHolidays({ fetch: fetchMock });
		expect(result).toEqual({
			kind: 'updated',
			holidays: [{ date: '2026-01-01', name: 'New Year' }],
			skipped: 0,
			etag: '"v1"',
		});
		expect(fetchMock).toHaveBeenCalledWith(HOLIDAY_CSV_URL, expect.anything());
	});

	it('前回の ETag を If-None-Match で送り、304 なら変わっていないと返す', async () => {
		const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
			expect(new Headers(init?.headers).get('if-none-match')).toBe('"v1"');
			return response(null, { status: 304 });
		});
		expect(await fetchHolidays({ fetch: fetchMock, etag: '"v1"' })).toEqual({
			kind: 'not-modified',
		});
	});

	it('前回の ETag がなければ If-None-Match を付けない', async () => {
		const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
			expect(new Headers(init?.headers).has('if-none-match')).toBe(false);
			return response(csvBytes(['2026/1/1,x']));
		});
		const result = await fetchHolidays({ fetch: fetchMock });
		expect(result).toMatchObject({ kind: 'updated', etag: null });
	});

	it('500 番台や 404 は失敗として返す', async () => {
		for (const status of [404, 500, 503]) {
			const result = await fetchHolidays({ fetch: () => response('x', { status }) });
			expect(result).toMatchObject({ kind: 'failed' });
			expect((result as { message: string }).message).toContain(String(status));
		}
	});

	it('通信のエラーやタイムアウトは、例外にせず失敗として返す', async () => {
		const result = await fetchHolidays({
			fetch: () => Promise.reject(new TypeError('fetch failed')),
		});
		expect(result.kind).toBe('failed');
		expect((result as { message: string }).message).toContain('fetch failed');
	});

	it('祝日として読めない内容 (エラーの HTML など) は、取り込まずに失敗として返す', async () => {
		const result = await fetchHolidays({
			fetch: () => response('<html>maintenance</html>', { headers: { etag: '"bad"' } }),
		});
		expect(result).toMatchObject({ kind: 'failed' });
	});
});
