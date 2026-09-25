import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// 静的ファイルを gzip と Brotli で事前に圧縮しておく (設計書 4.2)
		adapter: adapter({ precompress: true }),
		// .env はリポジトリのルートに置く (設計書 19.3)。管理用コマンドと同じファイルを読む
		env: { dir: '../..' },
		typescript: {
			// E2E テスト、ビルドの補助のスクリプト、Playwright の設定も型の検査に含める
			config: (config) => {
				config['include'].push('../e2e/**/*.ts', '../scripts/**/*.ts', '../playwright.config.ts');
			},
		},
	},
};

export default config;
