// 公開シラバスから科目を取り込む定期処理 (設計書 9 章)。毎日動くが、詳細は、未取得の科目と、
// 7 日以上前に取った科目だけ取り直す (実際には週に 1 回ほど、全科目の詳細を取り直す)。
// 新年度のシラバスがまだ公開されていなければ、前年度のものを使い続ける (毎日確かめる)。
import { isSourceDisabled, shouldAttempt, type SourceHealth } from '@funmary/core';
import type { FetchSyllabusResult, SyllabusListRow } from '@funmary/sources';
import { PORTAL_ORIGIN } from '@funmary/sources';
import type { JobDefinition } from './runner.ts';
import { failSource, japanDate, succeedSource, type SourceRun } from './source-run.ts';

/** SOURCES_DISABLED と source_status で使う、取得元の名前 */
export const SYLLABUS_SOURCE = 'syllabus';

/** 詳細を取り直す間隔 */
const DETAIL_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** 次に試すまでの間隔 (失敗のあとの待ちの基準) */
const INTERVAL_MS = 12 * 60 * 60 * 1000;
/** 詳細を取りに行った科目のうち、読めなかったものがこの割合を超えたら、管理者に知らせる */
const FAILED_DETAIL_ALERT_RATIO = 0.2;

export interface ImportSyllabusDeps {
	readonly fetchCatalog: (input: {
		academicYear: number;
		needsDetail: (row: SyllabusListRow) => boolean;
		signal: AbortSignal;
	}) => Promise<FetchSyllabusResult>;
	/** SOURCES_DISABLED */
	readonly disabledSources: readonly string[];
	readonly health: {
		load(source: string): SourceHealth;
		save(source: string, health: SourceHealth): void;
	};
	readonly subjects: {
		updatedAtBySyllabus(academicYear: number): Map<string, Date>;
		upsert(
			input: {
				academicYear: number;
				syllabusId: string;
				name: string;
				teacher: string | null;
				credits: number | null;
				term: string;
				attributes: Record<string, string>;
				syllabus: Record<string, string>;
				syllabusUrl: string | null;
			},
			now: Date,
		): number;
		latestYear(): number | null;
	};
	readonly alert: (alert: {
		severity: 'info' | 'warn' | 'error';
		title: string;
		message?: string;
		key?: string;
	}) => Promise<unknown>;
}

/** Map を、外から来た文字列がキーでも安全な、値の入れ物 (Record) にする */
const toRecord = (map: ReadonlyMap<string, string>): Record<string, string> =>
	Object.fromEntries(map);

export function createImportSyllabusJob(deps: ImportSyllabusDeps): JobDefinition {
	return {
		name: 'import-syllabus',
		// 日本時間の 5 時
		schedule: '0 5 * * *',
		// 全科目の詳細を取り直す日は、2 秒おきに 350 回ほどで、15 分ほどかかる
		timeoutMs: 40 * 60 * 1000,
		jitterMs: 10 * 60 * 1000,
		async run({ now, signal }) {
			const at = now();
			if (isSourceDisabled(deps.disabledSources, SYLLABUS_SOURCE)) {
				return '公開シラバスの取得は、SOURCES_DISABLED で無効にされています';
			}
			const health = deps.health.load(SYLLABUS_SOURCE);
			if (!shouldAttempt(health, at)) {
				return `不調のあとの待ち時間なので、${health.nextAttemptAt?.toISOString() ?? ''} まで待っています`;
			}
			const run: SourceRun = {
				label: '公開シラバス',
				source: SYLLABUS_SOURCE,
				health,
				save: (next) => deps.health.save(SYLLABUS_SOURCE, next),
				alert: deps.alert,
				at,
				intervalMs: INTERVAL_MS,
			};

			const { academicYear } = japanDate(at);
			// 新年度がまだ公開されていなければ、前年度を取り込む
			let notice = '';
			let result: FetchSyllabusResult | undefined;
			let usedYear = academicYear;
			for (const year of [academicYear, academicYear - 1]) {
				const stored = deps.subjects.updatedAtBySyllabus(year);
				result = await deps.fetchCatalog({
					academicYear: year,
					needsDetail: (row) => {
						const updated = stored.get(row.lessonId);
						return !updated || at.getTime() - updated.getTime() >= DETAIL_REFRESH_MS;
					},
					signal,
				});
				usedYear = year;
				if (result.kind !== 'year-unavailable') break;
				notice = `${year} 年度のシラバスは、まだ公開されていません。前年度を使い続けます。`;
			}

			if (!result || result.kind === 'year-unavailable') {
				return failSource(run, '公開シラバスに、今年度と前年度のどちらの科目もありません');
			}
			if (result.kind === 'structure-changed') {
				return failSource(run, result.message, { title: '公開シラバスの画面の形が変わりました' });
			}
			if (result.kind === 'failed') return failSource(run, result.message);

			let saved = 0;
			let fetchedDetails = 0;
			for (const entry of result.entries) {
				if (!entry.detail) continue;
				fetchedDetails++;
				const { detail } = entry;
				deps.subjects.upsert(
					{
						academicYear: usedYear,
						syllabusId: entry.row.lessonId,
						name: detail.name,
						teacher: detail.teacher,
						credits: detail.credits,
						term: detail.term,
						attributes: toRecord(detail.attributes),
						syllabus: toRecord(detail.sections),
						syllabusUrl: `${PORTAL_ORIGIN}/Lesson/Syllabus?lesson_id=${entry.row.lessonId}&year=${usedYear}`,
					},
					at,
				);
				saved++;
			}

			const attempted = fetchedDetails + result.failedDetails;
			if (attempted > 0 && result.failedDetails / attempted > FAILED_DETAIL_ALERT_RATIO) {
				await deps.alert({
					severity: 'warn',
					title: '公開シラバスの詳細を読めない科目が多くなっています',
					message: `${attempted} 件のうち ${result.failedDetails} 件を読めませんでした`,
					key: 'syllabus:detail-failures',
				});
			}
			await succeedSource(run);
			return (
				`${usedYear} 年度: 科目 ${result.entries.length} 件、詳細を取り直したもの ${saved} 件、` +
				`読めなかったもの ${result.failedDetails} 件` +
				(notice ? ` (${notice})` : '')
			);
		},
	};
}
