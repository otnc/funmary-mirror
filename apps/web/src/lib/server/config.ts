// 環境変数を読み、型の付いた設定にする。ファイルは読まない (.env は入口で読み込む)。
// 誤りの説明には、受け取った値を載せない。パスワードや鍵がログに残らないようにするため。
import * as v from 'valibot';

export type Mode = 'production' | 'development';

export interface Config {
	readonly mode: Mode;
	/** 公開 URL (例: https://funmary.example.com)。本番では必ずある */
	readonly origin: string | undefined;
	readonly host: string;
	readonly port: number;
	readonly dataDir: string;
	readonly sessionSecret: string;
	/** 32 バイトの鍵を Base64 にしたもの */
	readonly encryptionKey: string;
	readonly vapid: {
		readonly publicKey: string;
		readonly privateKey: string;
		/** プッシュのサービス (Google、Mozilla、Apple) に伝える連絡先。ないときはプッシュ通知を止める */
		readonly subject: string | undefined;
	};
	readonly google: {
		readonly clientId: string;
		readonly clientSecret: string;
		/** Google の代わりのサーバー (E2E テスト用)。ないときは Google */
		readonly issuer: string | undefined;
	};
	readonly allowedEmailDomains: readonly string[];
	readonly registration: 'invite' | 'open' | 'closed';
	readonly invitesPerUser: number;
	readonly adminEmails: readonly string[];
	/** 学生ポータルのアカウント。本番では必ずある */
	readonly portal: { readonly userId: string; readonly password: string } | undefined;
	readonly sourcesDisabled: readonly string[];
	readonly sourcesFixtureDir: string | undefined;
	/** メールの送信。SMTP_URL が空ならない */
	readonly smtp: { readonly url: string; readonly from: string } | undefined;
	readonly adminDiscordWebhookUrl: string | undefined;
	readonly notifyDryRun: boolean;
	readonly heartbeatUrl: string | undefined;
	readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
	readonly logFormat: 'text' | 'json';
	/** リバースプロキシ経由で利用者の IP アドレスを得るための設定 */
	readonly proxy: { readonly addressHeader: string; readonly xffDepth: number } | undefined;
}

export interface ConfigIssue {
	/** 直すべき環境変数の名前 */
	readonly name: string;
	/** どう直すか。秘密の値は載せない */
	readonly message: string;
}

export type ConfigResult =
	| { readonly ok: true; readonly config: Config }
	| { readonly ok: false; readonly issues: readonly ConfigIssue[] };

/** 必ず書く値。書かれていなければ、hint を添えて知らせる */
function required(hint: string) {
	return v.string(`書かれていません。${hint}`);
}

/** 本番でだけ必ず書く値 */
function requiredInProduction<T extends v.GenericSchema<string, unknown>>(
	mode: Mode,
	schema: T,
	hint: string,
) {
	return mode === 'production'
		? v.pipe(required(`本番では必須です。${hint}`), schema)
		: v.optional(schema);
}

/** 列挙の値のどれかを受け付ける。書かれていなければ fallback を使う */
function oneOf<const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
	return v.optional(v.picklist(values, `${values.join('、')} のどれかを書いてください`), fallback);
}

/** min 以上 max 以下の整数 */
function integer(min: number, max: number) {
	const message = `${min} から ${max} までの整数を書いてください`;
	return v.pipe(
		v.string(),
		v.regex(/^\d+$/, message),
		v.transform(Number),
		v.minValue(min, message),
		v.maxValue(max, message),
	);
}

/** カンマ区切りの一覧。前後の空白を除き、空の要素は捨てる */
function commaList<T extends v.GenericSchema<string, string>>(item?: T) {
	return v.pipe(
		v.string(),
		v.transform((value) =>
			value
				.split(',')
				.map((part) => part.trim())
				.filter((part) => part !== ''),
		),
		v.array(item ?? v.string()),
	);
}

function httpUrl(message: string) {
	return v.pipe(
		v.string(),
		v.check((value) => URL.canParse(value) && /^https?:$/.test(new URL(value).protocol), message),
	);
}

