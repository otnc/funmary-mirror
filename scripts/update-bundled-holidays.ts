// 内閣府の祝日の CSV を取得して、同梱のデータ (packages/sources/src/holidays/bundled-data.ts) を作り直す。
// 使い方: node scripts/update-bundled-holidays.ts
// 初回の起動で内閣府に届かないときの備えなので、ときどき (年に 1 回ほど) 更新すればよい。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
// ルートは @funmary/sources に依存しないので、ファイルを直接読み込む
import { HOLIDAY_CSV_URL } from '../packages/sources/src/holidays/fetch.ts';
import { decodeHolidayCsv, parseHolidayCsv } from '../packages/sources/src/holidays/parse.ts';

const response = await fetch(HOLIDAY_CSV_URL);
if (!response.ok) throw new Error(`取得できませんでした: HTTP ${response.status}`);
const csv = decodeHolidayCsv(new Uint8Array(await response.arrayBuffer()))
	.replaceAll('\r\n', '\n')
	.trimEnd();
// 読めない内容を同梱しないように、解析できるかを先に確かめる
const parsed = parseHolidayCsv(csv);
if (parsed.kind !== 'ok') throw new Error(parsed.reason);
if (csv.includes('`') || csv.includes('${') || csv.includes('\\')) {
	throw new Error('テンプレート文字列に入れられない文字があります');
}

const last = parsed.holidays.at(-1)?.date;
const today = new Date().toISOString().slice(0, 10);
const source = `// 内閣府の「国民の祝日について」の CSV (${HOLIDAY_CSV_URL}) を、UTF-8 にして写したもの。
// 出典: 内閣府「国民の祝日について」。文字コードを UTF-8 にして写している (加工)。
// ${today} に取得。${last} までの祝日と休日 (振替休日を含む) が載っている。
// このファイルは scripts/update-bundled-holidays.ts が作るので、手で書き換えない。
// 起動したときに内閣府へ届かなくても、祝日が分かるようにするための備えで、取得できたあとはそちらを使う。
export const BUNDLED_HOLIDAY_CSV = \`${csv}
\`;
`;
writeFileSync(
	join(import.meta.dirname, '../packages/sources/src/holidays/bundled-data.ts'),
	source,
);
console.log(`${parsed.holidays.length} 件 (${last} まで) を書きました`);
