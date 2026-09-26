// 科目 (公開シラバスから取り込んだもの) の保存 (設計書 11 章)。科目は、年度とシラバスの番号の組で区別する。
// 上書きしても、科目の ID は変えない (履修登録、時間割の枠、休講の記録が、この ID を参照しているため)。
import { and, desc, eq, max } from 'drizzle-orm';
import type { Database } from './database.ts';
import { subjects } from './schema.ts';

export interface SubjectInput {
	readonly academicYear: number;
	/** シラバスの番号 (授業コード) */
	readonly syllabusId: string;
	readonly name: string;
	readonly teacher: string | null;
	readonly credits: number | null;
	/** @funmary/core の Term */
	readonly term: string;
	readonly attributes: Record<string, string>;
	readonly syllabus: Record<string, string>;
	readonly syllabusUrl: string | null;
}

export interface StoredSubject extends SubjectInput {
	readonly id: number;
	readonly updatedAt: Date;
}

export interface SubjectStore {
	/** 保存 (同じ年度とシラバスの番号があれば上書き) して、科目の ID を返す */
	upsert(input: SubjectInput, now: Date): number;
	findBySyllabus(academicYear: number, syllabusId: string): StoredSubject | null;
	findById(id: number): StoredSubject | null;
	/** 年度の科目を、名前の順に返す */
	list(academicYear: number): StoredSubject[];
	/** 年度の科目の、シラバスの番号ごとの更新の時刻。詳細を取り直すかの判断に使う */
	updatedAtBySyllabus(academicYear: number): Map<string, Date>;
	/** 保存されている最も新しい年度。新年度のシラバスがまだなければ、前年度を使い続けるために使う */
	latestYear(): number | null;
}

type Row = typeof subjects.$inferSelect;

function toStored(row: Row): StoredSubject {
	return {
		id: row.id,
		academicYear: row.academicYear,
		syllabusId: row.syllabusId,
		name: row.name,
		teacher: row.teacher,
		credits: row.credits,
		term: row.term,
		attributes: row.attributes ?? {},
		syllabus: row.syllabus ?? {},
		syllabusUrl: row.syllabusUrl,
		updatedAt: row.updatedAt,
	};
}

export function createSubjectStore(database: Database): SubjectStore {
	const { db } = database;
	return {
		upsert(input, now) {
			const values = {
				name: input.name,
				teacher: input.teacher,
				credits: input.credits,
				term: input.term,
				attributes: input.attributes,
				syllabus: input.syllabus,
				syllabusUrl: input.syllabusUrl,
				updatedAt: now,
			};
			const row = db
				.insert(subjects)
				.values({ academicYear: input.academicYear, syllabusId: input.syllabusId, ...values })
				.onConflictDoUpdate({
					target: [subjects.academicYear, subjects.syllabusId],
					set: values,
				})
				.returning({ id: subjects.id })
				.get();
			return row.id;
		},
		findBySyllabus(academicYear, syllabusId) {
			const row = db
				.select()
				.from(subjects)
				.where(and(eq(subjects.academicYear, academicYear), eq(subjects.syllabusId, syllabusId)))
				.get();
			return row ? toStored(row) : null;
		},
		findById(id) {
			const row = db.select().from(subjects).where(eq(subjects.id, id)).get();
			return row ? toStored(row) : null;
		},
		list(academicYear) {
			return db
				.select()
				.from(subjects)
				.where(eq(subjects.academicYear, academicYear))
				.orderBy(subjects.name, desc(subjects.id))
				.all()
				.map(toStored);
		},
		updatedAtBySyllabus(academicYear) {
			const rows = db
				.select({ syllabusId: subjects.syllabusId, updatedAt: subjects.updatedAt })
				.from(subjects)
				.where(eq(subjects.academicYear, academicYear))
				.all();
			return new Map(rows.map((row) => [row.syllabusId, row.updatedAt]));
		},
		latestYear() {
			const row = db
				.select({ year: max(subjects.academicYear) })
				.from(subjects)
				.get();
			return row?.year ?? null;
		},
	};
}
