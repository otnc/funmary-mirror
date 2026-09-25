// DB のマイグレーションのファイルを、ビルドしたサーバーの隣に写す。vite build のあとに動かす。
// サーバーのコードは 1 つにまとめられるので、DB のパッケージが自分の隣から探す既定の場所が使えない。
// フック (src/hooks.server.ts) は、自分から見た ../migrations を探す。
import { cpSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url));
const targets = [
	// vite preview (E2E テスト) が使う出力
	'../.svelte-kit/output/server/migrations',
	// adapter-node が作る、本番で動かす出力
	'../build/server/migrations',
];

for (const target of targets) {
	const path = fileURLToPath(new URL(target, import.meta.url));
	if (!existsSync(dirname(path))) {
		throw new Error(
			`ビルドの出力がありません。先に vite build を動かしてください: ${dirname(path)}`,
		);
	}
	cpSync(source, path, { recursive: true });
}
