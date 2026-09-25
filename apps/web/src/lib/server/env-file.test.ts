import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.ts';
import { fillSecrets, generateSecrets } from './env-file.ts';

/** 毎回同じ値を返す、テスト用の鍵の作り方 */
const fixedSecrets = () => ({
	SESSION_SECRET: 'session',
	ENCRYPTION_KEY: 'encryption',
	VAPID_PUBLIC_KEY: 'public',
	VAPID_PRIVATE_KEY: 'private',
});

describe('fillSecrets', () => {
	it('空の鍵だけを埋め、ほかの行とコメントはそのまま残す', () => {
		const text = [
			'# 鍵',
			'SESSION_SECRET=',
			'ENCRYPTION_KEY=already-set',
			'VAPID_PUBLIC_KEY=',
			'VAPID_PRIVATE_KEY=',
			'',
			'# Google',
			'GOOGLE_CLIENT_ID=client-id',
			'',
		].join('\n');

		const result = fillSecrets(text, fixedSecrets);

		expect(result.text).toBe(
			[
				'# 鍵',
				'SESSION_SECRET=session',
				'ENCRYPTION_KEY=already-set',
				'VAPID_PUBLIC_KEY=public',
				'VAPID_PRIVATE_KEY=private',
				'',
				'# Google',
				'GOOGLE_CLIENT_ID=client-id',
				'',
			].join('\n'),
		);
		expect(result.filled).toEqual(['SESSION_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']);
	});

	it('行のない鍵は末尾に足し、2 回目は何も変えない', () => {
		const first = fillSecrets('GOOGLE_CLIENT_ID=client-id\n', fixedSecrets);
		expect(first.text).toBe(
			[
				'GOOGLE_CLIENT_ID=client-id',
				'SESSION_SECRET=session',
				'ENCRYPTION_KEY=encryption',
				'VAPID_PUBLIC_KEY=public',
				'VAPID_PRIVATE_KEY=private',
				'',
			].join('\n'),
		);

		const second = fillSecrets(first.text, () => ({
			SESSION_SECRET: 'other',
			ENCRYPTION_KEY: 'other',
			VAPID_PUBLIC_KEY: 'other',
			VAPID_PRIVATE_KEY: 'other',
		}));
		expect(second).toEqual({ text: first.text, filled: [] });
	});

	it('Windows の改行 (CRLF) を保ち、空白だけの値も空として埋める', () => {
		const text =
			'SESSION_SECRET= \r\nENCRYPTION_KEY=\r\nVAPID_PUBLIC_KEY=x\r\nVAPID_PRIVATE_KEY=y\r\n';
		expect(fillSecrets(text, fixedSecrets)).toEqual({
			text: 'SESSION_SECRET=session\r\nENCRYPTION_KEY=encryption\r\nVAPID_PUBLIC_KEY=x\r\nVAPID_PRIVATE_KEY=y\r\n',
			filled: ['SESSION_SECRET', 'ENCRYPTION_KEY'],
		});
	});
});

describe('generateSecrets', () => {
	it('作った鍵は、起動時の設定の検査に通る', () => {
		const result = parseConfig({
			...generateSecrets(),
			VAPID_SUBJECT: 'mailto:admin@funmary.example.com',
			GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
			GOOGLE_CLIENT_SECRET: 'GOCSPX-example',
		});
		expect(result.ok ? [] : result.issues).toEqual([]);
	});

	it('VAPID の公開鍵は P-256 の非圧縮の形 (65 バイト、先頭が 0x04)、秘密鍵は 32 バイトにする', () => {
		const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = generateSecrets();
		const publicKey = Buffer.from(VAPID_PUBLIC_KEY, 'base64url');
		expect(publicKey).toHaveLength(65);
		expect(publicKey[0]).toBe(0x04);
		expect(Buffer.from(VAPID_PRIVATE_KEY, 'base64url')).toHaveLength(32);
	});

	it('毎回違う鍵を作る', () => {
		const first = generateSecrets();
		const second = generateSecrets();
		for (const name of Object.keys(first) as (keyof typeof first)[]) {
			expect(second[name]).not.toBe(first[name]);
		}
	});
});
