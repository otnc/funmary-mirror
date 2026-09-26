// 内閣府に届かないとき (初回の起動など) の備えとして、リポジトリに同梱した祝日 (設計書 10 章)。
import { BUNDLED_HOLIDAY_CSV } from './bundled-data.ts';
import { parseHolidayCsv, type Holiday } from './parse.ts';

export function bundledHolidays(): readonly Holiday[] {
	const parsed = parseHolidayCsv(BUNDLED_HOLIDAY_CSV);
	// 同梱のデータは、作るときに解析できることを確かめている。読めなければ、作り間違いなので止める
	if (parsed.kind !== 'ok') throw new Error(`同梱の祝日のデータを読めません: ${parsed.reason}`);
	return parsed.holidays;
}
