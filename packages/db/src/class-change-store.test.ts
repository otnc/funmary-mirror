import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectChanges, type ScrapedChange } from '@funmary/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClassChangeStore } from './class-change-store.ts';
import { openDatabase, type Database } from './database.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-changes-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const item = (over: Partial<ScrapedChange> = {}): ScrapedChange => ({
	kind: 'roomChange',
	date: '2026-10-05',
	period: 3,
	lessonName: '線形代数 I',
	teacher: '山田 太郎',
	campus: '亀田',
	room: '502',
	fromRoom: '401',
	comment: null,
	makeupPlan: null,
	...over,
});

const t1 = new Date('2026-10-01T00:00:00Z');
const t2 = new Date('2026-10-02T00:00:00Z');
const t3 = new Date('2026-10-03T00:00:00Z');

describe('createClassChangeStore', () => {
	it('まだ何もなければ空で返す', () => {
		expect(createClassChangeStore(database).load()).toEqual([]);
	});

	it('取得した内容を保存し、そのまま読み戻せる', () => {
		const store = createClassChangeStore(database);
		const result = detectChanges({ previous: [], scraped: [item()], today: '2026-10-01' });
		if (result.kind !== 'ok') throw new Error('ok のはず');
		store.apply(result.next, t1);
		expect(store.load()).toEqual([{ ...item(), missingCount: 0, withdrawn: false }]);
	});

	it('保存し直すと、同じ項目は上書きし、新しい項目は増える。全件の入れ替えで消えた項目も残す', () => {
		const store = createClassChangeStore(database);
		const first = detectChanges({
			previous: [],
			scraped: [item(), item({ period: 4 })],
			today: '2026-10-01',
		});
		if (first.kind !== 'ok') throw new Error('ok のはず');
		store.apply(first.next, t1);

		// 1 回目の取得で period 4 が消え、period 3 の教室が変わり、period 5 が増えた
		const second = detectChanges({
			previous: store.load(),
			scraped: [item({ room: '601' }), item({ period: 5 })],
			today: '2026-10-01',
		});
		if (second.kind !== 'ok') throw new Error('ok のはず');
		store.apply(second.next, t2);

		const rows = store.load();
		expect(rows.map((r) => [r.period, r.room, r.missingCount])).toEqual([
			[3, '601', 0],
			[4, '502', 1],
			[5, '502', 0],
		]);
	});

	it('取り消しは、取り消した時刻を残す。載り直したら、取り消しを解く', () => {
		const store = createClassChangeStore(database);
		const base = { ...item(), missingCount: 1, withdrawn: false };
		store.apply([base], t1);
		store.apply([{ ...base, missingCount: 2, withdrawn: true }], t2);
		expect(store.load()[0]).toMatchObject({ withdrawn: true, missingCount: 2 });
		expect(store.withdrawnAt(base)).toEqual(t2);

		// 取り消し済みのまま保存し直しても、取り消した時刻は変わらない
		store.apply([{ ...base, missingCount: 2, withdrawn: true }], t3);
		expect(store.withdrawnAt(base)).toEqual(t2);

		store.apply([{ ...item(), missingCount: 0, withdrawn: false }], t3);
		expect(store.load()[0]).toMatchObject({ withdrawn: false, missingCount: 0 });
		expect(store.withdrawnAt(base)).toBeNull();
	});

	it('最初に見た時刻は変えず、最後に見た時刻は一覧に載っていたときだけ更新する', () => {
		const store = createClassChangeStore(database);
		store.apply([{ ...item(), missingCount: 0, withdrawn: false }], t1);
		store.apply([{ ...item(), missingCount: 0, withdrawn: false }], t2);
		store.apply([{ ...item(), missingCount: 1, withdrawn: false }], t3);
		expect(store.seenAt(item())).toEqual({ firstSeenAt: t1, lastSeenAt: t2 });
	});
});
