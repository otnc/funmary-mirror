import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAcademicCalendarStore } from './academic-calendar-store.ts';
import { openDatabase, type Database } from './database.ts';

let dir: string;
let database: Database;
const now = new Date('2026-09-26T00:00:00Z');

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-calendar-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('学期の期間', () => {
	it('年度ごとに保存し、読み戻せる', () => {
		const store = createAcademicCalendarStore(database);
		store.saveTerm(2026, { term: 'spring', start: '2026-04-06', end: '2026-07-24' }, 'manual', now);
		store.saveTerm(2027, { term: 'spring', start: '2027-04-05', end: '2027-07-23' }, 'manual', now);
		expect(store.listTerms(2026)).toEqual([
			{ term: 'spring', start: '2026-04-06', end: '2026-07-24', source: 'manual' },
		]);
		expect(store.listTerms(2027)).toHaveLength(1);
		expect(store.listTerms(2030)).toEqual([]);
	});

	it('同じ学期に保存し直すと上書きする', () => {
		const store = createAcademicCalendarStore(database);
		store.saveTerm(2026, { term: 'fall', start: '2026-09-28', end: '2027-01-21' }, 'manual', now);
		store.saveTerm(2026, { term: 'fall', start: '2026-09-24', end: '2027-01-21' }, 'manual', now);
		expect(store.listTerms(2026)).toEqual([
			{ term: 'fall', start: '2026-09-24', end: '2027-01-21', source: 'manual' },
		]);
	});

	it('自動で取った値は、管理者が入れた値を上書きしない。手入力は自動の値を上書きする', () => {
		const store = createAcademicCalendarStore(database);
		const auto = { term: 'spring', start: '2026-04-06', end: '2026-07-24' } as const;
		const manual = { term: 'spring', start: '2026-04-07', end: '2026-07-23' } as const;
		store.saveTerm(2026, manual, 'manual', now);
		expect(store.saveTerm(2026, auto, 'auto', now)).toBe(false);
		expect(store.listTerms(2026)[0]).toMatchObject({ start: '2026-04-07', source: 'manual' });

		store.deleteTerm(2026, 'spring');
		store.saveTerm(2026, auto, 'auto', now);
		expect(store.saveTerm(2026, manual, 'manual', now)).toBe(true);
		expect(store.listTerms(2026)[0]).toMatchObject({ start: '2026-04-07', source: 'manual' });
	});
});

describe('振替授業日', () => {
	it('日付と、その日に行う曜日を保存し、期間で絞って読み戻せる', () => {
		const store = createAcademicCalendarStore(database);
		store.saveSubstituteDay({ date: '2026-04-30', weekday: 3 }, 'manual');
		store.saveSubstituteDay({ date: '2026-10-16', weekday: 1 }, 'manual');
		expect(store.listSubstituteDays('2026-04-01', '2026-07-31')).toEqual([
			{ date: '2026-04-30', weekday: 3 },
		]);
		expect(store.listSubstituteDays('2026-01-01', '2026-12-31')).toHaveLength(2);
	});

	it('同じ日付を保存し直すと、曜日を上書きする。削除もできる', () => {
		const store = createAcademicCalendarStore(database);
		store.saveSubstituteDay({ date: '2026-04-30', weekday: 3 }, 'manual');
		store.saveSubstituteDay({ date: '2026-04-30', weekday: 2 }, 'manual');
		expect(store.listSubstituteDays('2026-04-01', '2026-04-30')).toEqual([
			{ date: '2026-04-30', weekday: 2 },
		]);
		store.deleteSubstituteDay('2026-04-30');
		expect(store.listSubstituteDays('2026-04-01', '2026-04-30')).toEqual([]);
	});
});
