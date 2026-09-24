// 学生ポータルの休講・補講の画面 (Pt/CSLecture) を解析する。
// 取得した HTML は信用しない。表は列の名前で取り出し、1 行ずつ形を確かめる。
import type { CalendarDate } from '@funmary/core';
import type { Root } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { select } from 'hast-util-select';
import * as v from 'valibot';
import { extractTable, type TableResult } from '../html/table.ts';
import { cancellationTable, makeupTable, roomChangeTable } from './spec.ts';

/** 休講コメントの冒頭にある、補講の予定 */
export type MakeupPlan = 'planned' | 'none' | 'undecided';

export interface PortalCancellation {
	readonly date: CalendarDate;
	readonly period: number;
	readonly lessonName: string;
	readonly teacher: string | null;
	readonly campus: string | null;
	readonly comment: string | null;
	readonly makeupPlan: MakeupPlan | null;
}

export interface PortalMakeup {
	readonly date: CalendarDate;
	readonly period: number;
	readonly lessonName: string;
	readonly teacher: string | null;
	readonly campus: string | null;
	readonly room: string | null;
	readonly comment: string | null;
}

export interface PortalRoomChange {
	readonly date: CalendarDate;
	readonly period: number;
	readonly lessonName: string;
	readonly teacher: string | null;
	readonly campus: string | null;
	readonly fromRoom: string | null;
	readonly toRoom: string;
}

export type ParseResult =
	| {
			readonly kind: 'ok';
			readonly cancellations: readonly PortalCancellation[];
			readonly makeups: readonly PortalMakeup[];
			readonly roomChanges: readonly PortalRoomChange[];
			/** 形が合わずに捨てた行の数 */
			readonly rejectedRows: number;
	  }
	/** ログインの画面に戻された。セッションが切れている */
	| { readonly kind: 'login-required' }
	/** ページの構造が変わった可能性がある。結果を信用せず、DB を更新しない */
	| { readonly kind: 'structure-changed'; readonly reason: string };

export interface ParseOptions {
	/** 日付 (MM/DD) の年を補うための年度。4 月から 3 月まで */
	readonly academicYear: number;
}

/** 捨てた行がこの割合を超えたら、結果全体を信用しない */
const MAX_REJECTED_RATIO = 0.2;

export function parseClassChangePage(html: string, options: ParseOptions): ParseResult {
	const tree = fromHtml(html);
	if (isLoginPage(tree)) return { kind: 'login-required' };

	const tables = {
		cancellations: extractTable(tree, cancellationTable),
		makeups: extractTable(tree, makeupTable),
		roomChanges: extractTable(tree, roomChangeTable),
	};
	for (const [name, table] of Object.entries(tables)) {
		if (table.kind === 'heading-missing') return structureChanged(`${name} の見出しがない`);
		if (table.kind === 'missing-columns') {
			return structureChanged(`${name} の表に必須の列がない: ${table.columns.join(', ')}`);
		}
	}

	const rowSchema = createRowSchemas(options.academicYear);
	let total = 0;
	let rejected = 0;
	function parseRows<Output>(
		table: TableResult<string>,
		schema: v.GenericSchema<unknown, Output>,
	): Output[] {
		if (table.kind !== 'found') return [];
		const outputs: Output[] = [];
		for (const row of table.rows) {
			total += 1;
			const result = v.safeParse(schema, row);
			if (result.success) outputs.push(result.output);
			else rejected += 1;
		}
		return outputs;
	}

	const cancellations = parseRows(tables.cancellations, rowSchema.cancellation);
	const makeups = parseRows(tables.makeups, rowSchema.makeup);
	const roomChanges = parseRows(tables.roomChanges, rowSchema.roomChange);
	if (total > 0 && rejected / total > MAX_REJECTED_RATIO) {
		return structureChanged(`${total} 行のうち ${rejected} 行の形が合わない`);
	}
	return { kind: 'ok', cancellations, makeups, roomChanges, rejectedRows: rejected };
}

function isLoginPage(tree: Root): boolean {
	return select('input[name$="LoginPassword"]', tree) !== undefined;
}

function structureChanged(reason: string): ParseResult {
	return { kind: 'structure-changed', reason };
}

const MAX_NAME_LENGTH = 200;

function createRowSchemas(academicYear: number) {
	const date = v.pipe(
		v.string(),
		v.rawTransform(({ dataset, addIssue, NEVER }) => {
			const completed = completeDate(dataset.value, academicYear);
			if (completed === undefined) {
				addIssue({ message: '日付の形が合わない' });
				return NEVER;
			}
			return completed;
		}),
	);
	const period = v.pipe(
		v.string(),
		v.transform((text) => Number(/^(\d+)時限$/.exec(text.normalize('NFKC'))?.[1])),
		v.integer(),
		v.minValue(1),
		v.maxValue(6),
	);
	const name = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_NAME_LENGTH));
	// 必須でない列は、列がないときも空のときも null にする
	const optional = v.pipe(
		v.optional(v.string(), ''),
		v.transform((text): string | null => (text === '' ? null : text)),
	);
	const common = { date, period, lessonName: name, teacher: optional, campus: optional };

	const schemas: {
		cancellation: v.GenericSchema<unknown, PortalCancellation>;
		makeup: v.GenericSchema<unknown, PortalMakeup>;
		roomChange: v.GenericSchema<unknown, PortalRoomChange>;
	} = {
		cancellation: v.pipe(
			v.object({ ...common, comment: optional }),
			v.transform((row): PortalCancellation => ({ ...row, makeupPlan: makeupPlanOf(row.comment) })),
		),
		makeup: v.object({ ...common, room: optional, comment: optional }),
		roomChange: v.object({ ...common, fromRoom: optional, toRoom: name }),
	};
	return schemas;
}

/** "MM/DD" に年度から年を補う。4 月から 12 月は年度の年、1 月から 3 月は翌年 */
function completeDate(text: string, academicYear: number): CalendarDate | undefined {
	const match = /^(\d{1,2})\/(\d{1,2})$/.exec(text.normalize('NFKC'));
	if (!match) return undefined;
	const month = Number(match[1]);
	const day = Number(match[2]);
	const year = month >= 4 ? academicYear : academicYear + 1;
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
	return date.toISOString().slice(0, 10);
}

function makeupPlanOf(comment: string | null): MakeupPlan | null {
	const normalized = comment?.normalize('NFKC').replace(/\s+/g, '') ?? '';
	if (normalized.startsWith('補講あり')) return 'planned';
	if (normalized.startsWith('補講なし')) return 'none';
	if (normalized.startsWith('補講未定')) return 'undecided';
	return null;
}
