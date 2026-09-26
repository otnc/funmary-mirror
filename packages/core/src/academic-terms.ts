// 学期の期間の決め方 (設計書 10 章)。値は、管理者が入れた値、学年暦から取った値、既定の規則による推定の順に探す。
// 推定するのは前期と後期だけで、1Q から 4Q と集中講義は、保存された値があるときだけ使う。
// I/O は持たない。保存された値は引数で受け取る。
import { addDays, isoWeekday, type CalendarDate } from './calendar-date.ts';
import type { Term, TermPeriod } from './timetable.ts';

/** 値の出どころ。auto は大学の学年暦から自動で取った値、manual は管理画面での入力、estimated は規則による推定 */
export type TermSource = 'auto' | 'manual' | 'estimated';

export interface StoredTerm extends TermPeriod {
	readonly source: Exclude<TermSource, 'estimated'>;
}

export interface ResolvedTerm extends TermPeriod {
	readonly source: TermSource;
}

/** 4 月の第 1 月曜日 */
function firstMondayOfApril(year: number): CalendarDate {
	const first = `${String(year).padStart(4, '0')}-04-01`;
	return addDays(first, (8 - isoWeekday(first)) % 7);
}

/** 9 月の最終月曜日 */
function lastMondayOfSeptember(year: number): CalendarDate {
	const last = `${String(year).padStart(4, '0')}-09-30`;
	return addDays(last, -(isoWeekday(last) - 1));
}

/**
 * 既定の規則による、前期と後期の授業期間 (最後の授業日まで。定期試験は含まない)。
 * 前期は 4 月の第 1 月曜から 15 週と 4 日後の金曜まで、後期は 9 月の最終月曜から 16 週と 3 日後の木曜までとする。
 * 2026 年度の学年暦 (前期は 4/6 から 7/24、後期は 9/24 から 2027/1/21) に合わせた仮の規則で、
 * 後期の始まりは実際より数日遅くなりうる。推定の間は、管理画面と管理用の通知で入力を促す。
 */
export function estimateAcademicTerms(academicYear: number): TermPeriod[] {
	const springStart = firstMondayOfApril(academicYear);
	const fallStart = lastMondayOfSeptember(academicYear);
	return [
		{ term: 'spring', start: springStart, end: addDays(springStart, 15 * 7 + 4) },
		{ term: 'fall', start: fallStart, end: addDays(fallStart, 16 * 7 + 3) },
	];
}

const ESTIMATED_TERMS: readonly Term[] = ['spring', 'fall'];

/** 同じ学期に複数の値があるとき、手入力を先に使う。管理者が、取得した値の誤りを直せるようにするため */
const SOURCE_PRIORITY: Record<StoredTerm['source'], number> = { manual: 0, auto: 1 };

export function resolveAcademicTerms(
	academicYear: number,
	stored: readonly StoredTerm[],
): ResolvedTerm[] {
	const byTerm = new Map<Term, ResolvedTerm>();
	for (const item of [...stored].sort(
		(a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source],
	)) {
		// 優先度の低い順に入れて、あとから優先度の高いもので上書きする
		byTerm.set(item.term, item);
	}
	for (const estimate of estimateAcademicTerms(academicYear)) {
		if (ESTIMATED_TERMS.includes(estimate.term) && !byTerm.has(estimate.term)) {
			byTerm.set(estimate.term, { ...estimate, source: 'estimated' });
		}
	}
	// 開始日の順。同じ日に始まるものは、終わりが遅い (期間が長い) 方を先にする
	return [...byTerm.values()].sort((a, b) =>
		a.start !== b.start ? (a.start < b.start ? -1 : 1) : a.end < b.end ? 1 : a.end > b.end ? -1 : 0,
	);
}
