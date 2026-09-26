// 内閣府の CSV にまだ載っていない先の年の祝日を、@holiday-jp/holiday_jp のデータで推定する (設計書 10 章)。
// 推定した値は、CSV に載ったら置き換わる。データにない年は、空を返す。
import holidayJp from '@holiday-jp/holiday_jp';
import type { Holiday } from './parse.ts';

/** ある年の祝日と休日。データは日付 ("YYYY-MM-DD") をキーにした表なので、実行環境の時刻帯に左右されない */
export function estimateHolidays(year: number): Holiday[] {
	const prefix = `${String(year).padStart(4, '0')}-`;
	return Object.entries(holidayJp.holidays)
		.filter(([date]) => date.startsWith(prefix))
		.map(([date, holiday]) => ({ date, name: holiday.name }))
		.sort((a, b) => (a.date < b.date ? -1 : 1));
}
