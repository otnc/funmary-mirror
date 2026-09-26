import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@funmary/log';
import {
	createJobRunner,
	type JobDefinition,
	type JobRunRecord,
	type JobRunStore,
} from './runner.ts';

/** 実行記録を、メモリに残すだけの記録先 */
function memoryStore() {
	const runs: JobRunRecord[] = [];
	const store: JobRunStore = {
		start(job, startedAt) {
			runs.push({
				id: runs.length + 1,
				job,
				startedAt,
				finishedAt: null,
				status: 'running',
				message: null,
			});
			return runs.length;
		},
		finish(id, status, message, finishedAt) {
			const run = runs[id - 1]!;
			run.finishedAt = finishedAt;
			run.status = status;
			run.message = message;
		},
		recordSkipped(job, at, message) {
			runs.push({
				id: runs.length + 1,
				job,
				startedAt: at,
				finishedAt: at,
				status: 'skipped',
				message,
			});
		},
	};
	return { store, runs };
}

const silent = createLogger({
	level: 'error',
	format: 'text',
	mode: 'production',
	write: () => {},
});
const fixedNow = () => new Date('2026-10-01T00:00:00Z');

function setup(job: Partial<JobDefinition> & Pick<JobDefinition, 'run'>, extra: object = {}) {
	const { store, runs } = memoryStore();
	const definition: JobDefinition = {
		name: 'test-job',
		schedule: '0 7 * * *',
		timeoutMs: 1000,
		...job,
	};
	const runner = createJobRunner({
		jobs: [definition],
		store,
		log: silent,
		now: fixedNow,
		...extra,
	});
	return { runner, runs };
}

describe('runNow', () => {
	it('実行して、成功を記録する。run が返した文は記録に残る', async () => {
		const { runner, runs } = setup({ run: () => Promise.resolve('12 件取り込みました') });
		expect(await runner.runNow('test-job')).toEqual({
			status: 'succeeded',
			message: '12 件取り込みました',
		});
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({
			job: 'test-job',
			status: 'succeeded',
			message: '12 件取り込みました',
		});
		expect(runs[0]!.finishedAt).not.toBeNull();
	});

	it('例外は外に出さず、失敗として記録する (1 つの失敗を、ほかの処理に波及させない)', async () => {
		const { runner, runs } = setup({ run: () => Promise.reject(new Error('つながらない')) });
		const result = await runner.runNow('test-job');
		expect(result).toEqual({ status: 'failed', message: 'つながらない' });
		expect(runs[0]).toMatchObject({ status: 'failed', message: 'つながらない' });
	});

	it('締め切りを過ぎたら、signal で中断を知らせ、失敗として記録する', async () => {
		let aborted = false;
		const { runner, runs } = setup({
			timeoutMs: 20,
			run: ({ signal }) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => {
						aborted = true;
						reject(new Error(String(signal.reason)));
					});
				}),
		});
		const result = await runner.runNow('test-job');
		expect(aborted).toBe(true);
		expect(result.status).toBe('failed');
		expect(result.message).toContain('締め切り');
		expect(runs[0]!.status).toBe('failed');
	});

	it('締め切りに気づかない処理でも、締め切りで結果を返す', async () => {
		const { runner } = setup({ timeoutMs: 20, run: () => new Promise(() => {}) });
		expect((await runner.runNow('test-job')).status).toBe('failed');
	});

	it('同じタスクが動いている間は、重ねて動かさず、飛ばしたことを記録する', async () => {
		let release: () => void = () => {};
		const run = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const { runner, runs } = setup({ run });
		const first = runner.runNow('test-job');
		const second = await runner.runNow('test-job');
		expect(second.status).toBe('skipped');
		expect(run).toHaveBeenCalledTimes(1);
		release();
		expect((await first).status).toBe('succeeded');
		expect(runs.map((r) => r.status).sort()).toEqual(['skipped', 'succeeded']);
	});

	it('終わったあとは、また動かせる', async () => {
		const run = vi.fn(() => Promise.resolve());
		const { runner } = setup({ run });
		await runner.runNow('test-job');
		await runner.runNow('test-job');
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('別のタスクは同時に動かせる', async () => {
		const { store } = memoryStore();
		let release: () => void = () => {};
		const runner = createJobRunner({
			jobs: [
				{
					name: 'a',
					schedule: '0 7 * * *',
					timeoutMs: 1000,
					run: () => new Promise<void>((resolve) => (release = resolve)),
				},
				{ name: 'b', schedule: '0 7 * * *', timeoutMs: 1000, run: () => Promise.resolve() },
			],
			store,
			log: silent,
			now: fixedNow,
		});
		const a = runner.runNow('a');
		expect((await runner.runNow('b')).status).toBe('succeeded');
		release();
		await a;
	});

	it('知らない名前のタスクは、分かる言葉で断る', async () => {
		const { runner } = setup({ run: () => Promise.resolve() });
		await expect(runner.runNow('ない')).rejects.toThrow(/ない/);
	});
});

