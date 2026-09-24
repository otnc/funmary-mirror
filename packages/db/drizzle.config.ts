import { defineConfig } from 'drizzle-kit';

// スキーマからマイグレーションの SQL を作る設定。`pnpm --filter @funmary/db generate` で使う
export default defineConfig({
	dialect: 'sqlite',
	schema: './src/schema.ts',
	out: './migrations',
});
