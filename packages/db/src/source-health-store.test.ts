import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INITIAL_SOURCE_HEALTH, recordFailure, recordSuccess } from '@funmary/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from './database.ts';
import { createSourceHealthStore } from './source-health-store.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-health-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);
const options = { intervalMs: 60 * 60 * 1000 };

describe('createSourceHealthStore', () => {
	it('まだ記録のない取得元は、初期の状態で返す', () => {
		expect(createSourceHealthStore(database).load('portal')).toEqual(INITIAL_SOURCE_HEALTH);
	});

	it('保存した状態を、そのまま読み戻せる', () => {
		const store = createSourceHealthStore(database);
		const failed = recordFailure(
			INITIAL_SOURCE_HEALTH,
			at('2026-09-26T00:00:00Z'),
			'接続できない',
			options,
		);
		store.save('portal', failed.health);
		expect(store.load('portal')).toEqual(failed.health);
	});

	it('同じ取得元に保存し直すと上書きし、成功で失敗の回数が戻る', () => {
		const store = createSourceHealthStore(database);
		const failed = recordFailure(INITIAL_SOURCE_HEALTH, at('2026-09-26T00:00:00Z'), 'x', options);
		store.save('portal', failed.health);
		const recovered = recordSuccess(failed.health, at('2026-09-26T01:00:00Z'), {
			...options,
			contentHash: 'abc',
		});
		store.save('portal', recovered.health);
		expect(store.load('portal')).toMatchObject({
			consecutiveFailures: 0,
			lastError: null,
			contentHash: 'abc',
		});
	});

	it('取得元ごとに別々に保存し、一覧を名前の順に返す', () => {
		const store = createSourceHealthStore(database);
		const failed = recordFailure(INITIAL_SOURCE_HEALTH, at('2026-09-26T00:00:00Z'), 'x', options);
		store.save('syllabus', failed.health);
		store.save('portal', INITIAL_SOURCE_HEALTH);
		expect(store.load('portal').consecutiveFailures).toBe(0);
		expect(store.load('syllabus').consecutiveFailures).toBe(1);
		expect(store.list().map((entry) => entry.source)).toEqual(['portal', 'syllabus']);
	});
});
