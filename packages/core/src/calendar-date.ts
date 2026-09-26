// 暦の上の日付 ("YYYY-MM-DD") を、時差の影響を受けずに扱うための補助。
// 時刻を持たない日付なので、計算は UTC の Date で行い、実行環境のタイムゾーンに左右されない。

/** 暦の上の日付。例: "2026-04-06" */
export type CalendarDate = string;

/** ISO 8601 の曜日。1 が月曜、7 が日曜 */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcMs(date: CalendarDate): number {
	const [year, month, day] = date.split('-').map(Number);
	return Date.UTC(year ?? NaN, (month ?? NaN) - 1, day ?? NaN);
}

function fromUtcMs(ms: number): CalendarDate {
	return new Date(ms).toISOString().slice(0, 10);
}

/** date から days 日後 (負の数なら前) の日付 */
export function addDays(date: CalendarDate, days: number): CalendarDate {
	return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

export function isoWeekday(date: CalendarDate): Weekday {
	const day = new Date(toUtcMs(date)).getUTCDay();
	return (day === 0 ? 7 : day) as Weekday;
}

/** start から end まで (両端を含む) の日付を順に返す */
export function* eachDate(start: CalendarDate, end: CalendarDate): Generator<CalendarDate> {
	for (let ms = toUtcMs(start); ms <= toUtcMs(end); ms += DAY_MS) {
		yield fromUtcMs(ms);
	}
}
