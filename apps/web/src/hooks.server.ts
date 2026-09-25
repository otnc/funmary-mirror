// サーバーの起動と、リクエストの振り分け (設計書 3.2)。
// 起動時に設定を検証して DB を開き、機械向けのパスだけを Hono に渡す。
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Handle, ServerInit } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createApi } from '@funmary/api';
import { checkHealth, openDatabase } from '@funmary/db';
import { parseConfig } from '$lib/server/config.ts';

/** Hono に渡すパス。これ自身か、この下のパスが対象になる */
const API_PATHS = ['/api', '/auth', '/cal', '/feed', '/healthz', '/mcp'];

let api: ReturnType<typeof createApi> | undefined;

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
	const { dataDir } = result.config;
	mkdirSync(dataDir, { recursive: true });
	// 開くときに、壊れていないかの確認とマイグレーションまで行う。
	// ビルドしたものでは、vite.config.ts がサーバーの出力の隣に写したマイグレーションを使う
	const bundledMigrations = fileURLToPath(new URL('../migrations', import.meta.url));
	const database = openDatabase(join(dataDir, 'funmary.db'), {
		backupDir: join(dataDir, 'backups'),
		...(existsSync(bundledMigrations) && { migrationsFolder: bundledMigrations }),
	});
	// adapter-node は、停止するときにこのイベントを出す。書きかけのデータを残さないように DB を閉じる
	process.once('sveltekit:shutdown', () => database.close());

	api = createApi({ checkHealth: () => checkHealth(database) });
};

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	if (api && API_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
		return api.fetch(event.request);
	}
	return resolve(event);
};
