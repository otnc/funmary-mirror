import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAuthService,
	openFlow,
	sealFlow,
	type GoogleClaims,
	type LoginFlow,
	type OidcClient,
} from '@funmary/auth';
import { createAuthStore, openDatabase, type AuthStore, type Database } from '@funmary/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './app.ts';

const ORIGIN = 'https://funmary.example.com';
const KEY = randomBytes(32);

let dir: string;
let database: Database;
let store: AuthStore;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-auth-routes-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
	store = createAuthStore(database);
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const CLAIMS: GoogleClaims = {
	sub: 'g-1',
	email: 'taro@fun.ac.jp',
	emailVerified: true,
	hd: 'fun.ac.jp',
};

function makeApi(
	options: { claims?: GoogleClaims | Error; registration?: 'invite' | 'open' } = {},
) {
	const claims = options.claims ?? CLAIMS;
	const oidc: OidcClient = {
		createAuthorization: () =>
			Promise.resolve({
				url: 'https://accounts.example/auth?x=1',
				state: 'state-1',
				nonce: 'nonce-1',
				codeVerifier: 'verifier-1',
			}),
		exchange: () => (claims instanceof Error ? Promise.reject(claims) : Promise.resolve(claims)),
	};
	const service = createAuthService({
		oidc,
		store,
		allowedDomains: ['fun.ac.jp'],
		registration: options.registration ?? 'open',
		adminEmails: [],
	});
	return createApi({
		checkHealth: () => true,
		auth: {
			service,
			deleteSession: (token) => store.deleteSession(token),
			flowKey: KEY,
			origin: ORIGIN,
		},
	});
}

/** 応答の Set-Cookie から、名前ごとの値と属性を取り出す */
function cookies(res: Response): Map<string, { value: string; attributes: string }> {
	const result = new Map<string, { value: string; attributes: string }>();
	for (const line of res.headers.getSetCookie()) {
		const [pair = '', ...rest] = line.split('; ');
		const eq = pair.indexOf('=');
		result.set(pair.slice(0, eq), { value: pair.slice(eq + 1), attributes: rest.join('; ') });
	}
	return result;
}

const flowNow = (): LoginFlow => ({
	state: 'state-1',
	nonce: 'nonce-1',
	codeVerifier: 'verifier-1',
	inviteCode: null,
	startedAt: Date.now(),
});

describe('GET /auth/google', () => {
	it('Google の認可の URL に転送し、途中の値を暗号化した Cookie に預ける', async () => {
		const res = await makeApi().request('/auth/google');
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('https://accounts.example/auth?x=1');
		const flow = cookies(res).get('__Secure-funmary_login')!;
		expect(flow.attributes).toContain('HttpOnly');
		expect(flow.attributes).toContain('Secure');
		expect(flow.attributes).toContain('SameSite=Lax');
		expect(flow.attributes).toContain('Path=/auth/google');
		expect(flow.attributes).toContain('Max-Age=600');
		expect(flow.value).not.toContain('verifier-1');
		expect(openFlow(decodeURIComponent(flow.value), KEY)).toMatchObject({
			state: 'state-1',
			codeVerifier: 'verifier-1',
			inviteCode: null,
		});
	});
});

describe('GET /signup', () => {
	it('有効な招待コードなら、コードを Cookie の中に持ったまま Google に進む', async () => {
		const code = store.createInviteCode({ maxUses: 1 }, new Date());
		const res = await makeApi({ registration: 'invite' }).request(`/signup?code=${code}`);
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('https://accounts.example/auth?x=1');
		const flow = openFlow(
			decodeURIComponent(cookies(res).get('__Secure-funmary_login')!.value),
			KEY,
		);
		expect(flow?.inviteCode).toBe(code);
	});

	it('知らないコードは、Google に進まずログイン画面に戻す', async () => {
		const res = await makeApi({ registration: 'invite' }).request('/signup?code=NOPE');
		expect(res.headers.get('Location')).toBe('/login?error=invite-unknown');
		expect(cookies(res).size).toBe(0);
	});

	it('コードがなければ、ログイン画面に戻す', async () => {
		const res = await makeApi().request('/signup');
		expect(res.headers.get('Location')).toBe('/login?error=invite-unknown');
	});

	it('使い切ったコードは、その理由を付けて戻す', async () => {
		const code = store.createInviteCode({ maxUses: 1 }, new Date());
		const owner = store.createUser(
			{ googleSub: 'g-0', email: 'a@fun.ac.jp', name: null, role: 'user' },
			new Date(),
		);
		expect(owner).toBeTruthy();
		store.registerUser(
			{ googleSub: 'g-2', email: 'b@fun.ac.jp', name: null, role: 'user' },
			{ inviteCodeId: store.findInviteCode(code)!.id },
			new Date(),
		);
		const res = await makeApi({ registration: 'invite' }).request(`/signup?code=${code}`);
		expect(res.headers.get('Location')).toBe('/login?error=invite-used-up');
	});
});

