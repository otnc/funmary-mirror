// 学生ポータルの休講・補講の画面の取り出し方。列の名前や見出しが変わったら、ここだけを直す。
import type { TableSpec } from '../html/table.ts';

export const cancellationTable = {
	heading: { id: 'cancel-lecture-information', texts: ['休講情報'] },
	columns: {
		date: { labels: ['日付'], required: true },
		period: { labels: ['時限'], required: true },
		lessonName: { labels: ['授業名', '科目名'], required: true },
		campus: { labels: ['キャンパス'] },
		teacher: { labels: ['代表教職員', '担当教員', '教員'] },
		comment: { labels: ['休講コメント'] },
	},
} as const satisfies TableSpec<string>;

// 補講と教室変更の表は、2026-09-25 の時点で行がなく、実物の列を確かめられていない。
// 列の名前は推定なので、必須の列は日付、時限、授業名だけにしておく
export const makeupTable = {
	heading: { id: 'sup-lecture-information', texts: ['補講情報'] },
	columns: {
		date: { labels: ['日付'], required: true },
		period: { labels: ['時限'], required: true },
		lessonName: { labels: ['授業名', '科目名'], required: true },
		campus: { labels: ['キャンパス'] },
		teacher: { labels: ['代表教職員', '担当教員', '教員'] },
		room: { labels: ['教室名', '教室'] },
		comment: { labels: ['補講コメント'] },
	},
} as const satisfies TableSpec<string>;

export const roomChangeTable = {
	heading: { id: 'classroom-exchanged-lecture-information', texts: ['教室変更情報'] },
	columns: {
		date: { labels: ['日付'], required: true },
		period: { labels: ['時限'], required: true },
		lessonName: { labels: ['授業名', '科目名'], required: true },
		campus: { labels: ['キャンパス'] },
		teacher: { labels: ['代表教職員', '担当教員', '教員'] },
		fromRoom: { labels: ['移動元', '変更前'] },
		toRoom: { labels: ['移動先', '変更後'] },
	},
} as const satisfies TableSpec<string>;
