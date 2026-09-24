import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// パッケージごとの設定 (vitest.config.ts) を 1 回の実行にまとめる
export default defineConfig({
	test: {
		projects: [
			'packages/*',
			{
				// SvelteKit の Vite プラグインは作業ディレクトリを基準にするので、ここでは読み込まない。
				// .svelte のコンポーネントを試すときは @sveltejs/vite-plugin-svelte を足す
				resolve: {
					alias: { $lib: fileURLToPath(new URL('apps/web/src/lib', import.meta.url)) },
				},
				test: {
					name: 'web',
					root: 'apps/web',
					include: ['src/**/*.test.ts'],
					environment: 'node',
				},
			},
		],
	},
});
