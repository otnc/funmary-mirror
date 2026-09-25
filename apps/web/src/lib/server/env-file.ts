// 環境変数ファイル (.env や /etc/funmary/funmary.env) の中身を書き換える処理。ファイルは読み書きしない。
import { generateKeyPairSync } from 'node:crypto';
import { generateEncryptionKey, generateToken } from '@funmary/db';

/** funmary-admin init が作る鍵の名前 */
export const SECRET_NAMES = [
	'SESSION_SECRET',
	'ENCRYPTION_KEY',
	'VAPID_PUBLIC_KEY',
	'VAPID_PRIVATE_KEY',
] as const;

export type Secrets = Record<(typeof SECRET_NAMES)[number], string>;

/** funmary-admin init が埋める鍵を、新しく作る */
export function generateSecrets(): Secrets {
	// プッシュ通知の VAPID の鍵は P-256 (Web Push の決まり)。公開鍵は非圧縮の点 (0x04 と x と y)
	const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const { x, y } = publicKey.export({ format: 'jwk' });
	const { d } = privateKey.export({ format: 'jwk' });
	if (x === undefined || y === undefined || d === undefined) {
		throw new Error('VAPID の鍵を作れませんでした');
	}
	const point = Buffer.concat([
		Buffer.from([0x04]),
		Buffer.from(x, 'base64url'),
		Buffer.from(y, 'base64url'),
	]);
	return {
		SESSION_SECRET: generateToken(),
		ENCRYPTION_KEY: generateEncryptionKey(),
		VAPID_PUBLIC_KEY: point.toString('base64url'),
		VAPID_PRIVATE_KEY: d,
	};
}

export interface FillResult {
	readonly text: string;
	/** 新しく埋めた鍵の名前 */
	readonly filled: readonly string[];
}

/**
 * 値が空の鍵だけを埋め、行のない鍵は末尾に足す。値のある行、ほかの行、コメント、並び順、改行の形は変えない。
 * 鍵を作り直すと暗号化したデータが読めなくなるので、埋まっている鍵には触れない。
 */
export function fillSecrets(text: string, generate: () => Secrets): FillResult {
	const newline = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(newline);
	const secrets = generate();
	const filled: string[] = [];
	const seen = new Set<string>();

	const replaced = lines.map((line) => {
		const match = /^([A-Z_]+)\s*=(.*)$/.exec(line);
		const name = SECRET_NAMES.find((secret) => secret === match?.[1]);
		if (name === undefined) return line;
		seen.add(name);
		if (match?.[2]?.trim() !== '') return line;
		filled.push(name);
		return `${name}=${secrets[name]}`;
	});

	const missing = SECRET_NAMES.filter((name) => !seen.has(name));
	if (missing.length > 0) {
		// 末尾の改行の後ろに足す。最後の要素が空文字列なら、ファイルは改行で終わっている
		if (replaced.at(-1) === '') replaced.pop();
		for (const name of missing) {
			replaced.push(`${name}=${secrets[name]}`);
			filled.push(name);
		}
		replaced.push('');
	}
	return { text: replaced.join(newline), filled };
}
