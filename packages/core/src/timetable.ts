import { eachDate, isoWeekday, type CalendarDate, type Weekday } from './calendar-date.ts';

/** 学期。通年、前期、後期、1Q から 4Q、夏期集中、冬期集中 */
export type Term =
	| 'full-year'
	| 'spring'
	| 'fall'
	| 'q1'
	| 'q2'
	| 'q3'
	| 'q4'
	| 'summer-intensive'
	| 'winter-intensive';

/** ある年度の、1 つの学期の期間 (両端を含む) */
export interface TermPeriod {
	readonly term: Term;
	readonly start: CalendarDate;
	readonly end: CalendarDate;
}

/** 科目が行われる曜日と時限の組 */
export interface Slot {
	readonly weekday: Weekday;
	readonly period: number;
	readonly room: string | null;
}

/** 利用者が登録した履修科目と、そのコマ */
export interface Registration {
	readonly subjectId: string;
	readonly term: Term;
	readonly slots: readonly Slot[];
}

/** 振替授業日。date には weekday の曜日の授業を行う */
export interface SubstituteDay {
	readonly date: CalendarDate;
	readonly weekday: Weekday;
}

/** 休講、補講、教室変更 */
export type ClassChange =
	| {
			readonly kind: 'cancellation';
			readonly subjectId: string;
			readonly date: CalendarDate;
			readonly period: number;
	  }
	| {
			readonly kind: 'makeup';
			readonly subjectId: string;
			readonly date: CalendarDate;
			readonly period: number;
			readonly room?: string | null;
	  }
	| {
			readonly kind: 'roomChange';
			readonly subjectId: string;
			readonly date: CalendarDate;
			readonly period: number;
			readonly room: string;
	  };

export interface TimetableInput {
	/** 展開する期間 (両端を含む) */
	readonly range: { readonly start: CalendarDate; readonly end: CalendarDate };
	readonly terms: readonly TermPeriod[];
	readonly registrations: readonly Registration[];
	readonly holidays: readonly CalendarDate[];
	readonly substituteDays: readonly SubstituteDay[];
	readonly classChanges: readonly ClassChange[];
}

export type LessonStatus = 'normal' | 'cancelled' | 'makeup' | 'roomChanged';

/** ある日のある時限に行われる 1 回分の授業 */
export interface Lesson {
	readonly date: CalendarDate;
	readonly period: number;
	readonly subjectId: string;
	readonly room: string | null;
	/** 教室が分からないため、ふだんの教室を仮に入れているとき true */
	readonly roomIsTentative: boolean;
	readonly status: LessonStatus;
}

/**
 * 履修科目、学期、祝日、振替授業日、休講などから、期間内の日付ごとの授業を作る。
 * 結果は日付、時限、科目 ID の順に並ぶ。
 *
 * 同じ日、同じ時限、同じ科目に複数の情報が重なったときは、休講、補講、教室変更の順に優先する。
 */
export function expandTimetable(input: TimetableInput): Lesson[] {
	const lessons = new Map<string, Lesson>();
	for (const lesson of regularLessons(input)) lessons.set(lessonKey(lesson), lesson);
	applyClassChanges(lessons, input);
	return [...lessons.values()].sort(compareLessons);
}

/** 休講などを反映する前の、ふだんの授業 */
function* regularLessons(input: TimetableInput): Generator<Lesson> {
	const holidays = new Set(input.holidays);
	const substitutes = new Map(input.substituteDays.map((day) => [day.date, day.weekday]));
	for (const date of eachDate(input.range.start, input.range.end)) {
		const weekday = classWeekday(date, holidays, substitutes);
		if (weekday === undefined) continue;
		for (const registration of input.registrations) {
			if (!isInTerm(date, registration.term, input.terms)) continue;
			for (const slot of registration.slots) {
				if (slot.weekday !== weekday) continue;
				yield {
					date,
					period: slot.period,
					subjectId: registration.subjectId,
					room: slot.room,
					roomIsTentative: false,
					status: 'normal',
				};
			}
		}
	}
}

const CHANGE_PRIORITY: Record<ClassChange['kind'], number> = {
	cancellation: 0,
	makeup: 1,
	roomChange: 2,
};

function applyClassChanges(lessons: Map<string, Lesson>, input: TimetableInput): void {
	const registrations = new Map(input.registrations.map((r) => [r.subjectId, r]));
	// 同じ授業への情報のうち、優先度が最も高いものだけを使う
	const strongest = new Map<string, ClassChange>();
	for (const change of input.classChanges) {
		if (change.date < input.range.start || input.range.end < change.date) continue;
		if (!registrations.has(change.subjectId)) continue;
		const key = lessonKey(change);
		const current = strongest.get(key);
		if (!current || CHANGE_PRIORITY[change.kind] < CHANGE_PRIORITY[current.kind]) {
			strongest.set(key, change);
		}
	}

	for (const [key, change] of strongest) {
		const lesson = lessons.get(key);
		switch (change.kind) {
			case 'cancellation':
				if (lesson) lessons.set(key, { ...lesson, status: 'cancelled' });
				break;
			case 'makeup': {
				// 補講の教室が分からなければ、その科目のふだんの教室を仮に出す
				const usualRoom =
					registrations.get(change.subjectId)?.slots.find((s) => s.room)?.room ?? null;
				const room = change.room ?? usualRoom;
				lessons.set(key, {
					date: change.date,
					period: change.period,
					subjectId: change.subjectId,
					room,
					roomIsTentative: change.room == null && room !== null,
					status: 'makeup',
				});
				break;
			}
			case 'roomChange':
				if (lesson) lessons.set(key, { ...lesson, room: change.room, status: 'roomChanged' });
				break;
		}
	}
}

function isInTerm(date: CalendarDate, term: Term, terms: readonly TermPeriod[]): boolean {
	return terms.some((period) => period.term === term && period.start <= date && date <= period.end);
}

/**
 * その日にどの曜日の授業を行うか。振替授業日なら指定の曜日、祝日なら授業なし (undefined)。
 * 学年暦で祝日に授業を行う日は、振替授業日として渡される
 */
function classWeekday(
	date: CalendarDate,
	holidays: ReadonlySet<CalendarDate>,
	substitutes: ReadonlyMap<CalendarDate, Weekday>,
): Weekday | undefined {
	const substitute = substitutes.get(date);
	if (substitute !== undefined) return substitute;
	if (holidays.has(date)) return undefined;
	return isoWeekday(date);
}

function lessonKey(lesson: { date: CalendarDate; period: number; subjectId: string }): string {
	return `${lesson.date}|${lesson.period}|${lesson.subjectId}`;
}

function compareLessons(a: Lesson, b: Lesson): number {
	if (a.date !== b.date) return a.date < b.date ? -1 : 1;
	if (a.period !== b.period) return a.period - b.period;
	return a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0;
}
