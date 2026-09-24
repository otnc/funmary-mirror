// 外部の HTML から、見出しの後にある表を列の名前で取り出す。
// 列は位置でなく名前で探すので、列の順番が変わったり、知らない列が増えたりしても動き続ける。
import type { Element, Nodes, Root } from 'hast';
import { select, selectAll } from 'hast-util-select';
import { toText } from 'hast-util-to-text';

export interface ColumnSpec {
	/** 列の見出しの候補。NFKC で正規化し、空白を除いてから比べる */
	readonly labels: readonly string[];
	readonly required?: boolean;
}

export interface TableSpec<Column extends string> {
	/** 表の前にある見出し。id で探し、見つからなければ文字で探す */
	readonly heading: { readonly id: string; readonly texts: readonly string[] };
	readonly columns: Readonly<Record<Column, ColumnSpec>>;
}

export type Row<Column extends string> = Partial<Record<Column, string>>;

export type TableResult<Column extends string> =
	/** 見出しがない。ページの構造が変わった可能性がある */
	| { readonly kind: 'heading-missing' }
	/** 見出しはあるが表がない。行のない表は出力されないので 0 件とみなす */
	| { readonly kind: 'empty' }
	| { readonly kind: 'missing-columns'; readonly columns: readonly Column[] }
	| { readonly kind: 'found'; readonly rows: readonly Row<Column>[] };

/** 1 つのセルの文字の上限。これを超えた分は切る */
const MAX_CELL_LENGTH = 500;

export function extractTable<Column extends string>(
	tree: Root,
	spec: TableSpec<Column>,
): TableResult<Column> {
	const heading = findHeading(tree, spec.heading);
	if (!heading) return { kind: 'heading-missing' };
	const table = findTableAfter(tree, heading);
	if (!table) return { kind: 'empty' };

	const headerLabels = selectAll('th', table).map((th) => normalizeLabel(toText(th)));
	const columnOf = new Map<string, Column>();
	for (const [column, columnSpec] of Object.entries(spec.columns) as [Column, ColumnSpec][]) {
		for (const label of columnSpec.labels) columnOf.set(normalizeLabel(label), column);
	}

	const missing = (Object.entries(spec.columns) as [Column, ColumnSpec][])
		.filter(([, columnSpec]) => columnSpec.required)
		.filter(
			([, columnSpec]) =>
				!columnSpec.labels.some((label) => headerLabels.includes(normalizeLabel(label))),
		)
		.map(([column]) => column);
	if (missing.length > 0) return { kind: 'missing-columns', columns: missing };

	const rows: Row<Column>[] = [];
	for (const tr of selectAll('tr', table)) {
		const cells = selectAll('td', tr);
		if (cells.length === 0) continue;
		const row: Row<Column> = {};
		cells.forEach((td, index) => {
			// セルの列は data-col-responsive-title 属性で決め、なければ同じ位置の見出しで決める
			const title = td.properties['dataColResponsiveTitle'];
			const label = typeof title === 'string' ? normalizeLabel(title) : headerLabels[index];
			const column = label === undefined ? undefined : columnOf.get(label);
			if (column !== undefined) row[column] = cleanText(toText(td));
		});
		rows.push(row);
	}
	return { kind: 'found', rows };
}

function findHeading(tree: Root, heading: TableSpec<string>['heading']): Element | undefined {
	const byId = select(`[id="${heading.id}"]`, tree);
	if (byId) return byId;
	const texts = heading.texts.map(normalizeLabel);
	return selectAll('h1, h2, h3, h4, h5, h6', tree).find((element) =>
		texts.includes(normalizeLabel(toText(element))),
	);
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * 文書の順で heading の後にあり、次の見出しより前にある最初の表を返す。
 * 見出しと表が同じ親の中に並んでいても、別々の入れ物に入っていても見つけられる
 */
function findTableAfter(tree: Root, heading: Element): Element | undefined {
	let passedHeading = false;
	for (const element of elementsInOrder(tree)) {
		if (element === heading) {
			passedHeading = true;
		} else if (passedHeading) {
			if (HEADING_TAGS.has(element.tagName)) return undefined;
			if (element.tagName === 'table') return element;
		}
	}
	return undefined;
}

function* elementsInOrder(node: Nodes): Generator<Element> {
	if (node.type === 'element') yield node;
	if ('children' in node) {
		for (const child of node.children) yield* elementsInOrder(child);
	}
}

export function normalizeLabel(text: string): string {
	return text.normalize('NFKC').replace(/\s+/g, '');
}

/** 制御文字を除き、前後の空白を取り、長さの上限で切る */
function cleanText(text: string): string {
	return text
		.replace(/\p{Cc}/gu, (char) => (char === '\n' || char === '\t' ? char : ''))
		.trim()
		.slice(0, MAX_CELL_LENGTH);
}
