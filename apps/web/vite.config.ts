import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// 単体テストの設定はルートの vitest.config.ts に置く
export default defineConfig({
	plugins: [sveltekit()],
});
