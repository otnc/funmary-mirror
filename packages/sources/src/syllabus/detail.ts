// 公開シラバスの詳細 (Lesson/Syllabus) を解析する (設計書 9.4)。
// 取得した HTML は信用しない。項目は見出し (th) の名前で探し、位置には頼らない。
// 知らない項目が増えても、attributes か sections にそのまま入れる。
import type { Term } from '@funmary/core';
import type { Element, Root } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { select, selectAll } from 'hast-util-select';
import { toText } from 'hast-util-to-text';
import { normalizeLabel } from '../html/table.ts';

export interface SyllabusDetail {
	readonly name: string;
	/** 先頭の ◎ などの記号を除いた、担当教員名 */
	readonly teacher: string | null;
	readonly credits: number | null;
	readonly term: Term;
	/** 表の短い項目 (配当年次、授業形態など)。名前をキーにする。空 (-) の項目は入れない */
	readonly attributes: ReadonlyMap<string, string>;
	/** 長い本文の項目 (授業の概要、到達目標、授業内容とスケジュールなど) */
	readonly sections: ReadonlyMap<string, string>;
}

export type SyllabusDetailResult =
	| { readonly kind: 'ok'; readonly detail: SyllabusDetail }
	/** 必要な項目が読めなかった。ページの構造が変わったか、想定外の内容 */
	| { readonly kind: 'invalid'; readonly reason: string };

const MAX_ATTRIBUTE_LENGTH = 500;
const MAX_SECTION_LENGTH = 10_000;

/** 本文として扱う項目。ほかの項目は、短い属性として扱う */
const SECTION_LABELS = new Set(
	[
		'授業の概要',
		'授業の到達目標',
		'成績の評価方法・基準',
		'テキスト',
		'参考書',
		'履修条件',
		'事前学習',
		'事後学習',
		'履修上の留意点',
		'授業・試験の形式',
	].map(normalizeLabel),
);

const SCHEDULE_LABEL = '授業内容とスケジュール';

const TERMS = new Map<string, Term>([
	['前期', 'spring'],
	['後期', 'fall'],
	['通年', 'full-year'],
	['1Q', 'q1'],
	['2Q', 'q2'],
	['3Q', 'q3'],
	['4Q', 'q4'],
]);

/** 開講期の表記から Term を決める。夏期集中、冬期集中は、開講期の表記か、授業名の "夏期集中" などで見分ける */
function termFrom(label: string | undefined, name: string): Term | undefined {
	const known = label === undefined ? undefined : TERMS.get(normalizeLabel(label));
	if (known) return known;
	const text = normalizeLabel(`${label ?? ''}${name}`);
	if (/夏期?集中/.test(text)) return 'summer-intensive';
	if (/冬期?集中/.test(text)) return 'winter-intensive';
	return undefined;
}

/** 制御文字を除き、前後の空白を取り、長さの上限で切る (改行は残す) */
function clean(text: string, max: number): string {
	return text
		.replace(/\p{Cc}/gu, (char) => (char === '\n' ? char : ''))
		.replace(/[ \t\u3000]+\n/g, '\n')
		.trim()
		.slice(0, max);
}

function textOf(element: Element, max: number): string {
	return clean(toText(element), max);
}

/** 行 (tr) の中の、見出し (th) と、その次の値 (td) の組を順に返す */
function* labelValuePairs(tree: Root): Generator<{ label: string; value: Element }> {
	for (const row of selectAll('tr', tree)) {
		let label: string | undefined;
		for (const child of row.children) {
			if (child.type !== 'element') continue;
			if (child.tagName === 'th') label = normalizeLabel(toText(child));
			else if (child.tagName === 'td' && label !== undefined) {
				yield { label, value: child };
				label = undefined;
			}
		}
	}
}

export function parseSyllabusDetail(html: string): SyllabusDetailResult {
	let tree: Root;
	try {
		tree = fromHtml(html);
	} catch {
		return { kind: 'invalid', reason: 'HTML を読めませんでした' };
	}

	const attributes = new Map<string, string>();
	const sections = new Map<string, string>();
	for (const { label, value } of labelValuePairs(tree)) {
		if (label === '') continue;
		if (SECTION_LABELS.has(label)) {
			const text = textOf(value, MAX_SECTION_LENGTH);
			if (text !== '' && text !== '-') sections.set(label, text);
		} else {
			const text = textOf(value, MAX_ATTRIBUTE_LENGTH);
			if (text !== '' && text !== '-') attributes.set(label, text);
		}
	}
	const schedule = select('#auto_syllabus_details', tree);
	if (schedule) {
		const text = textOf(schedule, MAX_SECTION_LENGTH);
		if (text !== '') sections.set(SCHEDULE_LABEL, text);
	}

	const name = attributes.get('授業名');
	if (!name) return { kind: 'invalid', reason: '授業名がありません' };
	const termLabel = attributes.get('開講期');
	const term = termFrom(termLabel, name);
	if (!term)
		return { kind: 'invalid', reason: `開講期を読めませんでした: ${termLabel ?? '(なし)'}` };

	const credits = /^(\d+)\s*単位/.exec(attributes.get('単位数') ?? '')?.[1];
	const teacher = attributes
		.get('担当教員名')
		?.replace(/^[◎○●◯\s]+/u, '')
		.trim();

	// 上の 4 項目は、専用の欄に入れるので、attributes からは除く (開講期は、原文も残す)
	for (const key of ['授業名', '単位数', '担当教員名']) attributes.delete(key);
	return {
		kind: 'ok',
		detail: {
			name,
			teacher: teacher || null,
			credits: credits === undefined ? null : Number(credits),
			term,
			attributes,
			sections,
		},
	};
}
