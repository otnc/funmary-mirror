import { describe, expect, it } from 'vitest';
import { createApi } from './app.ts';

describe('GET /healthz', () => {
	it('DB に読み書きできれば 200 を返す', async () => {
		const api = createApi({ checkHealth: () => true });
		const res = await api.request('/healthz');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: 'ok' });
	});

	it('DB に読み書きできなければ 503 を返し、本文に内部の情報を出さない', async () => {
		const api = createApi({
			checkHealth: () => {
				throw new Error('SQLITE_READONLY: /var/lib/funmary/funmary.db');
			},
		});
		const res = await api.request('/healthz');
		expect(res.status).toBe(503);
		const body = await res.text();
		expect(JSON.parse(body)).toEqual({ status: 'unavailable' });
		expect(body).not.toContain('funmary.db');
	});

	it('監視の結果が古いものにならないよう、キャッシュさせない', async () => {
		const api = createApi({ checkHealth: () => true });
		const res = await api.request('/healthz');
		expect(res.headers.get('Cache-Control')).toBe('no-store');
	});
});
