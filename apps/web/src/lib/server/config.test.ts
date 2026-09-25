import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.ts';

/** 開発で必須の値だけをそろえた環境変数。値は形だけ合わせた架空のもの */
function developmentEnv(): Record<string, string | undefined> {
	return {
		SESSION_SECRET: 'x'.repeat(43),
		ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
		VAPID_PUBLIC_KEY: 'B' + 'A'.repeat(86),
		VAPID_PRIVATE_KEY: 'A'.repeat(43),
		VAPID_SUBJECT: 'mailto:admin@funmary.example.com',
		GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
		GOOGLE_CLIENT_SECRET: 'GOCSPX-example',
	};
}

describe('parseConfig', () => {
	it('開発で必須の値がそろえば、残りは既定値で補う', () => {
		const result = parseConfig(developmentEnv());
		expect(result).toMatchObject({
			ok: true,
			config: {
				mode: 'development',
				host: '127.0.0.1',
				port: 28461,
				dataDir: './data',
				allowedEmailDomains: ['fun.ac.jp'],
				registration: 'invite',
				invitesPerUser: 0,
				adminEmails: [],
				sourcesDisabled: [],
				notifyDryRun: true,
				logLevel: 'debug',
				logFormat: 'text',
			},
		});
	});

	it('書いた値を読み、空の値は書かなかったのと同じに扱う', () => {
		const withValues = parseConfig({
			...developmentEnv(),
			HOST: '0.0.0.0',
			PORT: '8080',
			REGISTRATION: 'open',
			LOG_LEVEL: 'warn',
		});
		const withEmpty = parseConfig({
			...developmentEnv(),
			HOST: '',
			PORT: '',
			REGISTRATION: '',
			LOG_LEVEL: '',
		});
		expect(withValues).toMatchObject({
			ok: true,
			config: { host: '0.0.0.0', port: 8080, registration: 'open', logLevel: 'warn' },
		});
		expect(withEmpty).toMatchObject({
			ok: true,
			config: { host: '127.0.0.1', port: 28461, registration: 'invite', logLevel: 'debug' },
		});
	});

	it('DB の置き場所は DATA_DIR、systemd の STATE_DIRECTORY、./data の順に、値のあるものを使う', () => {
		const stateDirectory = '/var/lib/funmary';
		const dataDirOf = (extra: Record<string, string>) => {
			const result = parseConfig({ ...developmentEnv(), ...extra });
			return result.ok ? result.config.dataDir : undefined;
		};
		expect(dataDirOf({ DATA_DIR: '/srv/funmary', STATE_DIRECTORY: stateDirectory })).toBe(
			'/srv/funmary',
		);
		expect(dataDirOf({ DATA_DIR: '', STATE_DIRECTORY: stateDirectory })).toBe(stateDirectory);
		expect(dataDirOf({ DATA_DIR: '' })).toBe('./data');
	});

	it('必須の値が足りなければ、足りない変数をすべてまとめて返す', () => {
		const result = parseConfig({ SESSION_SECRET: '', GOOGLE_CLIENT_ID: '' });
		expect(result.ok).toBe(false);
		expect(result.ok ? [] : result.issues.map((issue) => issue.name).toSorted()).toEqual([
			'ENCRYPTION_KEY',
			'GOOGLE_CLIENT_ID',
			'GOOGLE_CLIENT_SECRET',
			'SESSION_SECRET',
			'VAPID_PRIVATE_KEY',
			'VAPID_PUBLIC_KEY',
			'VAPID_SUBJECT',
		]);
	});

	it('足りない変数には、どう直すかを日本語で添える', () => {
		const result = parseConfig({ ...developmentEnv(), GOOGLE_CLIENT_ID: undefined });
		expect(result).toEqual({
			ok: false,
			issues: [
				{
					name: 'GOOGLE_CLIENT_ID',
					message: expect.stringContaining('Google Cloud Console') as string,
				},
			],
		});
	});

	it('公開 URL とポータルのアカウントは、本番でだけ求める', () => {
		const production = parseConfig({ ...developmentEnv(), NODE_ENV: 'production' });
		expect(production.ok ? [] : production.issues.map((issue) => issue.name).toSorted()).toEqual([
			'ORIGIN',
			'PORTAL_PASSWORD',
			'PORTAL_USER_ID',
		]);

		const complete = parseConfig({
			...developmentEnv(),
			NODE_ENV: 'production',
			ORIGIN: 'https://funmary.example.com',
			PORTAL_USER_ID: 'student',
			PORTAL_PASSWORD: 'password',
		});
		expect(complete).toMatchObject({
			ok: true,
			config: {
				mode: 'production',
				origin: 'https://funmary.example.com',
				portal: { userId: 'student', password: 'password' },
				notifyDryRun: false,
				logLevel: 'info',
			},
		});
	});

	it.each([
		['ORIGIN', 'https://funmary.example.com/', '末尾に / がある'],
		['ORIGIN', 'https://funmary.example.com/app', 'パスがある'],
		['ORIGIN', 'funmary.example.com', 'https:// がない'],
		['PORT', '0', '範囲の外'],
		['PORT', '70000', '範囲の外'],
		['PORT', '80a', '数でない'],
		['ENCRYPTION_KEY', Buffer.alloc(16).toString('base64'), '32 バイトでない'],
		['VAPID_SUBJECT', 'admin@funmary.example.com', 'mailto: がない'],
		['REGISTRATION', 'free', '選べる値でない'],
		['INVITES_PER_USER', '-1', '負の数'],
		['ADMIN_EMAILS', 'admin', 'メールアドレスでない'],
		['ADMIN_DISCORD_WEBHOOK_URL', 'https://example.com/hook', 'Discord の Webhook でない'],
		['HEARTBEAT_URL', 'ftp://hc-ping.com/abc', 'http でない'],
		['NOTIFY_DRY_RUN', 'yes', 'true か false でない'],
		['XFF_DEPTH', '0', '1 以上でない'],
	])('%s に %s と書くと (%s)、その変数の誤りとして返す', (name, value) => {
		const result = parseConfig({ ...developmentEnv(), [name]: value });
		expect(result.ok ? [] : result.issues.map((issue) => issue.name)).toEqual([name]);
	});

	it('カンマ区切りの値は、前後の空白を除き、空の要素を捨てる', () => {
		const result = parseConfig({
			...developmentEnv(),
			ADMIN_EMAILS: ' taro@fun.ac.jp , ,hanako@fun.ac.jp,',
			SOURCES_DISABLED: 'portal, hope',
		});
		expect(result).toMatchObject({
			ok: true,
			config: {
				adminEmails: ['taro@fun.ac.jp', 'hanako@fun.ac.jp'],
				sourcesDisabled: ['portal', 'hope'],
			},
		});
	});

	it('誤りの説明に、書かれていた値を載せない', () => {
		const secrets = {
			ENCRYPTION_KEY: 'short-secret-key',
			SESSION_SECRET: 'tiny-secret',
			ADMIN_DISCORD_WEBHOOK_URL: 'https://example.com/secret-hook',
			PORTAL_PASSWORD: 'p@ss',
		};
		const result = parseConfig({ ...developmentEnv(), ...secrets, PORT: 'secret-port' });
		expect(result.ok).toBe(false);
		const text = JSON.stringify(result);
		for (const secret of [...Object.values(secrets), 'secret-port']) {
			expect(text).not.toContain(secret);
		}
	});
});
