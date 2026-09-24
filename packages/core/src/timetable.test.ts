import { describe, expect, it } from 'vitest';
import { expandTimetable, type TimetableInput } from './timetable.ts';

// 2026 年度の前期。2026-04-06 は月曜
const spring = { term: 'spring', start: '2026-04-06', end: '2026-08-07' } as const;

function input(overrides: Partial<TimetableInput> = {}): TimetableInput {
	return {
		range: { start: '2026-04-06', end: '2026-04-12' },
		terms: [spring],
		registrations: [
			{
				subjectId: 'algebra',
				term: 'spring',
				slots: [{ weekday: 1, period: 3, room: '484' }],
			},
			{
				subjectId: 'english',
				term: 'spring',
				slots: [
					{ weekday: 2, period: 1, room: '363' },
					{ weekday: 4, period: 1, room: '363' },
				],
			},
		],
		holidays: [],
		substituteDays: [],
		classChanges: [],
		...overrides,
	};
}

describe('expandTimetable', () => {
	it('通常の週は、履修科目のコマが曜日どおりに日付順で並ぶ', () => {
		expect(expandTimetable(input())).toEqual([
			{
				date: '2026-04-06',
				period: 3,
				subjectId: 'algebra',
				room: '484',
				roomIsTentative: false,
				status: 'normal',
			},
			{
				date: '2026-04-07',
				period: 1,
				subjectId: 'english',
				room: '363',
				roomIsTentative: false,
				status: 'normal',
			},
			{
				date: '2026-04-09',
				period: 1,
				subjectId: 'english',
				room: '363',
				roomIsTentative: false,
				status: 'normal',
			},
		]);
	});

	it('祝日には授業がない', () => {
		// 2026-04-29 (水) は昭和の日
		const lessons = expandTimetable(
			input({
				range: { start: '2026-04-27', end: '2026-05-01' },
				registrations: [
					{ subjectId: 'physics', term: 'spring', slots: [{ weekday: 3, period: 2, room: '595' }] },
				],
				holidays: ['2026-04-29'],
			}),
		);
		expect(lessons).toEqual([]);
	});

	it('学期の期間の外の日には、その学期の科目の授業がない', () => {
		// 前期は 2026-08-07 (金) まで、後期は 2026-09-28 (月) から
		const lessons = expandTimetable(
			input({
				range: { start: '2026-08-03', end: '2026-10-02' },
				terms: [spring, { term: 'fall', start: '2026-09-28', end: '2027-02-05' }],
				registrations: [
					{ subjectId: 'algebra', term: 'spring', slots: [{ weekday: 1, period: 3, room: '484' }] },
					{ subjectId: 'geometry', term: 'fall', slots: [{ weekday: 1, period: 3, room: '484' }] },
				],
			}),
		);
		expect(lessons.map((lesson) => [lesson.date, lesson.subjectId])).toEqual([
			['2026-08-03', 'algebra'],
			['2026-09-28', 'geometry'],
		]);
	});

	it('振替授業日は、指定された曜日の授業を行う。祝日でも行う', () => {
		// 2026-07-20 (月) は海の日。この日に火曜の授業を行うとする
		const lessons = expandTimetable(
			input({
				range: { start: '2026-07-20', end: '2026-07-20' },
				holidays: ['2026-07-20'],
				substituteDays: [{ date: '2026-07-20', weekday: 2 }],
			}),
		);
		expect(lessons.map((lesson) => [lesson.date, lesson.subjectId])).toEqual([
			['2026-07-20', 'english'],
		]);
	});

	it('休講の授業は消さずに、休講の印を付ける', () => {
		const lessons = expandTimetable(
			input({
				classChanges: [
					{ kind: 'cancellation', subjectId: 'algebra', date: '2026-04-06', period: 3 },
				],
			}),
		);
		expect(lessons[0]).toEqual({
			date: '2026-04-06',
			period: 3,
			subjectId: 'algebra',
			room: '484',
			roomIsTentative: false,
			status: 'cancelled',
		});
	});

	it('教室変更の授業は、変更後の教室になる', () => {
		const lessons = expandTimetable(
			input({
				classChanges: [
					{ kind: 'roomChange', subjectId: 'english', date: '2026-04-09', period: 1, room: '講堂' },
				],
			}),
		);
		expect(lessons.map((lesson) => [lesson.date, lesson.room, lesson.status])).toEqual([
			['2026-04-06', '484', 'normal'],
			['2026-04-07', '363', 'normal'],
			['2026-04-09', '講堂', 'roomChanged'],
		]);
	});

	it('補講は授業として足し、日付と時限の順に並べる。教室がなければふだんの教室を仮に出す', () => {
		const lessons = expandTimetable(
			input({
				classChanges: [
					{ kind: 'makeup', subjectId: 'algebra', date: '2026-04-11', period: 2, room: 'R791' },
					{ kind: 'makeup', subjectId: 'english', date: '2026-04-06', period: 1 },
				],
			}),
		);
		expect(
			lessons.map((lesson) => [
				lesson.date,
				lesson.period,
				lesson.subjectId,
				lesson.room,
				lesson.roomIsTentative,
				lesson.status,
			]),
		).toEqual([
			['2026-04-06', 1, 'english', '363', true, 'makeup'],
			['2026-04-06', 3, 'algebra', '484', false, 'normal'],
			['2026-04-07', 1, 'english', '363', false, 'normal'],
			['2026-04-09', 1, 'english', '363', false, 'normal'],
			['2026-04-11', 2, 'algebra', 'R791', false, 'makeup'],
		]);
	});

	it('同じ授業に情報が重なったら、休講、補講、教室変更の順に優先する', () => {
		const lessons = expandTimetable(
			input({
				classChanges: [
					{ kind: 'roomChange', subjectId: 'algebra', date: '2026-04-06', period: 3, room: '講堂' },
					{ kind: 'cancellation', subjectId: 'algebra', date: '2026-04-06', period: 3 },
					{ kind: 'roomChange', subjectId: 'english', date: '2026-04-07', period: 1, room: '講堂' },
					{ kind: 'makeup', subjectId: 'english', date: '2026-04-07', period: 1, room: 'R791' },
				],
			}),
		);
		expect(lessons.slice(0, 2).map((lesson) => [lesson.date, lesson.room, lesson.status])).toEqual([
			['2026-04-06', '484', 'cancelled'],
			['2026-04-07', 'R791', 'makeup'],
		]);
	});

	it('期間の外の日付や、履修していない科目の情報は使わない', () => {
		const lessons = expandTimetable(
			input({
				classChanges: [
					{ kind: 'makeup', subjectId: 'algebra', date: '2026-04-13', period: 2, room: 'R791' },
					{ kind: 'makeup', subjectId: 'history', date: '2026-04-08', period: 2, room: 'R791' },
					{ kind: 'cancellation', subjectId: 'history', date: '2026-04-06', period: 3 },
				],
			}),
		);
		expect(lessons).toEqual(expandTimetable(input()));
	});
});
