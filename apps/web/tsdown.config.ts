import { defineConfig } from 'tsdown';

// 管理用コマンドを、本番で node だけで動かせる 1 つの JavaScript にまとめる (設計書 20.6)。
// better-sqlite3 は C++ の拡張なので同梱せず、リリースの package.json から入れる
export default defineConfig({
	entry: { cli: 'src/cli.ts' },
	format: 'esm',
	platform: 'node',
	target: 'node24',
	outDir: 'dist',
	clean: true,
	// 拡張子は .js にする。package.json の type が module なので ESM として動く
	fixedExtension: false,
	// 同梱するのは、本番の依存に入れない部品だけ。増えたときは、意図したものかを確かめてからここに足す
	deps: { onlyBundle: ['citty', 'drizzle-orm', 'valibot'] },
	// 依存の版はリリースで固定するので、宣言ファイルは要らない
	dts: false,
});
