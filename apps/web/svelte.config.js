import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// 静的ファイルを gzip と Brotli で事前に圧縮しておく (設計書 4.2)
		adapter: adapter({ precompress: true }),
		typescript: {
			// E2E テストと Playwright の設定も型の検査に含める
			config: (config) => {
				config['include'].push('../e2e/**/*.ts', '../playwright.config.ts');
			},
		},
	},
};

export default config;
