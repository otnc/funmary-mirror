/** 1 コマ分の時限。時刻は日本時間の "HH:MM" */
export interface Period {
	readonly number: number;
	readonly start: string;
	readonly end: string;
}

/**
 * 時限の時刻の初期値。実際の値は管理画面で変えられる設定として持つ (設計書 11.2)。
 * 大学の資料との照合は Phase 0 で行う。
 */
export const DEFAULT_PERIODS: readonly Period[] = [
	{ number: 1, start: '09:00', end: '10:30' },
	{ number: 2, start: '10:40', end: '12:10' },
	{ number: 3, start: '13:10', end: '14:40' },
	{ number: 4, start: '14:50', end: '16:20' },
	{ number: 5, start: '16:30', end: '18:00' },
	{ number: 6, start: '18:10', end: '19:40' },
];

/** 時限の番号から時刻を引く。該当する時限がなければ undefined を返す */
export function findPeriod(
	number: number,
	periods: readonly Period[] = DEFAULT_PERIODS,
): Period | undefined {
	return periods.find((period) => period.number === number);
}
