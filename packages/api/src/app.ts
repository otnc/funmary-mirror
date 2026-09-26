// 機械向けの口 (設計書 3 章)。SvelteKit のフックから、決まったパスだけがここに渡される。
import { Hono } from 'hono';
import { createAuthRoutes, type AuthRoutesDeps } from './auth-routes.ts';

export interface ApiDeps {
	/** ログインとログアウト。ないときは、その口を開けない */
	readonly auth?: AuthRoutesDeps;
	/** DB に読み書きできるか。例外を投げたときも、読み書きできないとみなす */
	readonly checkHealth: () => boolean;
}

export function createApi(deps: ApiDeps): Hono {
	const app = new Hono();
	if (deps.auth) app.route('/', createAuthRoutes(deps.auth));

	// 外部の監視サービスが 5 分ごとに見る。中身は "動いているか" だけにし、内部の情報は出さない
	app.get('/healthz', (c) => {
		c.header('Cache-Control', 'no-store');
		let healthy: boolean;
		try {
			healthy = deps.checkHealth();
		} catch {
			healthy = false;
		}
		return healthy ? c.json({ status: 'ok' }) : c.json({ status: 'unavailable' }, 503);
	});

	return app;
}
