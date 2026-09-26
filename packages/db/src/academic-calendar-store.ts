// 学期の期間と振替授業日の保存 (設計書 10 章)。値の出どころ (auto、manual) も一緒に残す。
// 推定した値は保存しない (@funmary/core の resolveAcademicTerms が、読むときに補う)。
import type {
	CalendarDate,
	StoredTerm,
	SubstituteDay,
	Term,
	TermPeriod,
	Weekday,
} from '@funmary/core';
import { and, between, eq } from 'drizzle-orm';
import type { Database } from './database.ts';
import { academicDays, academicTerms } from './schema.ts';

export type StoredSource = 'auto' | 'manual';

export interface AcademicCalendarStore {
	/** 年度の学期の期間 (推定は含まない) */
	listTerms(academicYear: number): StoredTerm[];
	/**
	 * 保存する。管理者が入れた値 (manual) は、自動で取った値 (auto) で上書きしない。
	 * 保存したら true、上書きを断ったら false
	 */
	saveTerm(academicYear: number, period: TermPeriod, source: StoredSource, now: Date): boolean;
	deleteTerm(academicYear: number, term: Term): void;
	/** start から end まで (両端を含む) の振替授業日 */
	listSubstituteDays(start: CalendarDate, end: CalendarDate): SubstituteDay[];
	saveSubstituteDay(day: SubstituteDay, source: StoredSource): void;
	deleteSubstituteDay(date: CalendarDate): void;
}

export function createAcademicCalendarStore(database: Database): AcademicCalendarStore {
	const { db } = database;
	return {
		listTerms(academicYear) {
			return db
				.select()
				.from(academicTerms)
				.where(eq(academicTerms.academicYear, academicYear))
				.orderBy(academicTerms.start)
				.all()
				.filter((row) => row.source !== 'estimated')
				.map((row) => ({
					term: row.term as Term,
					start: row.start,
					end: row.end,
					source: row.source as StoredSource,
				}));
		},
		saveTerm(academicYear, period, source, now) {
			const existing = db
				.select()
				.from(academicTerms)
				.where(
					and(eq(academicTerms.academicYear, academicYear), eq(academicTerms.term, period.term)),
				)
				.get();
			if (existing?.source === 'manual' && source === 'auto') return false;
			db.insert(academicTerms)
				.values({
					academicYear,
					term: period.term,
					start: period.start,
					end: period.end,
					source,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [academicTerms.academicYear, academicTerms.term],
					set: { start: period.start, end: period.end, source, updatedAt: now },
				})
				.run();
			return true;
		},
		deleteTerm(academicYear, term) {
			db.delete(academicTerms)
				.where(and(eq(academicTerms.academicYear, academicYear), eq(academicTerms.term, term)))
				.run();
		},
		listSubstituteDays(start, end) {
			return db
				.select()
				.from(academicDays)
				.where(and(eq(academicDays.kind, 'substitute'), between(academicDays.date, start, end)))
				.orderBy(academicDays.date)
				.all()
				.flatMap((row) =>
					row.weekday === null ? [] : [{ date: row.date, weekday: row.weekday as Weekday }],
				);
		},
		saveSubstituteDay(day, source) {
			db.insert(academicDays)
				.values({ date: day.date, kind: 'substitute', weekday: day.weekday, source })
				.onConflictDoUpdate({
					target: [academicDays.date, academicDays.kind],
					set: { weekday: day.weekday, source },
				})
				.run();
		},
		deleteSubstituteDay(date) {
			db.delete(academicDays)
				.where(and(eq(academicDays.date, date), eq(academicDays.kind, 'substitute')))
				.run();
		},
	};
}
