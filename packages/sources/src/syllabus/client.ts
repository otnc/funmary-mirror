// 公開シラバスから、その年度の全科目を集める (設計書 9 章)。ログインは要らない。
// 流れ: 検索画面を開く → 年度を指定して検索 → ページ送りで一覧を集める → 必要な科目だけ詳細を取る。
// ページ送りは ASP.NET の __doPostBack なので、前のページの hidden の値を送って次のページを頼む。
// 外への通信なので、定期処理からだけ呼ぶ。リクエストの間には待ちを入れ、大学のサーバーに負荷をかけない。
import { createPortalSession, PORTAL_ORIGIN, readHtml, type PortalFetch } from '../portal/http.ts';
import { parseSyllabusDetail, type SyllabusDetail } from './detail.ts';
import {
	parseSearchForm,
	parseSyllabusList,
	type SearchForm,
	type SyllabusListRow,
} from './list.ts';

const LIST_URL = `${PORTAL_ORIGIN}/Lesson/SyllabusList?module=2`;
const GRID_TARGET = 'ctl00$MainContent$GridView';
/** リクエストとリクエストの間に空ける、最短の時間 */
const DEFAULT_INTERVAL_MS = 2000;
/** 暴走を止める上限 (2026 年度は 341 件、18 ページ) */
const MAX_PAGES = 100;
const MAX_ENTRIES = 5000;
/** 集めた件数が、検索結果の件数のこの割合に満たなければ、失敗とみなす */
const MIN_COLLECTED_RATIO = 0.9;

export interface FetchSyllabusDeps {
	readonly fetch: PortalFetch;
	readonly academicYear: number;
	/** 詳細を取る必要があるか。前回の取得から日が浅い科目は、false を返して省く */
	readonly needsDetail: (row: SyllabusListRow) => boolean;
	readonly requestIntervalMs?: number;
	readonly sleep?: (ms: number) => Promise<void>;
	/** 中断の合図。定期処理の締め切りや停止で、abort される */
	readonly signal?: AbortSignal;
}

export interface SyllabusEntry {
	readonly row: SyllabusListRow;
	/** 詳細を取らなかった、または読めなかった場合は null */
	readonly detail: SyllabusDetail | null;
}

export type FetchSyllabusResult =
	| {
			readonly kind: 'ok';
			readonly year: number;
			readonly entries: readonly SyllabusEntry[];
			/** 詳細を取りに行ったが、読めなかった科目の数 */
			readonly failedDetails: number;
	  }
	/** 画面の年度の選択肢に、その年度がない (新年度のシラバスがまだ公開されていない) */
	| { readonly kind: 'year-unavailable'; readonly availableYears: readonly number[] }
	| { readonly kind: 'structure-changed'; readonly message: string }
	| { readonly kind: 'failed'; readonly message: string };

class Stop extends Error {}

const form = (entries: Iterable<[string, string]>) => new URLSearchParams([...entries]).toString();

/** 検索やページ送りの POST の本文。hidden の値と、年度を送る */
function searchBody(
	searchForm: SearchForm,
	hidden: ReadonlyMap<string, string>,
	year: number,
	extra: readonly [string, string][],
): string {
	return form([...hidden, [searchForm.yearField, String(year)], ...extra]);
}

export async function fetchSyllabusCatalog(deps: FetchSyllabusDeps): Promise<FetchSyllabusResult> {
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const interval = Math.max(deps.requestIntervalMs ?? DEFAULT_INTERVAL_MS, 0);
	const session = createPortalSession(deps.fetch);
	let first = true;

	/** リクエストの前に、中断の確認と、待ちを入れる (最初の 1 回は待たない) */
	const pace = async () => {
		if (deps.signal?.aborted) throw new Stop('中断されました');
		if (!first) await sleep(interval);
		first = false;
		if (deps.signal?.aborted) throw new Stop('中断されました');
	};
	const get = async (url: string) => {
		await pace();
		const response = await session.request(url);
		if (!response.ok)
			throw new Stop(`HTTP ${response.status} が返りました (${new URL(url).pathname})`);
		return readHtml(response);
	};
	const post = async (body: string) => {
		await pace();
		const response = await session.request(LIST_URL, { method: 'POST', body });
		if (!response.ok) throw new Stop(`検索が HTTP ${response.status} を返しました`);
		return readHtml(response);
	};

	try {
		const searchPage = parseSearchForm(await get(LIST_URL));
		if (searchPage.kind === 'invalid') {
			return {
				kind: 'structure-changed',
				message: `シラバスの検索画面の形が変わりました: ${searchPage.reason}`,
			};
		}
		const searchForm = searchPage.form;
		if (!searchForm.years.includes(deps.academicYear)) {
			return { kind: 'year-unavailable', availableYears: searchForm.years };
		}

		// 検索。学期などは指定せず、その年度の全科目を出す
		let page = parseSyllabusList(
			await post(
				searchBody(searchForm, searchForm.hidden, deps.academicYear, [
					[searchForm.submitField, searchForm.submitValue],
				]),
			),
		);
		if (page.kind === 'invalid') {
			return {
				kind: 'structure-changed',
				message: `シラバスの検索結果の形が変わりました: ${page.reason}`,
			};
		}

		const total = page.total;
		const rows = new Map<string, SyllabusListRow>();
		for (const row of page.rows) rows.set(row.lessonId, row);
		const perPage = Math.max(page.rows.length, 1);
		const pageCount = Math.min(Math.ceil(total / perPage), MAX_PAGES);
		for (let number = 2; number <= pageCount; number++) {
			const previous = page;
			const next = parseSyllabusList(
				await post(
					searchBody(searchForm, previous.hidden, deps.academicYear, [
						['__EVENTTARGET', GRID_TARGET],
						['__EVENTARGUMENT', `Page$${number}`],
					]),
				),
			);
			if (next.kind === 'invalid') {
				return {
					kind: 'structure-changed',
					message: `${number} ページ目の形が変わりました: ${next.reason}`,
				};
			}
			for (const row of next.rows) rows.set(row.lessonId, row);
			if (rows.size > MAX_ENTRIES) return { kind: 'failed', message: '科目の数が多すぎます' };
			page = next;
		}
		if (rows.size < total * MIN_COLLECTED_RATIO) {
			return {
				kind: 'failed',
				message: `検索結果は ${total} 件ですが、${rows.size} 件しか集まりませんでした`,
			};
		}

		const entries: SyllabusEntry[] = [];
		let failedDetails = 0;
		for (const row of rows.values()) {
			if (!deps.needsDetail(row)) {
				entries.push({ row, detail: null });
				continue;
			}
			const url = `${PORTAL_ORIGIN}/Lesson/Syllabus?lesson_id=${encodeURIComponent(row.lessonId)}&year=${row.year}`;
			try {
				const parsed = parseSyllabusDetail(await get(url));
				if (parsed.kind === 'ok') entries.push({ row, detail: parsed.detail });
				else {
					failedDetails++;
					entries.push({ row, detail: null });
				}
			} catch (error) {
				// 中断は、そのまま止める。1 科目の通信の失敗は、数えて続ける
				if (error instanceof Stop && error.message === '中断されました') throw error;
				failedDetails++;
				entries.push({ row, detail: null });
			}
		}
		return { kind: 'ok', year: deps.academicYear, entries, failedDetails };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { kind: 'failed', message: `公開シラバスから取得できませんでした: ${reason}` };
	}
}