describe('nextRuns', () => {
	it('cron 式を日本時間で読み、次の実行の時刻を返す (1 日 3 回: 7 時、12 時、18 時)', () => {
		const { runner } = setup({ schedule: '0 7,12,18 * * *', run: () => Promise.resolve() });
		const runs = runner.nextRuns('test-job', 4, new Date('2026-10-01T00:00:00Z'));
		// 日本時間 7 時、12 時、18 時は、UTC の 22 時 (前日)、3 時、9 時
		expect(runs.map((d) => d.toISOString())).toEqual([
			'2026-10-01T03:00:00.000Z',
			'2026-10-01T09:00:00.000Z',
			'2026-10-01T22:00:00.000Z',
			'2026-10-02T03:00:00.000Z',
		]);
	});
});

describe('stop', () => {
	it('動いている処理が終わるのを待ってから戻る', async () => {
		let finished = false;
		const { runner } = setup({
			run: async () => {
				await new Promise((resolve) => setTimeout(resolve, 30));
				finished = true;
			},
		});
		void runner.runNow('test-job');
		const stopped = await runner.stop({ graceMs: 1000 });
		expect(finished).toBe(true);
		expect(stopped).toEqual({ abandoned: [] });
	});

	it('待つ時間を過ぎても終わらない処理は、中断を知らせて、その名前を返す', async () => {
		let aborted = false;
		const { runner } = setup({
			run: ({ signal }) =>
				new Promise<void>(() => {
					signal.addEventListener('abort', () => (aborted = true));
				}),
		});
		void runner.runNow('test-job');
		const stopped = await runner.stop({ graceMs: 20 });
		expect(stopped).toEqual({ abandoned: ['test-job'] });
		expect(aborted).toBe(true);
	});

	it('止めたあとは、新しい処理を受け付けない', async () => {
		const run = vi.fn(() => Promise.resolve());
		const { runner } = setup({ run });
		await runner.stop({ graceMs: 10 });
		expect((await runner.runNow('test-job')).status).toBe('skipped');
		expect(run).not.toHaveBeenCalled();
	});
});

describe('start', () => {
	it('時刻になると、ゆらぎを待ってから動かす', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		try {
			vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
			const run = vi.fn(() => Promise.resolve());
			const sleeps: number[] = [];
			const { runner } = setup(
				{ schedule: '*/10 * * * * *', jitterMs: 5000, run },
				{
					random: () => 0.5,
					sleep: (ms: number) => {
						sleeps.push(ms);
						return Promise.resolve();
					},
				},
			);
			runner.start();
			await vi.advanceTimersByTimeAsync(10_500);
			expect(sleeps).toEqual([2500]);
			expect(run).toHaveBeenCalledTimes(1);
			await runner.stop({ graceMs: 10 });
		} finally {
			vi.useRealTimers();
		}
	});
});