const EMAIL = v.pipe(
	v.string(),
	v.regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'メールアドレスをカンマ区切りで書いてください'),
);
const DOMAIN = v.pipe(
	v.string(),
	v.regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'ドメインをカンマ区切りで書いてください (例: fun.ac.jp)'),
);

const ORIGIN_HINT =
	'https:// とドメインだけを書き、末尾の / やパスは付けないでください (例: https://funmary.example.com)';

function origin(mode: Mode) {
	return v.pipe(
		v.string(),
		v.check((value) => {
			if (!URL.canParse(value)) return false;
			const url = new URL(value);
			// 本番は https:// だけ。ただし手元で本番の形を試すとき (E2E テストなど) の localhost は http:// も許す
			const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
			const allowed =
				url.protocol === 'https:' ||
				(url.protocol === 'http:' && (mode === 'development' || local));
			// URL にすると末尾に / が付くので、元の文字列と比べてパスや / の有無を確かめる
			return allowed && url.origin === value;
		}, ORIGIN_HINT),
	);
}

const BY_INIT = 'pnpm funmary-admin init (本番では funmary-admin init) で作れます';

function envSchema(mode: Mode) {
	return v.object({
		ORIGIN: requiredInProduction(mode, origin(mode), ORIGIN_HINT),
		HOST: v.optional(v.string(), '127.0.0.1'),
		PORT: v.optional(integer(1, 65535), '28461'),
		DATA_DIR: v.optional(v.string()),
		STATE_DIRECTORY: v.optional(v.string()),
		SESSION_SECRET: v.pipe(
			required(BY_INIT),
			v.minLength(32, `32 文字以上にしてください。${BY_INIT}`),
		),
		ENCRYPTION_KEY: v.pipe(
			required(BY_INIT),
			v.check(
				(value) =>
					/^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').length === 32,
				`32 バイトの鍵を Base64 で書いてください。${BY_INIT}`,
			),
		),
		VAPID_PUBLIC_KEY: required(BY_INIT),
		VAPID_PRIVATE_KEY: required(BY_INIT),
		// 空なら公開 URL (ORIGIN) を使う
		VAPID_SUBJECT: v.optional(
			v.pipe(
				v.string(),
				v.regex(
					/^(mailto:|https:\/\/)/,
					'mailto: のメールアドレスか https:// の URL を書いてください。空なら ORIGIN を使います',
				),
			),
		),
		GOOGLE_CLIENT_ID: required(
			'Google Cloud Console で作った OAuth クライアントの ID を書いてください',
		),
		GOOGLE_CLIENT_SECRET: required(
			'Google Cloud Console で作った OAuth クライアントのシークレットを書いてください',
		),
		// E2E テストで、Google の代わりのサーバーに向けるための設定。本番では書かない
		OIDC_ISSUER: v.optional(httpUrl('http:// か https:// で始まる URL を書いてください')),
		ALLOWED_EMAIL_DOMAINS: v.optional(commaList(DOMAIN), 'fun.ac.jp'),
		REGISTRATION: oneOf(['invite', 'open', 'closed'], 'invite'),
		INVITES_PER_USER: v.optional(integer(0, 100), '0'),
		ADMIN_EMAILS: v.optional(commaList(EMAIL), ''),
		PORTAL_USER_ID: requiredInProduction(mode, v.string(), '学生ポータルの ID を書いてください'),
		PORTAL_PASSWORD: requiredInProduction(
			mode,
			v.string(),
			'学生ポータルのパスワードを書いてください',
		),
		SOURCES_DISABLED: v.optional(commaList(), ''),
		SOURCES_FIXTURE_DIR: v.optional(v.string()),
		SMTP_URL: v.optional(
			v.pipe(
				v.string(),
				v.regex(/^smtps?:\/\//, 'smtp:// か smtps:// で始まる URL を書いてください'),
			),
		),
		MAIL_FROM: v.optional(EMAIL),
		ADMIN_DISCORD_WEBHOOK_URL: v.optional(
			v.pipe(
				v.string(),
				v.startsWith(
					'https://discord.com/api/webhooks/',
					'Discord の Webhook の URL (https://discord.com/api/webhooks/ で始まるもの) を書いてください',
				),
			),
		),
		NOTIFY_DRY_RUN: v.optional(
			v.pipe(
				v.picklist(['true', 'false'], 'true か false を書いてください'),
				v.transform((value) => value === 'true'),
			),
		),
		HEARTBEAT_URL: v.optional(httpUrl('https:// で始まる監視サービスの URL を書いてください')),
		LOG_LEVEL: oneOf(['debug', 'info', 'warn', 'error'], mode === 'production' ? 'info' : 'debug'),
		LOG_FORMAT: oneOf(['text', 'json'], 'text'),
		ADDRESS_HEADER: v.optional(v.string()),
		XFF_DEPTH: v.optional(integer(1, 10), '1'),
	});
}

/** 環境変数の入れ物 (process.env など) から設定を作る。足りない値や誤りは、すべてまとめて返す */
export function parseConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
	const mode: Mode = env['NODE_ENV'] === 'production' ? 'production' : 'development';
	// 空の値は、書かなかったのと同じに扱う。.env.example を丸ごと写しても動くようにするため
	// 変数がない場合も、値を undefined にして並べておく。Valibot は、ない変数には既定の英語の説明を付けるが、
	// undefined の値なら変数ごとに書いた説明を使うため
	const schema = envSchema(mode);
	const input = Object.fromEntries(
		Object.keys(schema.entries).map((name) => {
			const value = env[name];
			return [name, value === undefined || value.trim() === '' ? undefined : value];
		}),
	);
	const result = v.safeParse(schema, input);
	const issues: ConfigIssue[] = result.success
		? []
		: result.issues.map((issue) => {
				// path の先頭の key が環境変数の名前になる。一覧の要素の誤りも、変数の名前で返す
				const key = issue.path?.[0]?.key;
				return { name: typeof key === 'string' ? key : '', message: issue.message };
			});
	if (
		result.success &&
		result.output.SMTP_URL !== undefined &&
		result.output.MAIL_FROM === undefined
	) {
		issues.push({
			name: 'MAIL_FROM',
			message: 'SMTP_URL を書いたときは、送信元のメールアドレスも書いてください',
		});
	}
	if (!result.success || issues.length > 0) return { ok: false, issues };

	const e = result.output;
	return {
		ok: true,
		config: {
			mode,
			origin: e.ORIGIN,
			host: e.HOST,
			port: e.PORT,
			dataDir: e.DATA_DIR ?? e.STATE_DIRECTORY ?? './data',
			sessionSecret: e.SESSION_SECRET,
			encryptionKey: e.ENCRYPTION_KEY,
			vapid: {
				publicKey: e.VAPID_PUBLIC_KEY,
				privateKey: e.VAPID_PRIVATE_KEY,
				subject: e.VAPID_SUBJECT ?? e.ORIGIN,
			},
			google: {
				clientId: e.GOOGLE_CLIENT_ID,
				clientSecret: e.GOOGLE_CLIENT_SECRET,
				issuer: e.OIDC_ISSUER,
			},
			allowedEmailDomains: e.ALLOWED_EMAIL_DOMAINS,
			registration: e.REGISTRATION,
			invitesPerUser: e.INVITES_PER_USER,
			adminEmails: e.ADMIN_EMAILS,
			portal:
				e.PORTAL_USER_ID !== undefined && e.PORTAL_PASSWORD !== undefined
					? { userId: e.PORTAL_USER_ID, password: e.PORTAL_PASSWORD }
					: undefined,
			sourcesDisabled: e.SOURCES_DISABLED,
			sourcesFixtureDir: e.SOURCES_FIXTURE_DIR,
			smtp:
				e.SMTP_URL !== undefined && e.MAIL_FROM !== undefined
					? { url: e.SMTP_URL, from: e.MAIL_FROM }
					: undefined,
			adminDiscordWebhookUrl: e.ADMIN_DISCORD_WEBHOOK_URL,
			notifyDryRun: e.NOTIFY_DRY_RUN ?? mode === 'development',
			heartbeatUrl: e.HEARTBEAT_URL,
			logLevel: e.LOG_LEVEL,
			logFormat: e.LOG_FORMAT,
			proxy:
				e.ADDRESS_HEADER !== undefined
					? { addressHeader: e.ADDRESS_HEADER, xffDepth: e.XFF_DEPTH }
					: undefined,
		},
	};
}
