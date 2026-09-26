// 学生ポータルにログインして、休講などの一覧 (Pt/CSLecture) の HTML を取得する (設計書 9.1)。
// 外部への通信なので、定期処理からだけ呼ぶ。1 回で行うのは、ログイン画面の取得、ログインの POST、一覧の取得だけ。
// ログインの POST は再試行しない (パスワードが違うときに、繰り返してロックされないようにするため)。
// 通信 (fetch) は差し替えられる。リダイレクトは自分でたどり、ポータルのホスト以外へは行かない。
import type { ReadableStreamReadResult } from 'node:stream/web';
import { CookieJar } from 'tough-cookie';
import { buildLoginBody, parseLoginForm } from './login-form.ts';
import { portalAttemptAllowed } from './throttle.ts';

export const PORTAL_ORIGIN = 'https://students.fun.ac.jp';

/** 作者の判断で、一般的なブラウザ (デスクトップの Chrome) のものに合わせる (設計書 9 章) */
const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export type PortalFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchPortalDeps {
	readonly fetch: PortalFetch;
	readonly credentials: { readonly userId: string; readonly password: string };
	/** 前回ポータルに接続を試みた時刻 (成功でも失敗でも)。60 分たつまでは接続しない */
	readonly lastAttemptAt: Date | null;
	readonly now: Date;
}

export type FetchPortalResult =
	| { readonly kind: 'ok'; readonly html: string }
	/** 前回の試みから、下限の時間がたっていない。retryAt 以降に試す */
	| { readonly kind: 'throttled'; readonly retryAt: Date }
	/** ID かパスワードが違う、またはセッションが切れた */
	| { readonly kind: 'login-failed'; readonly message: string }
	/** ログイン画面の形が、読めるものと変わった */
	| { readonly kind: 'structure-changed'; readonly message: string }
	| { readonly kind: 'failed'; readonly message: string };

class PortalError extends Error {}

/** 応答の本文を、大きさの上限を守って文字にする。文字コードは Content-Type と meta charset から決める */
async function readHtml(response: Response): Promise<string> {
	const contentType = response.headers.get('Content-Type') ?? '';
	if (!/^text\/html\b/i.test(contentType)) {
		throw new PortalError('HTML ではない応答が返りました');
	}
	const reader = response.body?.getReader();
	if (!reader) return '';
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const result: ReadableStreamReadResult<Uint8Array> = await reader.read();
		if (result.done) break;
		const value = result.value;
		total += value.byteLength;
		if (total > MAX_BYTES) {
			await reader.cancel();
			throw new PortalError('応答が大きすぎるので、読むのをやめました');
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const header = /charset=([\w-]+)/i.exec(contentType)?.[1];
	const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(
		new TextDecoder('latin1').decode(bytes),
	)?.[1];
	try {
		return new TextDecoder(header ?? meta ?? 'utf-8').decode(bytes);
	} catch {
		return new TextDecoder('utf-8').decode(bytes);
	}
}

/** Cookie を引き継ぎながら、リダイレクトを自分でたどる。ポータルのホスト以外へは行かない */
async function request(
	deps: FetchPortalDeps,
	jar: CookieJar,
	url: string,
	init: { method?: 'GET' | 'POST'; body?: string; follow?: boolean } = {},
): Promise<Response> {
	let current = url;
	let method = init.method ?? 'GET';
	let body = init.body;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		if (new URL(current).origin !== PORTAL_ORIGIN) {
			throw new PortalError('ポータル以外のホストへの移動には、従いません');
		}
		const headers = new Headers({ 'User-Agent': USER_AGENT, Accept: 'text/html' });
		const cookie = await jar.getCookieString(current);
		if (cookie) headers.set('Cookie', cookie);
		if (body !== undefined) headers.set('Content-Type', 'application/x-www-form-urlencoded');
		const response = await deps.fetch(current, {
			method,
			headers,
			redirect: 'manual',
			signal: AbortSignal.timeout(TIMEOUT_MS),
			...(body !== undefined && { body }),
		});
		for (const setCookie of response.headers.getSetCookie()) {
			await jar.setCookie(setCookie, current, { ignoreError: true });
		}
		const location = response.headers.get('Location');
		if (response.status >= 300 && response.status < 400 && location) {
			// ログインの POST だけは、移動先を取りに行かない (1 回の取得で読むページを増やさない)
			if (init.follow === false) return response;
			current = new URL(location, current).toString();
			// POST への 302 と 303 は、GET でたどる (ブラウザと同じ)
			method = 'GET';
			body = undefined;
			continue;
		}
		return response;
	}
	throw new PortalError('リダイレクトが多すぎます');
}

export async function fetchPortalPage(deps: FetchPortalDeps): Promise<FetchPortalResult> {
	const decision = portalAttemptAllowed(deps.lastAttemptAt, deps.now);
	if (!decision.allowed) return { kind: 'throttled', retryAt: decision.retryAt };

	const jar = new CookieJar();
	try {
		const loginPage = await request(deps, jar, `${PORTAL_ORIGIN}/Login`);
		if (!loginPage.ok) {
			return { kind: 'failed', message: `ログイン画面が HTTP ${loginPage.status} を返しました` };
		}
		const parsed = parseLoginForm(await readHtml(loginPage));
		if (parsed.kind === 'invalid') {
			return {
				kind: 'structure-changed',
				message: `ログイン画面の形が変わりました: ${parsed.reason}`,
			};
		}

		const posted = await request(deps, jar, `${PORTAL_ORIGIN}/Login`, {
			method: 'POST',
			body: buildLoginBody(parsed.form, deps.credentials),
			follow: false,
		});
		// ログインに成功すると、ログイン後の画面への 302 が返る。ログイン画面がそのまま返れば、失敗している
		if (posted.status < 300 || posted.status >= 400) {
			return { kind: 'login-failed', message: 'ログインできませんでした (ID かパスワードの誤り)' };
		}

		const lecture = await request(deps, jar, `${PORTAL_ORIGIN}/Pt/CSLecture`);
		if (!lecture.ok) {
			return { kind: 'failed', message: `休講一覧が HTTP ${lecture.status} を返しました` };
		}
		const html = await readHtml(lecture);
		if (parseLoginForm(html).kind === 'ok') {
			return { kind: 'login-failed', message: 'ログインのあと、ログイン画面に戻されました' };
		}
		return { kind: 'ok', html };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { kind: 'failed', message: `ポータルから取得できませんでした: ${reason}` };
	}
}