describe('GET /auth/google/callback', () => {
	const callback = (api: ReturnType<typeof makeApi>, cookie?: string) =>
		api.request('/auth/google/callback?code=c&state=state-1', {
			headers: cookie ? { Cookie: `__Secure-funmary_login=${cookie}` } : {},
		});

	it('ログインできたら、セッションの Cookie を渡して、途中の Cookie を消す', async () => {
		const res = await callback(makeApi(), sealFlow(flowNow(), KEY));
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('/');
		const set = cookies(res);
		const session = set.get('__Host-funmary_session')!;
		expect(session.attributes).toContain('HttpOnly');
		expect(session.attributes).toContain('Secure');
		expect(session.attributes).toContain('SameSite=Lax');
		expect(session.attributes).toContain('Max-Age=2592000');
		expect(store.resolveSession(session.value, new Date())?.email).toBe('taro@fun.ac.jp');
		expect(set.get('__Secure-funmary_login')!.attributes).toContain('Max-Age=0');
	});

	it('途中の Cookie がなければ、ログインを最初からやり直させる', async () => {
		const res = await callback(makeApi());
		expect(res.headers.get('Location')).toBe('/login?error=flow-expired');
		expect(cookies(res).has('__Host-funmary_session')).toBe(false);
	});

	it('書き換えられた Cookie は、受け付けない', async () => {
		const sealed = sealFlow(flowNow(), KEY);
		const tampered = sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA');
		const res = await callback(makeApi(), tampered);
		expect(res.headers.get('Location')).toBe('/login?error=flow-expired');
	});

	it('Google の検証に失敗したら、セッションを渡さず、理由を細かく出さない', async () => {
		const api = makeApi({ claims: new Error('署名が違います') });
		const res = await callback(api, sealFlow(flowNow(), KEY));
		expect(res.headers.get('Location')).toBe('/login?error=invalid-callback');
		expect(cookies(res).has('__Host-funmary_session')).toBe(false);
	});

	it('大学のアカウントでなければ、断る', async () => {
		const api = makeApi({ claims: { sub: 'g-2', email: 'x@example.com', emailVerified: true } });
		const res = await callback(api, sealFlow(flowNow(), KEY));
		expect(res.headers.get('Location')).toMatch(/^\/login\?error=/);
		expect(cookies(res).has('__Host-funmary_session')).toBe(false);
	});
});

describe('POST /auth/logout', () => {
	const login = () => {
		const id = store.createUser(
			{ googleSub: 'g-9', email: 'a@fun.ac.jp', name: null, role: 'user' },
			new Date(),
		);
		return store.createSession(id, new Date());
	};

	it('セッションを DB から消し、Cookie も消す', async () => {
		const token = login();
		const res = await makeApi().request('/auth/logout', {
			method: 'POST',
			headers: { Cookie: `__Host-funmary_session=${token}`, Origin: ORIGIN },
		});
		expect(res.status).toBe(303);
		expect(store.resolveSession(token, new Date())).toBeNull();
		expect(cookies(res).get('__Host-funmary_session')!.attributes).toContain('Max-Age=0');
	});

	it('別のサイトからの送信は、セッションを消さずに断る', async () => {
		const token = login();
		const res = await makeApi().request('/auth/logout', {
			method: 'POST',
			headers: { Cookie: `__Host-funmary_session=${token}`, Origin: 'https://evil.example' },
		});
		expect(res.status).toBe(403);
		expect(store.resolveSession(token, new Date())).not.toBeNull();
	});

	it('GET では、ログアウトしない', async () => {
		const res = await makeApi().request('/auth/logout');
		expect(res.status).toBe(404);
	});
});
