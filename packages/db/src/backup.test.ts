import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDatabase, restoreDatabase } from './backup.ts';
import { openDatabase, type Database } from './database.ts';
import { users } from './schema.ts';

let dir: string;
let dbPath: string;
let backupDir: string;
let opened: Database[] = [];

function open() {
	const database = openDatabase(dbPath, { backupDir });
	opened.push(database);
	return database;
}

function addUser(database: Database, id: string) {
	database.db
		.insert(users)
		.values({ id, email: `${id}@example.com`, googleSub: `sub-${id}` })
		.run();
}

function countUsers(path: string): number {
	const sqlite = new BetterSqlite3(path, { readonly: true });
	try {
		return (sqlite.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
	} finally {
		sqlite.close();
	}
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-backup-'));
	dbPath = join(dir, 'funmary.db');
	backupDir = join(dir, 'backups');
	opened = [];
});

afterEach(() => {
	for (const database of opened) database.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('backupDatabase', () => {
	it('動いている DB の複製を、日付入りの名前で作る', () => {
		const database = open();
		addUser(database, 'u1');
		const file = backupDatabase(database, backupDir, { now: new Date('2026-09-27T04:00:00Z') });
		expect(file).toBe(join(backupDir, 'daily-2026-09-27T04-00-00-000Z.db'));
		expect(countUsers(file)).toBe(1);
	});

	it('日ごとのバックアップは新しいものから keep 個だけ残し、ほかの名前のファイルは消さない', () => {
		const database = open();
		for (let day = 1; day <= 5; day++) {
			backupDatabase(database, backupDir, {
				now: new Date(Date.UTC(2026, 8, day, 4)),
				keep: 3,
			});
		}
		writeFileSync(join(backupDir, 'before-migration-x.db'), '');
		backupDatabase(database, backupDir, { now: new Date(Date.UTC(2026, 8, 6, 4)), keep: 3 });
		expect(readdirSync(backupDir).sort()).toEqual([
			'before-migration-x.db',
			'daily-2026-09-04T04-00-00-000Z.db',
			'daily-2026-09-05T04-00-00-000Z.db',
			'daily-2026-09-06T04-00-00-000Z.db',
		]);
	});
});

describe('restoreDatabase', () => {
	it('バックアップの内容に差し替え、今の DB は別の名前で残す', () => {
		const database = open();
		addUser(database, 'u1');
		const file = backupDatabase(database, backupDir, { now: new Date('2026-09-27T04:00:00Z') });
		addUser(database, 'u2');
		database.close();
		opened = [];

		const kept = restoreDatabase(dbPath, file, { now: new Date('2026-09-27T10:00:00Z') });

		expect(countUsers(dbPath)).toBe(1);
		expect(countUsers(kept)).toBe(2);
		expect(kept).toBe(join(dir, 'funmary.db.before-restore-2026-09-27T10-00-00-000Z'));
		// 古い WAL が残っていると、差し替えた DB に混ざってしまう
		expect(existsSync(`${dbPath}-wal`)).toBe(false);
		expect(existsSync(`${dbPath}-shm`)).toBe(false);
	});

	it('DB として読めないファイルからは戻さず、今の DB を変えない', () => {
		const database = open();
		addUser(database, 'u1');
		database.close();
		opened = [];
		const broken = join(dir, 'broken.db');
		writeFileSync(broken, 'これは DB ではありません'.repeat(100));
		utimesSync(broken, new Date(), new Date());

		expect(() => restoreDatabase(dbPath, broken, { now: new Date() })).toThrow(/バックアップ/);
		expect(countUsers(dbPath)).toBe(1);
	});

	it('存在しないバックアップは、分かる言葉で断る', () => {
		expect(() => restoreDatabase(dbPath, join(dir, 'none.db'), { now: new Date() })).toThrow(
			/見つかりません/,
		);
	});
});
