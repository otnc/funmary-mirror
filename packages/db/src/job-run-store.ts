// 定期処理の実行記録 (job_runs)。@funmary/jobs の JobRunStore を DB で実装する (設計書 11 章)。
import { and, desc, eq, lt, ne } from 'drizzle-orm';
import type { Database } from './database.ts';
import { jobRuns } from './schema.ts';

export type JobRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

export interface StoredJobRun {
	readonly id: number;
	readonly job: string;
	readonly startedAt: Date;
	readonly finishedAt: Date | null;
	readonly status: JobRunStatus;
	readonly message: string | null;
}

export interface JobRunStore {
	start(job: string, startedAt: Date): number;
	finish(
		id: number,
		status: Exclude<JobRunStatus, 'running'>,
		message: string | null,
		at: Date,
	): void;
	recordSkipped(job: string, at: Date, message: string): void;
	/** そのタスクの記録を、新しい順に count 件 */
	recent(job: string, count: number): StoredJobRun[];
	/**
	 * 起動したときに、"running" のまま残っている記録を失敗として閉じ、その数を返す。
	 * プロセスが途中で落ちると、終わりを書き込めずに残るため
	 */
	closeInterrupted(at: Date): number;
	/** before より前に始まった記録を消し、その数を返す。動いている最中のものは消さない */
	prune(before: Date): number;
}

export function createJobRunStore(database: Database): JobRunStore {
	const { db } = database;
	return {
		start(job, startedAt) {
			return db
				.insert(jobRuns)
				.values({ job, startedAt, status: 'running' })
				.returning({ id: jobRuns.id })
				.get().id;
		},
		finish(id, status, message, at) {
			db.update(jobRuns).set({ status, message, finishedAt: at }).where(eq(jobRuns.id, id)).run();
		},
		recordSkipped(job, at, message) {
			db.insert(jobRuns)
				.values({ job, startedAt: at, finishedAt: at, status: 'skipped', message })
				.run();
		},
		recent(job, count) {
			return db
				.select()
				.from(jobRuns)
				.where(eq(jobRuns.job, job))
				.orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
				.limit(count)
				.all();
		},
		closeInterrupted(at) {
			return db
				.update(jobRuns)
				.set({
					status: 'failed',
					finishedAt: at,
					message: '途中でプロセスが止まったので、失敗として閉じました',
				})
				.where(eq(jobRuns.status, 'running'))
				.run().changes;
		},
		prune(before) {
			return db
				.delete(jobRuns)
				.where(and(lt(jobRuns.startedAt, before), ne(jobRuns.status, 'running')))
				.run().changes;
		},
	};
}
