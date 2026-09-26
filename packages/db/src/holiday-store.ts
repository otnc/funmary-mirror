// 祝日の保存 (設計書 10 章)。保存するのは内閣府の CSV か同梱の CSV の内容だけで、推定した祝日は保存しない
// (推定は @funmary/core の resolveHolidays が、読むときに補う)。
import type { ResolvedHoliday } from '@funmary/core';
import type { Database } from './database.ts';
import { holidays } from './schema.ts';

export type StoredHolidaySource = 'cabinetOffice' | 'bundled';

export interface HolidayStore {
	isEmpty(): boolean;
	/** 保存されている祝日を、日付の順に返す */
	list(): ResolvedHoliday[];
	/** 保存されている祝日を、全部入れ替える。CSV から消えた日を残さないため、1 つのトランザクションで行う */
	replaceAll(
		source: StoredHolidaySource,
		items: readonly { readonly date: string; readonly name: string }[],
	): void;
	/** 何も保存されていないときだけ、同梱の祝日を入れる。入れたら true */
	seedBundled(items: readonly { readonly date: string; readonly name: string }[]): boolean;
}

export function createHolidayStore(database: Database): HolidayStore {
	const { db, sqlite } = database;
	const isEmpty = () => db.select().from(holidays).limit(1).all().length === 0;
	const replaceAll: HolidayStore['replaceAll'] = (source, items) => {
		sqlite.transaction(() => {
			db.delete(holidays).run();
			// SQLite の 1 回の文で渡せる変数の数に上限があるので、分けて入れる
			for (let i = 0; i < items.length; i += 200) {
				db.insert(holidays)
					.values(items.slice(i, i + 200).map(({ date, name }) => ({ date, name, source })))
					.run();
			}
		})();
	};
	return {
		isEmpty,
		list: () => db.select().from(holidays).orderBy(holidays.date).all(),
		replaceAll,
		seedBundled(items) {
			if (!isEmpty()) return false;
			replaceAll('bundled', items);
			return true;
		},
	};
}
