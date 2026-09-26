// 内閣府の祝日の CSV (syukujitsu.csv) を解析する (設計書 10 章)。
// 取得した内容は信用しない。1 行ずつ形を確かめ、読めない行は捨てて数える。
import type { CalendarDate } from '@funmary/core';
import Papa from 'papaparse';

export interface Holiday {
	readonly date: CalendarDate;
	readonly name: string;
}

export type HolidayParseResult =
	| {
			readonly kind: 'ok';
			/** 日付の順 */
			readonly holidays: readonly Holiday[];
			/** 形が合わずに捨てた行の数 */
			readonly skipped: number;
	  }
	| { readonly kind: 'invalid'; readonly reason: string };

/** 内閣府の CSV は Shift_JIS。TextDecoder で文字列にする */
export function decodeHolidayCsv(bytes: Uint8Array): string {
	return new TextDecoder('shift_jis').decode(bytes);
}

/** "2026/1/1" のような日付を "2026-01-01" にする。存在しない日付は undefined */
function normalizeDate(text: string): CalendarDate | undefined {
	const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
	if (!match) return undefined;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	// 2/30 のような日付は、Date が翌月に繰り上げるので、元に戻らなければ捨てる
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return undefined;
	}
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseHolidayCsv(text: string): HolidayParseResult {
	const { data } = Papa.parse<string[]>(text, { skipEmptyLines: true });
	const byDate = new Map<CalendarDate, string>();
	let skipped = 0;
	// 1 行目は見出しなので飛ばす
	for (const row of data.slice(1)) {
		const date = normalizeDate((row[0] ?? '').trim());
		const name = (row[1] ?? '').trim();
		if (!date || !name) {
			skipped += 1;
			continue;
		}
		byDate.set(date, name);
	}
	if (byDate.size === 0) {
		return { kind: 'invalid', reason: '祝日として読める行が 1 件もありません' };
	}
	const holidays = [...byDate]
		.map(([date, name]) => ({ date, name }))
		.sort((a, b) => (a.date < b.date ? -1 : 1));
	return { kind: 'ok', holidays, skipped };
}
