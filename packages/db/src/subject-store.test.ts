import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from './database.ts';
import { createSubjectStore, type SubjectInput } from './subject-store.ts';

let dir: string;
let database: Database;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'funmary-subjects-'));
	database = openDatabase(join(dir, 'funmary.db'), { backupDir: join(dir, 'backups') });
});

afterEach(() => {
	database.close();
	rmSync(dir, { recursive: true, force: true });
});

const T0 = new Date('2026-09-26T00:00:00Z');
const T1 = new Date('2026-10-03T00:00:00Z');

const subject = (over: Partial<SubjectInput> = {}): SubjectInput => ({
	academicYear: 2026,
	syllabusId: '100201',
	name: 'コンピュータと教育1～4',
	teacher: '平野　智紀',
	credits: 2,
	term: 'fall',
	attributes: { 配当年次: '1年' },
	syllabus: { 授業の概要: '概要' },
	syllabusUrl: 'https://students.fun.ac.jp/Lesson/Syllabus?lesson_id=100201&year=2026',
	...over,
});

describe('SubjectStore', () => {
	it('科目を保存し、年度とシラバスの番号で読める', () => {
		const store = createSubjectStore(database);
		store.upsert(subject(), T0);
		expect(store.findBySyllabus(2026, '100201')).toMatchObject({
			name: 'コンピュータと教育1～4',
			credits: 2,
			term: 'fall',
			attributes: { 配当年次: '1年' },
			syllabus: { 授業の概要: '概要' },
		});
		expect(store.findBySyllabus(2026, '999')).toBeNull();
	});

	it('同じ年度とシラバスの番号なら、上書きして、別の年度なら別の科目にする', () => {
		const store = createSubjectStore(database);
		store.upsert(subject(), T0);
		store.upsert(subject({ credits: 4 }), T1);
		store.upsert(subject({ academicYear: 2025 }), T1);
		expect(store.findBySyllabus(2026, '100201')?.credits).toBe(4);
		expect(store.findBySyllabus(2025, '100201')).not.toBeNull();
		expect(store.list(2026)).toHaveLength(1);
	});

	it('上書きしても、科目の ID は変わらない (履修登録が切れない)', () => {
		const store = createSubjectStore(database);
		const first = store.upsert(subject(), T0);
		const second = store.upsert(subject({ name: '改名' }), T1);
		expect(second).toBe(first);
	});

	it('更新の時刻を、年度ごとに、シラバスの番号をキーにして返す', () => {
		const store = createSubjectStore(database);
		store.upsert(subject(), T0);
		store.upsert(subject({ syllabusId: '100301' }), T1);
		const times = store.updatedAtBySyllabus(2026);
		expect(times.get('100201')).toEqual(T0);
		expect(times.get('100301')).toEqual(T1);
		expect(times.size).toBe(2);
	});

	it('保存されている、最も新しい年度を返す。なければ null', () => {
		const store = createSubjectStore(database);
		expect(store.latestYear()).toBeNull();
		store.upsert(subject({ academicYear: 2025 }), T0);
		store.upsert(subject({ academicYear: 2026 }), T0);
		expect(store.latestYear()).toBe(2026);
	});

	it('科目を、名前の順に一覧で返す', () => {
		const store = createSubjectStore(database);
		store.upsert(subject({ syllabusId: '2', name: 'い' }), T0);
		store.upsert(subject({ syllabusId: '1', name: 'あ' }), T0);
		expect(store.list(2026).map((s) => s.name)).toEqual(['あ', 'い']);
	});

	it('外から来た文字列 (__proto__ など) をキーにしても、安全に保存できる', () => {
		const store = createSubjectStore(database);
		store.upsert(
			subject({
				attributes: JSON.parse('{"__proto__":"x","constructor":"y"}') as Record<string, string>,
			}),
			T0,
		);
		const found = store.findBySyllabus(2026, '100201');
		expect(found?.attributes).toBeTruthy();
		expect(({} as Record<string, unknown>)['x']).toBeUndefined();
	});
});
