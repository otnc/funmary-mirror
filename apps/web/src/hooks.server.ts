// サーバーの起動と、リクエストの振り分け (設計書 3.2)。
// 起動時に設定を検証して DB を開き、機械向けのパスだけを Hono に渡す。
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Handle, ServerInit } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createApi } from '@funmary/api';
import { checkHealth, openDatabase } from '@funmary/db';
import { createLogger, type Logger } from '@funmary/log';
import { parseConfig } from '$lib/server/config.ts';

/** Hono に渡すパス。これ自身か、この下のパスが対象になる */
const API_PATHS = ['/api', '/auth', '/cal', '/feed', '/healthz', '/mcp'];

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
	// ビルドしたものでは、scripts/copy-migrations.ts がサーバーの出力の隣に写したマイグレーションを使う
	const bundledMigrations = fileURLToPath(new URL('../migrations', import.meta.url));
	const database = openDatabase(join(dataDir, 'funmary.db'), {
		backupDir: join(dataDir, 'backups'),
		...(existsSync(bundledMigrations) && { migrationsFolder: bundledMigrations }),
	});
	// adapter-node は、停止するときにこのイベントを出す。書きかけのデータを残さないように DB を閉じる
	process.once('sveltekit:shutdown', () => database.close());

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
