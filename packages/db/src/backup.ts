// DB のバックアップと復元 (設計書 20.7)。funmary-admin の backup と restore が使う。
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import type { Database } from './database.ts';

const DAILY_PREFIX = 'daily-';

export interface BackupOptions {
	/** ファイル名に使う時刻 */
	readonly now: Date;
	/** 日ごとのバックアップを残す数。既定は 14 */
	readonly keep?: number;
}

function stamp(now: Date): string {
	return now.toISOString().replace(/[:.]/g, '-');
}

/**
 * 動いている DB の複製を backupDir に作り、古い日ごとのバックアップを消す。アプリを止めなくてよい。
 * 消すのは daily- で始まるファイルだけで、マイグレーションの前に取ったバックアップには触れない。
 */
export function backupDatabase(
	database: Database,
	backupDir: string,
	options: BackupOptions,
): string {
	mkdirSync(backupDir, { recursive: true });
	const file = join(backupDir, `${DAILY_PREFIX}${stamp(options.now)}.db`);
	// VACUUM INTO は、書き込み中の DB からも一貫した複製を作れる
	database.sqlite.prepare('VACUUM INTO ?').run(file);

	// 名前に時刻が入っているので、名前の順が古い順になる
	const daily = readdirSync(backupDir)
		.filter((name) => name.startsWith(DAILY_PREFIX) && name.endsWith('.db'))
		.sort();
	for (const name of daily.slice(0, Math.max(0, daily.length - (options.keep ?? 14)))) {
		rmSync(join(backupDir, name));
	}
	return file;
}

/**
 * バックアップから DB を戻す。アプリを止めてから呼ぶこと。
 * 今の DB は消さず、`<DB のファイル>.before-restore-<時刻>` に残す。その名前を返す。
 */
export function restoreDatabase(
	dbPath: string,
	backupFile: string,
	options: { readonly now: Date },
): string {
	if (!existsSync(backupFile)) {
		throw new Error(`バックアップのファイルが見つかりません: ${backupFile}`);
	}
	assertReadable(backupFile);

	const kept = `${dbPath}.before-restore-${stamp(options.now)}`;
	if (existsSync(dbPath)) renameSync(dbPath, kept);
	// 古い WAL と共有メモリのファイルが残ると、差し替えた DB に混ざる
	for (const suffix of ['-wal', '-shm']) {
		if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, kept + suffix);
	}
	mkdirSync(dirname(dbPath), { recursive: true });
	copyFileSync(backupFile, dbPath);
	return kept;
}

function assertReadable(file: string): void {
	let result: unknown;
	try {
		const sqlite = new BetterSqlite3(file, { readonly: true });
		try {
			result = sqlite.pragma('quick_check', { simple: true });
		} finally {
			sqlite.close();
		}
	} catch (cause) {
		throw new Error(`バックアップが DB として読めないので、戻しません: ${file}`, { cause });
	}
	if (result !== 'ok') {
		throw new Error(`バックアップが壊れているので、戻しません: ${file}`);
	}
}
