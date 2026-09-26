// ログインを始めてから戻るまでの間、ブラウザの Cookie に預ける値 (LoginFlow) の暗号化。
// PKCE の code_verifier が入っているので、中身を読まれても、書き換えられてもいけない。AES-256-GCM で封をする。
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as v from 'valibot';
import type { LoginFlow } from './service.ts';

const IV_BYTES = 12;
const TAG_BYTES = 16;

const FlowSchema = v.object({
	state: v.string(),
	nonce: v.string(),
	codeVerifier: v.string(),
	inviteCode: v.nullable(v.string()),
	startedAt: v.number(),
});

/** flow を暗号化し、Cookie に入れられる文字列 (base64url) にする。key は 32 バイト (ENCRYPTION_KEY) */
export function sealFlow(flow: LoginFlow, key: Buffer): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const body = Buffer.concat([cipher.update(JSON.stringify(flow), 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** 封を開ける。鍵が違う、書き換えられている、壊れている場合は、例外にせず null を返す */
export function openFlow(sealed: string, key: Buffer): LoginFlow | null {
	try {
		const raw = Buffer.from(sealed, 'base64url');
		if (raw.length <= IV_BYTES + TAG_BYTES) return null;
		const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
		decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
		const plain = Buffer.concat([
			decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
			decipher.final(),
		]).toString('utf8');
		const parsed = v.safeParse(FlowSchema, JSON.parse(plain));
		return parsed.success ? parsed.output : null;
	} catch {
		return null;
	}
}
