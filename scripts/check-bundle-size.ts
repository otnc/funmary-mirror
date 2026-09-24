// ページごとに端末へ送る JavaScript の量を測り、目標 (設計書 4.1) を超えたら失敗にする。
// `pnpm build` の最後に実行する。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_BYTES = 60 * 1024;
const CLIENT_DIR = join(import.meta.dirname, '../apps/web/.svelte-kit/output/client');

interface ManifestChunk {
	file: string;
	src?: string;
	isEntry?: boolean;
	imports?: string[];
}

const manifest = JSON.parse(
	readFileSync(join(CLIENT_DIR, '.vite/manifest.json'), 'utf8'),
) as Record<string, ManifestChunk>;

const sizeCache = new Map<string, number>();
function gzipSize(file: string): number {
	let size = sizeCache.get(file);
	if (size === undefined) {
		size = gzipSync(readFileSync(join(CLIENT_DIR, file))).length;
		sizeCache.set(file, size);
	}
	return size;
}

/** チャンクと、そこから静的に読み込まれるチャンクのファイル名をすべて集める */
function collectFiles(key: string, files = new Set<string>()): Set<string> {
	const chunk = manifest[key];
	if (!chunk || files.has(chunk.file)) return files;
	files.add(chunk.file);
	for (const imported of chunk.imports ?? []) collectFiles(imported, files);
	return files;
}

const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
const shared = entries.filter(([, chunk]) => chunk.file.includes('/entry/')).map(([key]) => key);
const nodes = entries.filter(([, chunk]) => chunk.file.includes('/nodes/'));

// 各ページのノードは、どのページでも読み込むエントリ (start と app) と一緒に送られる。
// レイアウトのノードも含めて多めに見積もるため、ノードごとに共通部分を足して測る
let failed = false;
for (const [key, chunk] of nodes) {
	const files = new Set<string>();
	for (const entry of [...shared, key]) collectFiles(entry, files);
	const total = [...files].reduce((sum, file) => sum + gzipSize(file), 0);
	const over = total > LIMIT_BYTES;
	failed ||= over;
	const name = chunk.src ?? key;
	console.log(`${over ? 'NG' : 'OK'} ${(total / 1024).toFixed(1).padStart(6)} KB  ${name}`);
}

if (nodes.length === 0) {
	console.error('ページのチャンクが見つかりません。ビルドの出力の形が変わった可能性があります');
	process.exit(1);
}
if (failed) {
	console.error(`圧縮後 ${LIMIT_BYTES / 1024} KB を超えたページがあります`);
	process.exit(1);
}
