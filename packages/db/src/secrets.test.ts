import { describe, expect, it } from 'vitest';
import { createSecretBox, generateEncryptionKey, generateToken, hashToken } from './secrets.ts';

describe('createSecretBox', () => {
	const key = generateEncryptionKey();

	it('暗号化したものを同じ鍵で元に戻せる。同じ文でも毎回違う暗号文になる', () => {
		const box = createSecretBox(key);
		const url = 'https://discord.com/api/webhooks/123/abc';
		const first = box.encrypt(url);
		const second = box.encrypt(url);
		expect(first).not.toBe(second);
		expect(first).not.toContain('discord');
		expect(box.decrypt(first)).toBe(url);
		expect(box.decrypt(second)).toBe(url);
	});

	it('暗号文が書き換えられていたら、元に戻さずに失敗する', () => {
		const box = createSecretBox(key);
		const encrypted = box.encrypt('秘密の URL');
		const tampered = encrypted.slice(0, -2) + (encrypted.endsWith('A') ? 'BB' : 'AA');
		expect(() => box.decrypt(tampered)).toThrow();
	});

	it('別の鍵では元に戻せない', () => {
		const encrypted = createSecretBox(key).encrypt('秘密の URL');
		expect(() => createSecretBox(generateEncryptionKey()).decrypt(encrypted)).toThrow();
	});

	it('32 バイトでない鍵は受け付けない', () => {
		expect(() => createSecretBox(Buffer.alloc(16).toString('base64'))).toThrow(/32/);
	});
});

describe('generateToken と hashToken', () => {
	it('トークンは URL にそのまま入る形で、毎回違う', () => {
		const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
		expect(tokens.size).toBe(100);
		for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('ハッシュは SHA-256 の 16 進数で、同じトークンなら同じになる', () => {
		expect(hashToken('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
		expect(hashToken('abc')).toBe(hashToken('abc'));
	});
});
