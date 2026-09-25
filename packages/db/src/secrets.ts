// DB に保存する秘密情報の暗号化と、URL などに使うトークンの発行。node:crypto だけを使う。
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** 暗号文の形式の版。形式を変えたときに古いものと見分ける */
const VERSION = 'v1';

export interface SecretBox {
	/** 暗号化して、DB に保存できる文字列にする */
	encrypt(plaintext: string): string;
	/** 元に戻す。書き換えられていたり、鍵が違ったりしたら例外を投げる */
	decrypt(encrypted: string): string;
}

/**
 * Webhook の URL や HOPE の URL を暗号化する入れ物を作る (AES-256-GCM)。
 * @param keyBase64 32 バイトの鍵を Base64 にしたもの。環境変数 ENCRYPTION_KEY に置く
 */
export function createSecretBox(keyBase64: string): SecretBox {
	const key = Buffer.from(keyBase64, 'base64');
	if (key.length !== KEY_BYTES) {
		throw new Error(`暗号化の鍵は ${KEY_BYTES} バイトにしてください (今は ${key.length} バイト)`);
	}
	return {
		encrypt(plaintext) {
			const iv = randomBytes(IV_BYTES);
			const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
			const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
			const tag = cipher.getAuthTag();
			return [VERSION, iv, ciphertext, tag]
				.map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
				.join('.');
		},
		decrypt(encrypted) {
			const [version, iv, ciphertext, tag, ...rest] = encrypted.split('.');
			if (version !== VERSION || !iv || ciphertext === undefined || !tag || rest.length > 0) {
				throw new Error('暗号文の形式が違います');
			}
			const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'), {
				authTagLength: TAG_BYTES,
			});
			decipher.setAuthTag(Buffer.from(tag, 'base64url'));
			return Buffer.concat([
				decipher.update(Buffer.from(ciphertext, 'base64url')),
				decipher.final(),
			]).toString('utf8');
		},
	};
}

/** 暗号化の鍵を作る。`funmary-admin init` が使う */
export function generateEncryptionKey(): string {
	return randomBytes(KEY_BYTES).toString('base64');
}

/** ICS やフィードの URL、共有リンク、招待コード、セッション ID に使う 32 バイトの乱数 */
export function generateToken(): string {
	return randomBytes(32).toString('base64url');
}

/** トークンの SHA-256。DB にはトークンそのものでなく、これだけを保存する */
export function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}
