// サーバーの起動と、リクエストの振り分け (設計書 3.2)。
// 起動時に設定を検証して DB を開き、機械向けのパスだけを Hono に渡す。
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Handle, ServerInit } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createApi } from '@funmary/api';
import { checkHealth, createJobRunStore, openDatabase } from '@funmary/db';
import { createJobRunner } from '@funmary/jobs';
import { createAdminAlerter } from '@funmary/notify';
import { createLogger, type Logger } from '@funmary/log';
import { parseConfig } from '$lib/server/config.ts';
import { findMigrationsFolder } from '$lib/server/migrations-path.ts';

/** Hono に渡すパス。これ自身か、この下のパスが対象になる */
const API_PATHS = ['/api', '/auth', '/cal', '/feed', '/healthz', '/mcp'];

/** 定期処理の実行記録を残す期間 */
const JOB_RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** 停止するときに、実行中の定期処理を待つ時間 (設計書 4.5)。systemd の TimeoutStopSec より短くする */
const SHUTDOWN_GRACE_MS = 10_000;

/** 開発サーバーで動くときの、リポジトリのルート (このファイルは apps/web/src にある) */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

let api: ReturnType<typeof createApi> | undefined;
let logger: Logger | undefined;

export const init: ServerInit = () => {
	const result = parseConfig(env);
	if (!result.ok) {
		const lines = result.issues.map((issue) => `  ${issue.name}: ${issue.message}`);
		throw new Error(
			[
				'環境変数に足りない値か誤りがあるので、起動を止めます。次の変数を直してください。',
				...lines,
			].join('\n'),
		);
	}
	logger = createLogger({
		level: result.config.logLevel,
		format: result.config.logFormat,
		mode: result.config.mode,
	});
	// 開発サーバーは apps/web で動くが、.env と既定の ./data はリポジトリのルートに置く (管理用コマンドと同じ DB を使う)
	const dataDir = dev ? resolve(REPO_ROOT, result.config.dataDir) : result.config.dataDir;
	mkdirSync(dataDir, { recursive: true });
	// 開くときに、壊れていないかの確認とマイグレーションまで行う。
	// ビルドしたものでは、scripts/copy-migrations.ts がサーバーの出力に写したマイグレーションを、上の階層へたどって探す
	const bundledMigrations = findMigrationsFolder(dirname(fileURLToPath(import.meta.url)));
	const database = openDatabase(join(dataDir, 'funmary.db'), {
		backupDir: join(dataDir, 'backups'),
		...(bundledMigrations && { migrationsFolder: bundledMigrations }),
	});
	// 起動したときに、前回の途中で止まって "running" のまま残った記録を閉じ、古い記録を消す
	const jobRunStore = createJobRunStore(database);
	const interrupted = jobRunStore.closeInterrupted(new Date());
	if (interrupted > 0)
		logger.withTag('app').warn(`途中で止まった定期処理の記録を ${interrupted} 件閉じました`);
	jobRunStore.prune(new Date(Date.now() - JOB_RUN_RETENTION_MS));

	// 定期処理。個々の処理は、取得の実装ができたところで足す
	const alerter = createAdminAlerter({
		webhookUrl: result.config.adminDiscordWebhookUrl,
		dryRun: result.config.notifyDryRun,
		log: logger,
	});
	const runner = createJobRunner({
		jobs: [],
		store: jobRunStore,
		log: logger,
		// 失敗したら、管理者に知らせる。同じタスクの失敗は、1 時間に 1 回までにまとまる
		onFinish: async (job, outcome) => {
			if (outcome.status !== 'failed') return;
			await alerter.send({
				severity: 'error',
				title: `定期処理 ${job} が失敗しました`,
				...(outcome.message && { message: outcome.message }),
				key: `job:${job}`,
			});
		},
	});
	runner.start();

	// adapter-node は、SIGTERM を受けるとこのイベントを出して、終わるのを待つ (待つ時間の上限は SHUTDOWN_TIMEOUT)。
	// 新しい処理を止め、実行中の処理を待ってから、書きかけのデータを残さないように DB を閉じる
	// eslint-disable-next-line @typescript-eslint/no-misused-promises -- adapter-node が、リスナーの返す Promise を待つ
	process.once('sveltekit:shutdown', async () => {
		const { abandoned } = await runner.stop({ graceMs: SHUTDOWN_GRACE_MS });
		if (abandoned.length > 0) {
			logger?.withTag('app').warn(`終わらなかった定期処理を中断しました: ${abandoned.join('、')}`);
		}
		database.close();
	});

	api = createApi({ checkHealth: () => checkHealth(database) });
	logger.withTag('app').info(`起動しました (${result.config.mode}、DB は ${dataDir})`);
};

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const started = performance.now();
	const response =
		api && API_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
			? await api.fetch(event.request)
			: await resolve(event);
	// 死活監視は 5 分ごとに来るので、info には出さない。トークンは logger が伏せる
	const log = logger?.withTag('http');
	const line = `${event.request.method} ${path} ${response.status} ${Math.round(performance.now() - started)} ms`;
	if (path === '/healthz') log?.debug(line);
	else log?.info(line);
	return response;
};
