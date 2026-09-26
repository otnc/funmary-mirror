import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseTimetableItems, type PdfTextItem } from './grid.ts';

// 実物の PDF (令和 8 年度 後期 時間割) と同じ配置の、架空の内容の文字の配列を作る。
// 曜日ごとに、科目、クラス、部屋の 3 つの列があり、それぞれの左端の x は決まっている。
const ANCHORS = [
	[21, 124, 149],
	[180, 283, 309],
	[346, 448, 474],
	[500, 602, 628],
	[654, 756, 782],
] as const;
/** 時限の行の先頭の y (1 限から 6 限) */
const ROW_Y = [523, 450, 367, 271, 185, 113] as const;
const PITCH = 7.5;

const item = (text: string, x: number, y: number, height = 4): PdfTextItem => ({
	text,
	x,
	y,
	height,
});

interface CellEntry {
	day: number;
	period: number;
	/** その時限の中で、上から何番目の科目か (0 から) */
	row: number;
	subject: string;
	classes?: string;
	room?: string;
}

/** 表の枠 (時限の見出し、列の見出し、表題) と、指定した科目を並べた文字の配列 */
function layout(entries: CellEntry[], extra: PdfTextItem[] = []): PdfTextItem[] {
	const items: PdfTextItem[] = [
		item('令和８年度 後期 時間割', 388, 550, 5),
		item('2026/9/9', 788, 543),
		...ROW_Y.map((y, i) => item(`${'１２３４５６'[i]}時限`, 7, y)),
		item('【集中講義】', 98, 90),
		item('【クラス区分】', 317, 90),
	];
	for (const g of ANCHORS) {
		items.push(
			item('科目', g[0] + 47, 530),
			item('クラス', g[1] + 6, 530),
			item('部屋', g[2] + 4, 530),
		);
	}
	for (const e of entries) {
		const a = ANCHORS[e.day - 1]!;
		const y = ROW_Y[e.period - 1]! - e.row * PITCH;
		items.push(item(e.subject, a[0], y));
		if (e.classes !== undefined) items.push(item(e.classes, a[1], y));
		if (e.room !== undefined) items.push(item(e.room, a[2], y));
	}
	return [...items, ...extra];
}

/** 列の位置を見つけるためには、各列に十分な数の文字が要る。全曜日に、目印になる科目を並べる */
function filler(): CellEntry[] {
	const rows: CellEntry[] = [];
	for (let day = 1; day <= 5; day++) {
		for (let period = 1; period <= 5; period++) {
			for (let row = 0; row < 2; row++) {
				rows.push({
					day,
					period,
					row: row + 20, // 実際の科目と重ならない、表の外に近い位置。後で除く
					subject: `埋め${day}${period}${row}`,
				});
			}
		}
	}
	return rows;
}
void filler;

/** 各列に 8 個以上の文字を置いて、列の位置を確実に見つけられるようにした、基本の表 */
function baseEntries(): CellEntry[] {
	const rows: CellEntry[] = [];
	for (let day = 1; day <= 5; day++) {
		for (let period = 1; period <= 4; period++) {
			rows.push({
				day,
				period,
				row: 3,
				subject: `基本科目${day}${period}（教員）`,
				classes: '1-AB',
				room: '590',
			});
		}
	}
	return rows;
}

const parse = (entries: CellEntry[], extra: PdfTextItem[] = []) =>
	parseTimetableItems(layout([...baseEntries(), ...entries], extra));

function find(result: ReturnType<typeof parse>, subject: string) {
	if (result.kind !== 'ok') throw new Error(`読めるはず: ${JSON.stringify(result)}`);
	return result.entries.find((e) => e.subject === subject);
}

