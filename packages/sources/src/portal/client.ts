// 学生ポータルにログインして、休講などの一覧 (Pt/CSLecture) の HTML を取得する (設計書 9.1)。
// 外部への通信なので、定期処理からだけ呼ぶ。1 回で行うのは、ログイン画面の取得、ログインの POST、一覧の取得だけ。
// ログインの POST は再試行しない (パスワードが違うときに、繰り返してロックされないようにするため)。
// 通信 (fetch) は差し替えられる。通信の共通の決まりは http.ts にある。
import { createPortalSession, PORTAL_ORIGIN, readHtml, type PortalFetch } from './http.ts';
import { buildLoginBody, parseLoginForm } from './login-form.ts';
import { portalAttemptAllowed } from './throttle.ts';

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

export async function fetchPortalPage(deps: FetchPortalDeps): Promise<FetchPortalResult> {
	const decision = portalAttemptAllowed(deps.lastAttemptAt, deps.now);
	if (!decision.allowed) return { kind: 'throttled', retryAt: decision.retryAt };

	const session = createPortalSession(deps.fetch);
	try {
		const loginPage = await session.request(`${PORTAL_ORIGIN}/Login`);
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

		const posted = await session.request(`${PORTAL_ORIGIN}/Login`, {
			method: 'POST',
			body: buildLoginBody(parsed.form, deps.credentials),
			follow: false,
		});
		// ログインに成功すると、ログイン後の画面への 302 が返る。ログイン画面がそのまま返れば、失敗している
		if (posted.status < 300 || posted.status >= 400) {
			return { kind: 'login-failed', message: 'ログインできませんでした (ID かパスワードの誤り)' };
		}

		const lecture = await session.request(`${PORTAL_ORIGIN}/Pt/CSLecture`);
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
