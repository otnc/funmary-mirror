import { createLogger } from '@funmary/log';
import { Cron } from 'croner';
import { describe, expect, it } from 'vitest';
import { createRemindTimetableImportJob } from './remind-timetable-import.ts';
import type { JobContext } from './runner.ts';

function setup(now: string) {
	const alerts: { severity: string; title: string; message?: string; key?: string }[] = [];
	const job = createRemindTimetableImportJob({
		alert: (alert) => {
			alerts.push(alert);
			return Promise.resolve();
		},
	});
	const context: JobContext = {
		signal: new AbortController().signal,
		now: () => new Date(now),
		log: createLogger({ level: 'error', format: 'text', mode: 'development' }),
	};
	return { job, context, alerts };
}

describe('授業時間割の取り込みの知らせ', () => {
	it('日本時間の 3 月 31 日と 8 月 31 日の朝 9 時に動く', () => {
		const { job } = setup('2027-03-31T00:00:00Z');
		expect(job.name).toBe('remind-timetable-import');
		expect(job.schedule).toBe('0 9 31 3,8 *');
	});

	it('cron 式は、日本時間の 3/31 と 8/31 の 9 時だけに当たる', () => {
		const { job } = setup('2027-03-31T00:00:00Z');
		const cron = new Cron(job.schedule, { timezone: 'Asia/Tokyo' });
		const runs = cron.nextRuns(4, new Date('2026-09-26T00:00:00Z')).map((d) => d.toISOString());
		// 日本時間の 9 時は、世界時の 0 時
		expect(runs).toEqual([
			'2027-03-31T00:00:00.000Z',
			'2027-08-31T00:00:00.000Z',
			'2028-03-31T00:00:00.000Z',
			'2028-08-31T00:00:00.000Z',
		]);
	});

	it('3 月 31 日には、その年の前期の時間割を取り込むよう、管理者に知らせる', async () => {
		// 2027-03-31 09:00 (日本時間)
		const t = setup('2027-03-31T00:00:00Z');
		const message = await t.job.run(t.context);
		expect(t.alerts).toHaveLength(1);
		expect(t.alerts[0]).toMatchObject({ severity: 'info' });
		expect(t.alerts[0]!.title).toContain('2027 年度前期');
		expect(t.alerts[0]!.message).toContain('timetable import');
		expect(message).toContain('2027 年度前期');
	});

	it('8 月 31 日には、その年の後期の時間割を取り込むよう、管理者に知らせる', async () => {
		const t = setup('2027-08-31T00:00:00Z');
		await t.job.run(t.context);
		expect(t.alerts).toHaveLength(1);
		expect(t.alerts[0]!.title).toContain('2027 年度後期');
	});

	it('日本時間で日付を数える (世界時の前日でも、日本時間の当日なら知らせる)', async () => {
		// 世界時では 8/30 15:30 だが、日本時間では 8/31 0:30
		const t = setup('2027-08-30T15:30:00Z');
		await t.job.run(t.context);
		expect(t.alerts).toHaveLength(1);
	});

	it('通知の日ではない日に、手で動かしても、知らせない', async () => {
		const t = setup('2027-05-10T00:00:00Z');
		const message = await t.job.run(t.context);
		expect(t.alerts).toHaveLength(0);
		expect(message).toContain('通知の日ではありません');
	});

	it('年ごとに違う key を使う (毎年、別の知らせとして届く)', async () => {
		const a = setup('2027-08-31T00:00:00Z');
		const b = setup('2028-08-31T00:00:00Z');
		await a.job.run(a.context);
		await b.job.run(b.context);
		expect(a.alerts[0]!.key).not.toBe(b.alerts[0]!.key);
	});
});
