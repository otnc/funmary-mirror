// テスト用の、小さな OpenID Connect のサーバー。Google の代わりに、単体テストと E2E テストで使う。
// 本番のコードからは読み込まない (index.ts から公開しない)。
// 実際に RS256 で署名した ID トークンを返すので、openid-client の署名、state、nonce、PKCE の検証を本物のまま確かめられる。
import {
	createHash,
	createSign,
	generateKeyPairSync,
	randomBytes,
	type KeyObject,
} from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

export interface MockIdentity {
	sub: string;
	email: string;
	email_verified?: boolean;
	hd?: string;
	name?: string;
}

export interface MockOidcOptions {
	clientId: string;
	clientSecret: string;
	/** 0 なら空いているポートを使う */
	port?: number;
}

export interface MockOidcServer {
	/** issuer の URL (末尾の / なし) */
	readonly issuer: string;
	/** 次にログインする人。認可のリクエストが来ると、この人でログインしたことにする */
	setIdentity(identity: MockIdentity): void;
	/** 次に返す ID トークンを、わざと壊す */
	tamper(mode: 'none' | 'wrong-key' | 'wrong-audience' | 'expired' | 'wrong-nonce'): void;
	close(): Promise<void>;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		request.on('error', reject);
	});
}

function signJwt(payload: object, privateKey: KeyObject, kid: string): string {
	const header = { alg: 'RS256', typ: 'JWT', kid };
	const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
	const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
	return `${signingInput}.${b64url(signature)}`;
}

export async function startMockOidcServer(options: MockOidcOptions): Promise<MockOidcServer> {
	const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const kid = 'mock-key-1';
	const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };

	let identity: MockIdentity = { sub: 'mock-sub', email: 'mock@fun.ac.jp', hd: 'fun.ac.jp' };
	let tamper: Parameters<MockOidcServer['tamper']>[0] = 'none';
	/** 認可のコード → 認可のときに受け取った値 */
	const codes = new Map<string, { nonce: string; challenge: string; identity: MockIdentity }>();
	let issuer = '';

	const server: Server = createServer((request, response) => {
		void (async () => {
			const url = new URL(request.url ?? '/', issuer || 'http://localhost');
			const json = (status: number, body: unknown) => {
				response.writeHead(status, { 'content-type': 'application/json' });
				response.end(JSON.stringify(body));
			};

			if (url.pathname === '/.well-known/openid-configuration') {
				return json(200, {
					issuer,
					authorization_endpoint: `${issuer}/authorize`,
					token_endpoint: `${issuer}/token`,
					jwks_uri: `${issuer}/jwks`,
					response_types_supported: ['code'],
					subject_types_supported: ['public'],
					id_token_signing_alg_values_supported: ['RS256'],
					code_challenge_methods_supported: ['S256'],
					token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
				});
			}
			if (url.pathname === '/jwks') return json(200, { keys: [jwk] });

			if (url.pathname === '/authorize') {
				const redirectUri = url.searchParams.get('redirect_uri');
				const state = url.searchParams.get('state');
				const challenge = url.searchParams.get('code_challenge');
				if (
					url.searchParams.get('client_id') !== options.clientId ||
					!redirectUri ||
					!state ||
					!challenge ||
					url.searchParams.get('code_challenge_method') !== 'S256'
				) {
					return json(400, { error: 'invalid_request' });
				}
				const code = randomBytes(16).toString('hex');
				codes.set(code, { nonce: url.searchParams.get('nonce') ?? '', challenge, identity });
				const back = new URL(redirectUri);
				back.searchParams.set('code', code);
				back.searchParams.set('state', state);
				response.writeHead(302, { location: back.toString() });
				return response.end();
			}

			if (url.pathname === '/token' && request.method === 'POST') {
				const form = new URLSearchParams(await readBody(request));
				const basic = request.headers.authorization?.startsWith('Basic ')
					? Buffer.from(request.headers.authorization.slice(6), 'base64').toString('utf8')
					: undefined;
				const [basicId, basicSecret] = basic ? basic.split(':') : [];
				const clientId = form.get('client_id') ?? basicId;
				const clientSecret = form.get('client_secret') ?? basicSecret;
				if (clientId !== options.clientId || clientSecret !== options.clientSecret) {
					return json(401, { error: 'invalid_client' });
				}
				const entry = codes.get(form.get('code') ?? '');
				codes.delete(form.get('code') ?? '');
				const verifier = form.get('code_verifier') ?? '';
				const challenge = createHash('sha256').update(verifier).digest('base64url');
				if (
					form.get('grant_type') !== 'authorization_code' ||
					!entry ||
					challenge !== entry.challenge
				) {
					return json(400, { error: 'invalid_grant' });
				}

				const now = Math.floor(Date.now() / 1000);
				const claims = {
					iss: issuer,
					aud: tamper === 'wrong-audience' ? 'someone-else' : options.clientId,
					sub: entry.identity.sub,
					email: entry.identity.email,
					email_verified: entry.identity.email_verified ?? true,
					...(entry.identity.hd !== undefined && { hd: entry.identity.hd }),
					...(entry.identity.name !== undefined && { name: entry.identity.name }),
					nonce: tamper === 'wrong-nonce' ? 'not-the-nonce' : entry.nonce,
					iat: now,
					exp: tamper === 'expired' ? now - 3600 : now + 3600,
				};
				const signer = tamper === 'wrong-key' ? otherKeys.privateKey : keys.privateKey;
				return json(200, {
					access_token: randomBytes(16).toString('hex'),
					token_type: 'Bearer',
					expires_in: 3600,
					id_token: signJwt(claims, signer, kid),
				});
			}
			json(404, { error: 'not_found' });
		})().catch(() => {
			response.writeHead(500).end();
		});
	});

	await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('ポートを取得できません');
	issuer = `http://127.0.0.1:${address.port}`;

	return {
		issuer,
		setIdentity(next) {
			identity = next;
		},
		tamper(mode) {
			tamper = mode;
		},
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			}),
	};
}
