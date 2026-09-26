// 内閣府の祝日の CSV を取得する (設計書 10 章)。週 1 回、ETag を付けて取得し、変わったときだけ取り込む。
// 外部への通信は、定期処理からだけ呼ぶ。fetch は差し替えられる (テストと、通信の制御のため)。
import { decodeHolidayCsv, parseHolidayCsv, type Holiday } from './parse.ts';

export const HOLIDAY_CSV_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';

/** 外部の応答が遅いときに待つ時間 (設計書 4.5) */
const TIMEOUT_MS = 15_000;

export interface FetchHolidaysDeps {
	readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
	/** 前回の取得で得た ETag */
	readonly etag?: string | null;
}

export type FetchHolidaysResult =
	| {
			readonly kind: 'updated';
			readonly holidays: readonly Holiday[];
			readonly skipped: number;
			readonly etag: string | null;
	  }
	| { readonly kind: 'not-modified' }
	| { readonly kind: 'failed'; readonly message: string };

/** 例外は投げず、結果として返す。1 つの取得元の失敗を、ほかの処理に波及させないため (設計書 4.5) */
export async function fetchHolidays(deps: FetchHolidaysDeps): Promise<FetchHolidaysResult> {
	const headers = new Headers();
	if (deps.etag) headers.set('If-None-Match', deps.etag);
	try {
		const response = await deps.fetch(HOLIDAY_CSV_URL, {
			headers,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (response.status === 304) return { kind: 'not-modified' };
		if (!response.ok) {
			return {
				kind: 'failed',
				message: `内閣府の祝日の CSV が HTTP ${response.status} を返しました`,
			};
		}
		const parsed = parseHolidayCsv(decodeHolidayCsv(new Uint8Array(await response.arrayBuffer())));
		if (parsed.kind === 'invalid') {
			return { kind: 'failed', message: `内閣府の祝日の CSV を読めませんでした: ${parsed.reason}` };
		}
		return {
			kind: 'updated',
			holidays: parsed.holidays,
			skipped: parsed.skipped,
			etag: response.headers.get('etag'),
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { kind: 'failed', message: `内閣府の祝日の CSV を取得できませんでした: ${reason}` };
	}
}
