// Google のログインの通し (設計書 21 章)。Google の代わりに、テスト用の OpenID Connect のサーバーを使う。
// サーバーは本物の RS256 で署名した ID トークンを返すので、アプリは本番と同じ手順 (PKCE、state、nonce、署名の検証) を通る。
import { expect, test } from '@playwright/test';
import {
	startMockOidcServer,
	type MockOidcServer,
} from '../../../packages/auth/src/testing/mock-oidc-server.ts';
import { OIDC_PORT } from '../oidc-port.ts';

// サーバーの状態 (次にログインする人) を共有するので、テストは 1 つずつ動かす
test.describe.configure({ mode: 'serial' });

let oidc: MockOidcServer;

test.beforeAll(async () => {
	oidc = await startMockOidcServer({
		clientId: 'e2e.apps.googleusercontent.com',
		clientSecret: 'e2e-client-secret',
		port: OIDC_PORT,
	});
});

test.afterAll(async () => {
	await oidc.close();
});

test.afterEach(() => {
	oidc.tamper('none');
});

test('ログインしていないと、トップページにログインへのリンクが出る', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('link', { name: 'ログイン' })).toBeVisible();
});

test('大学のアカウントでログインでき、ログアウトできる', async ({ page }) => {
	oidc.setIdentity({
		sub: 'e2e-taro',
		email: 'taro@fun.ac.jp',
		email_verified: true,
		hd: 'fun.ac.jp',
		name: '山田 太郎',
	});
	await page.goto('/login');
	await page.getByRole('link', { name: 'Google でログイン' }).click();

	await expect(page).toHaveURL('/');
	await expect(page.getByText('taro@fun.ac.jp でログインしています')).toBeVisible();

	// セッションは HttpOnly の Cookie で、画面の JavaScript から読めない
	const cookies = await page.context().cookies();
	const session = cookies.find((c) => c.name === 'funmary_session');
	expect(session?.httpOnly).toBe(true);
	expect(session?.sameSite).toBe('Lax');
	expect(await page.evaluate(() => document.cookie)).not.toContain('funmary_session');

	// ログイン済みなら、ログインの画面は開かず、トップページに戻る
	await page.goto('/login');
	await expect(page).toHaveURL('/');

	await page.getByRole('button', { name: 'ログアウト' }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByRole('link', { name: 'ログイン' })).toBeVisible();
	expect((await page.context().cookies()).some((c) => c.name === 'funmary_session')).toBe(false);
});

test('大学のアカウントでなければ、ログインできず、理由が出る', async ({ page }) => {
	oidc.setIdentity({ sub: 'e2e-outsider', email: 'someone@example.com', email_verified: true });
	await page.goto('/auth/google');
	await expect(page).toHaveURL(/\/login\?error=/);
	await expect(page.getByRole('alert')).toContainText('大学');
	expect((await page.context().cookies()).some((c) => c.name === 'funmary_session')).toBe(false);
});

test('署名の合わない ID トークンは、受け付けない', async ({ page }) => {
	oidc.setIdentity({
		sub: 'e2e-forged',
		email: 'forged@fun.ac.jp',
		email_verified: true,
		hd: 'fun.ac.jp',
	});
	oidc.tamper('wrong-key');
	await page.goto('/auth/google');
	await expect(page).toHaveURL('/login?error=invalid-callback');
	await expect(page.getByRole('alert')).toBeVisible();
	expect((await page.context().cookies()).some((c) => c.name === 'funmary_session')).toBe(false);
});

test('ログインの途中の Cookie がなければ、やり直しになる', async ({ page }) => {
	await page.goto('/auth/google/callback?code=x&state=y');
	await expect(page).toHaveURL('/login?error=flow-expired');
});

test('知らない理由を URL に書いても、画面には何も出ない', async ({ page }) => {
	await page.goto('/login?error=%3Cscript%3Ealert(1)%3C/script%3E');
	await expect(page.getByRole('alert')).toHaveCount(0);
});
