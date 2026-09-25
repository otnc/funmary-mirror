import { expect, test } from '@playwright/test';

test('死活監視の /healthz が、DB に読み書きできることを返す', async ({ request }) => {
	const res = await request.get('/healthz');
	expect(res.status()).toBe(200);
	expect(res.headers()['cache-control']).toBe('no-store');
	expect(await res.json()).toEqual({ status: 'ok' });
});
