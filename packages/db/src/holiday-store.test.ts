import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from './database.ts';
import { createHolidayStore } from './holiday-store.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-holidays-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('createHolidayStore', () => {
	it('何も保存していなければ、空で返す', () => {
		const store = createHolidayStore(database);
		expect(store.isEmpty()).toBe(true);
		expect(store.list()).toEqual([]);
	});

	it('出どころ付きで保存し、日付の順に返す', () => {
		const store = createHolidayStore(database);
		store.replaceAll('cabinetOffice', [
			{ date: '2026-11-03', name: '文化の日' },
			{ date: '2026-01-01', name: '元日' },
		]);
		expect(store.isEmpty()).toBe(false);
		expect(store.list()).toEqual([
			{ date: '2026-01-01', name: '元日', source: 'cabinetOffice' },
			{ date: '2026-11-03', name: '文化の日', source: 'cabinetOffice' },
		]);
	});

	it('保存し直すと、古い内容は残らず全部入れ替わる (CSV から消えた日を残さない)', () => {
		const store = createHolidayStore(database);
		store.replaceAll('cabinetOffice', [
			{ date: '2026-01-01', name: '元日' },
			{ date: '2026-02-11', name: '建国記念の日' },
		]);
		store.replaceAll('cabinetOffice', [{ date: '2026-01-01', name: '元日' }]);
		expect(store.list().map((h) => h.date)).toEqual(['2026-01-01']);
	});

	it('内閣府の CSV を保存すると、同梱の祝日から置き換わる', () => {
		const store = createHolidayStore(database);
		store.replaceAll('bundled', [{ date: '2025-01-01', name: '元日' }]);
		store.replaceAll('cabinetOffice', [{ date: '2026-01-01', name: '元日' }]);
		expect(store.list()).toEqual([{ date: '2026-01-01', name: '元日', source: 'cabinetOffice' }]);
	});

	it('何も保存されていなければ、同梱の祝日を入れる', () => {
		const store = createHolidayStore(database);
		expect(store.seedBundled([{ date: '2020-01-01', name: '元日' }])).toBe(true);
		expect(store.list()).toEqual([{ date: '2020-01-01', name: '元日', source: 'bundled' }]);
	});

	it('すでに保存されていれば、同梱の祝日は入れない', () => {
		const store = createHolidayStore(database);
		store.replaceAll('cabinetOffice', [{ date: '2026-01-01', name: '元日' }]);
		expect(store.seedBundled([{ date: '2020-01-01', name: '元日' }])).toBe(false);
		expect(store.list().map((h) => h.date)).toEqual(['2026-01-01']);
	});
});
