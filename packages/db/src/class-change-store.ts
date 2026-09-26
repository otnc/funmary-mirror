// 休講、補講、教室変更の、前回までの記録 (設計書 9.2、11 章)。@funmary/core の detectChanges の入出力を保存する。
// 科目との照合 (subject_id) は、ここでは変えない。
import type { ScrapedChange, TrackedChange } from '@funmary/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from './database.ts';
import { classChanges } from './schema.ts';

export interface ClassChangeStore {
	/** 記録されている全件 */
	load(): TrackedChange[];
	/**
	 * detectChanges の next を保存する。1 つのトランザクションで行う。
	 * next に載っていない記録は消さない (過去の日付のものを残す)。
	 * 最初に見た時刻は変えず、最後に見た時刻は、一覧に載っていた (missingCount が 0 の) ときだけ更新する
	 */
	apply(next: readonly TrackedChange[], now: Date): void;
	withdrawnAt(change: ScrapedChange): Date | null;
	seenAt(change: ScrapedChange): { firstSeenAt: Date; lastSeenAt: Date } | null;
}

type Row = typeof classChanges.$inferSelect;

function toTracked(row: Row): TrackedChange {
	return {
		kind: row.kind,
		date: row.date,
		period: row.period,
		lessonName: row.lessonName,
		teacher: row.teacher,
		campus: row.campus,
		room: row.room,
		fromRoom: row.fromRoom,
		comment: row.comment,
		makeupPlan: row.makeupPlan,
		missingCount: row.missingCount,
		withdrawn: row.withdrawnAt !== null,
	};
}

const sameKey = (change: ScrapedChange) =>
	and(
		eq(classChanges.kind, change.kind),
		eq(classChanges.date, change.date),
		eq(classChanges.period, change.period),
		eq(classChanges.lessonName, change.lessonName),
	);

export function createClassChangeStore(database: Database): ClassChangeStore {
	const { db, sqlite } = database;
	return {
		load() {
			return db
				.select()
				.from(classChanges)
				.orderBy(classChanges.date, classChanges.period, classChanges.id)
				.all()
				.map(toTracked);
		},
		apply(next, now) {
			sqlite.transaction(() => {
				for (const change of next) {
					const existing = db.select().from(classChanges).where(sameKey(change)).get();
					const fields = {
						teacher: change.teacher,
						campus: change.campus,
						room: change.room,
						fromRoom: change.fromRoom,
						comment: change.comment,
						makeupPlan: change.makeupPlan,
						missingCount: change.missingCount,
					};
					if (!existing) {
						db.insert(classChanges)
							.values({
								kind: change.kind,
								date: change.date,
								period: change.period,
								lessonName: change.lessonName,
								...fields,
								firstSeenAt: now,
								lastSeenAt: now,
								withdrawnAt: change.withdrawn ? now : null,
							})
							.run();
						continue;
					}
					db.update(classChanges)
						.set({
							...fields,
							...(change.missingCount === 0 && { lastSeenAt: now }),
							// 取り消した時刻は、最初に取り消したときのものを残す
							withdrawnAt: change.withdrawn ? (existing.withdrawnAt ?? now) : null,
						})
						.where(eq(classChanges.id, existing.id))
						.run();
				}
			})();
		},
		withdrawnAt(change) {
			return db.select().from(classChanges).where(sameKey(change)).get()?.withdrawnAt ?? null;
		},
		seenAt(change) {
			const row = db.select().from(classChanges).where(sameKey(change)).get();
			return row ? { firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt } : null;
		},
	};
}