describe('時間割 PDF の格子の解析', () => {
	it('学期、更新日、年度を、表題と日付から読む', () => {
		const result = parse([]);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.term).toBe('fall');
		expect(result.updatedOn).toBe('2026-09-09');
		expect(result.academicYear).toBe(2026);
	});

	it('曜日と時限、科目名、教員、クラス、部屋を読む', () => {
		const result = parse([
			{
				day: 2,
				period: 3,
				row: 0,
				subject: '数学総合演習Ⅱ（義永, 加納）',
				classes: '1-ABCD',
				room: '大講義室',
			},
		]);
		expect(find(result, '数学総合演習Ⅱ')).toMatchObject({
			weekday: 2,
			period: 3,
			teachers: ['義永', '加納'],
			classes: '1-ABCD',
			rooms: ['大講義室'],
			quarter: null,
		});
	});

	it('クォーター科目の接頭辞 (3Q: など) を、科目名から分けて、quarter にする', () => {
		const result = parse([
			{
				day: 1,
				period: 1,
				row: 0,
				subject: '3Q: プログラミング基礎（和田）',
				classes: '1-AB',
				room: '365',
			},
			{
				day: 1,
				period: 1,
				row: 1,
				subject: '4Q: 情報表現基礎Ⅰ（安井）',
				classes: '1-AB',
				room: '595，ｱﾄﾘｴ',
			},
			{
				day: 1,
				period: 1,
				row: 2,
				subject: '１Q: 数値解析（加藤譲）',
				classes: '3-GHI',
				room: '595',
			},
			{
				day: 1,
				period: 2,
				row: 0,
				subject: '4Q:コミュニケーション論 （廣田）',
				classes: '1～4',
				room: '595',
			},
		]);
		expect(find(result, 'プログラミング基礎')).toMatchObject({ quarter: 'q3' });
		expect(find(result, '情報表現基礎Ⅰ')).toMatchObject({ quarter: 'q4' });
		expect(find(result, '数値解析')).toMatchObject({ quarter: 'q1' });
		expect(find(result, 'コミュニケーション論')).toMatchObject({ quarter: 'q4', classes: '1～4' });
	});

	it('教員の「ほか」は、名前に含めない', () => {
		const result = parse([
			{
				day: 5,
				period: 1,
				row: 0,
				subject: 'データサイエンス入門（香取，佐藤直ほか）',
				classes: '1',
				room: 'オンライン',
			},
		]);
		expect(find(result, 'データサイエンス入門')?.teachers).toEqual(['香取', '佐藤直']);
	});

	it('クラスの範囲の波線 (~ 〜 ～) は、～ にそろえる', () => {
		const result = parse([
			{ day: 1, period: 3, row: 0, subject: '甲（a）', classes: '1〜4', room: '1' },
			{ day: 1, period: 3, row: 1, subject: '乙（b）', classes: '1~4', room: '1' },
		]);
		expect(find(result, '甲')?.classes).toBe('1～4');
		expect(find(result, '乙')?.classes).toBe('1～4');
	});

	it('部屋は、区切り (, ， ･ ・ /) で分け、半角カナを全角にそろえる', () => {
		const result = parse([
			{ day: 3, period: 1, row: 0, subject: 'A（甲）', classes: '1', room: '363, 364, ｱﾄﾘｴ' },
			{ day: 3, period: 1, row: 1, subject: 'B（乙）', classes: '1', room: 'E工房・484' },
			{ day: 3, period: 1, row: 2, subject: 'C（丙）', classes: '1', room: '講堂/ｵﾝﾗｲﾝ' },
			{ day: 3, period: 2, row: 0, subject: 'D（丁）', classes: '1', room: 'E工房(364)' },
		]);
		expect(find(result, 'A')?.rooms).toEqual(['363', '364', 'アトリエ']);
		expect(find(result, 'B')?.rooms).toEqual(['E工房', '484']);
		expect(find(result, 'C')?.rooms).toEqual(['講堂', 'オンライン']);
		expect(find(result, 'D')?.rooms).toEqual(['E工房(364)']);
	});

	it('クラスや部屋がない科目も読める', () => {
		const result = parse([
			{ day: 1, period: 4, row: 0, subject: 'キャリアガイダンス', room: '大講義室, ｵﾝﾗｲﾝ' },
			{ day: 1, period: 4, row: 1, subject: '卒業研究（指導教員）', classes: '4' },
		]);
		expect(find(result, 'キャリアガイダンス')).toMatchObject({
			classes: null,
			rooms: ['大講義室', 'オンライン'],
		});
		expect(find(result, '卒業研究')).toMatchObject({ classes: '4', rooms: [] });
	});

	it('※ で始まる行は、前の科目の注記にする。クラスと部屋は、2 行の科目の間にあっても、その科目に付く', () => {
		const a = ANCHORS[3];
		const result = parse(
			[],
			[
				item('ソフトウェア工学（奥野）', a[0], 410 + 2),
				item('※旧 ソフトウェア設計論Ⅰ', a[0], 410 - 3, 3),
				item('2-ABCD', a[1], 410),
				item('講堂', a[2], 410),
				item('次の科目（丙）', a[0], 410 - 10),
				item('3-A', a[1], 410 - 10),
				item('591', a[2], 410 - 10),
			],
		);
		expect(find(result, 'ソフトウェア工学')).toMatchObject({
			classes: '2-ABCD',
			rooms: ['講堂'],
			notes: ['※旧 ソフトウェア設計論Ⅰ'],
		});
		expect(find(result, '次の科目')).toMatchObject({ classes: '3-A', rooms: ['591'] });
	});

	it('カッコが閉じていない行は、次の行に続くものとして、1 つの科目にする', () => {
		const a = ANCHORS[0];
		const result = parse(
			[],
			[
				item('データサイエンス演習（中小路,寺沢,新美,', a[0], 300),
				item('Hamidani） ※旧パターン認識', a[0], 295),
				item('3-ABCD', a[1], 298),
				item('大講義室', a[2], 298),
			],
		);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		const found = result.entries.find((e) => e.subject === 'データサイエンス演習');
		expect(found?.teachers).toEqual(['中小路', '寺沢', '新美', 'Hamidani']);
		expect(found).toMatchObject({ classes: '3-ABCD', rooms: ['大講義室'] });
	});

	it('部屋が 2 行に分かれていても、1 つにつなぐ', () => {
		const a = ANCHORS[1];
		const result = parse(
			[],
			[
				item('技術者倫理（平野）', a[0], 300),
				item('3', a[1], 300),
				item('オンライン, 講堂,', a[2], 302),
				item('493,594,595', a[2], 297),
			],
		);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.entries.find((e) => e.subject === '技術者倫理')?.rooms).toEqual([
			'オンライン',
			'講堂',
			'493',
			'594',
			'595',
		]);
	});

	it('1 つの科目に複数の科目が書かれている場合は、教員をすべて集め、科目名は最初のものにする', () => {
		const result = parse([
			{
				day: 3,
				period: 3,
				row: 0,
				subject: '並列分散処理（松原克）・システムプログラミング（松原克）',
				classes: '3-ABCD',
				room: '364, 595',
			},
		]);
		const found = find(result, '並列分散処理');
		expect(found?.title).toBe('並列分散処理（松原克）・システムプログラミング（松原克）');
		expect(found?.teachers).toEqual(['松原克', '松原克']);
	});

	it('時限ごとの範囲で、行を分ける', () => {
		const result = parse([
			{ day: 5, period: 5, row: 0, subject: '五限の科目（甲）', classes: '2', room: '592' },
		]);
		expect(find(result, '五限の科目')).toMatchObject({ weekday: 5, period: 5 });
	});

	it('集中講義を、「・」で始まる行から読む', () => {
		const result = parse(
			[],
			[
				item('・物質の科学 1～4（中垣）', 124, 90),
				item('・UCD実践 3-ICT（未定）　※2026以降入学者対象科目', 124, 84),
				item('・教室定員等により履修制限を行うことがあります。', 654, 84),
			],
		);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.intensive).toEqual([
			expect.objectContaining({ subject: '物質の科学', classes: '1～4', teachers: ['中垣'] }),
			expect.objectContaining({ subject: 'UCD実践', classes: '3-ICT', teachers: ['未定'] }),
		]);
	});

	it('列の位置は、重み (揃った文字の数) の順に選ぶので、少数の文字が別の x に揃っていても、影響しない', () => {
		// 表の外側 (科目の列の左) に、少数の文字が、同じ x に揃っている。重みが小さいので、列の位置には選ばれない
		const noise = [1, 2, 3].map((i) => item(`注${i}`, 5, 480 - i * 30));
		const withNoise = parseTimetableItems(layout(baseEntries(), noise), { minAnchorWeight: 3 });
		const without = parseTimetableItems(layout(baseEntries()));
		if (withNoise.kind !== 'ok' || without.kind !== 'ok') throw new Error('読めるはず');
		expect(withNoise.entries).toEqual(without.entries);
	});

	it('許容範囲は、設定で変えられる', () => {
		// クラスの列の文字が、半分は x=124、半分は x=127 に揃っている (PDF の作り方の揺れ)。
		// 許容範囲が狭いと、別の列と数えられ、重みが足りずに、列の位置を 15 個見つけられない
		let toggle = false;
		const items = layout(baseEntries()).map((i) =>
			i.x === 124 && (toggle = !toggle) ? { ...i, x: 127 } : i,
		);
		expect(parseTimetableItems(items, { xTolerance: 0.5 }).kind).toBe('invalid');
		expect(parseTimetableItems(items, { xTolerance: 4 }).kind).toBe('ok');
	});

	it('読み取りの質を、数値で返す', () => {
		const result = parseTimetableItems(layout(baseEntries()));
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.quality).toMatchObject({ entryCount: 20, classRatio: 1, roomRatio: 1 });
		expect(result.quality.weakestAnchorWeight).toBeGreaterThanOrEqual(4);
	});

	it('コマの数が少なすぎる、またはクラスや部屋の割合が低ければ、警告する (結果は返す)', () => {
		const result = parseTimetableItems(layout(baseEntries()), { minEntries: 100 });
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.warnings.some((w) => w.includes('20 件しかありません'))).toBe(true);

		// 各曜日の 1 限のコマから、クラスを除く (列の位置を見つけるために、各列に 3 個以上は残す)
		const sparse = baseEntries().map((e) => {
			if (e.period !== 1) return e;
			return {
				day: e.day,
				period: e.period,
				row: e.row,
				subject: e.subject,
				...(e.room !== undefined && { room: e.room }),
			};
		});
		const low = parseTimetableItems(layout(sparse), { minEntries: 1 });
		if (low.kind !== 'ok') throw new Error('読めるはず');
		expect(low.quality.classRatio).toBe(0.75);
		expect(low.warnings.some((w) => w.includes('クラスが付いたコマの割合'))).toBe(true);
	});
	it('時限の見出しが足りなければ、構造が変わったものとして知らせる', () => {
		const items = layout(baseEntries()).filter((i) => i.text !== '３時限');
		expect(parseTimetableItems(items).kind).toBe('invalid');
	});

	it('列の位置を見つけられなければ、構造が変わったものとして知らせる', () => {
		const items = layout([]);
		expect(parseTimetableItems(items).kind).toBe('invalid');
	});

	it('空の入力は、例外にせず invalid にする', () => {
		expect(parseTimetableItems([]).kind).toBe('invalid');
	});

	it('でたらめな文字の配列でも、例外にならず、ok か invalid を返す', () => {
		const arbitrary = fc.array(
			fc.record({
				text: fc.oneof(
					fc.string({ maxLength: 12 }),
					fc.constantFrom(
						'１時限',
						'２時限',
						'３時限',
						'４時限',
						'５時限',
						'６時限',
						'（',
						'）',
						'※旧',
						'・',
						'3Q:',
					),
				),
				x: fc.integer({ min: -50, max: 900 }),
				y: fc.integer({ min: -50, max: 700 }),
				height: fc.integer({ min: 0, max: 12 }),
			}),
			{ maxLength: 120 },
		);
		fc.assert(
			fc.property(arbitrary, (items) => {
				expect(['ok', 'invalid']).toContain(parseTimetableItems(items).kind);
			}),
			{ numRuns: 200 },
		);
	});
});
