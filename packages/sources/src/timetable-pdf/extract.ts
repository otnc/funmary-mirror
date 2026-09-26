// PDF から、文字とその座標を取り出す。pdfjs-dist (Mozilla) を使う。文字のデータが入った PDF が対象で、画像の PDF は読めない。
// 取り出した文字の配列は grid.ts に渡す。管理者が手元で 1 回動かす取り込みで使う (定期処理では使わない)。
import {
	parseTimetableItems,
	type PdfTextItem,
	type TimetablePdfOptions,
	type TimetablePdfResult,
} from './grid.ts';

/** PDF の大きさの上限 (実物は 100 KB 前後) */
const MAX_PDF_BYTES = 10 * 1024 * 1024;
/** 1 ページの表として読む。ページが多いものは、別の種類の PDF とみなす */
const MAX_PAGES = 3;

export type ExtractResult =
	| { readonly kind: 'ok'; readonly items: readonly PdfTextItem[] }
	| { readonly kind: 'invalid'; readonly reason: string };

export async function extractPdfTextItems(data: Uint8Array): Promise<ExtractResult> {
	if (data.byteLength === 0) return { kind: 'invalid', reason: 'PDF が空です' };
	if (data.byteLength > MAX_PDF_BYTES) return { kind: 'invalid', reason: 'PDF が大きすぎます' };
	try {
		// 読み込みが重いので、使うときまで読まない
		const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
		// pdfjs は渡したバッファを使い回すので、コピーを渡す
		const task = pdfjs.getDocument({
			data: new Uint8Array(data),
			useSystemFonts: true,
			// フォントは、画面に出すためのものなので、組み込まない (文字の取り出しだけに使う)
			disableFontFace: true,
			verbosity: 0,
		});
		try {
			const doc = await task.promise;
			if (doc.numPages < 1 || doc.numPages > MAX_PAGES) {
				return { kind: 'invalid', reason: `ページ数が想定と違います (${doc.numPages} ページ)` };
			}
			const page = await doc.getPage(1);
			const content = await page.getTextContent();
			const items: PdfTextItem[] = [];
			for (const raw of content.items) {
				if (!('str' in raw) || raw.str.trim() === '') continue;
				const transform = raw.transform as number[];
				items.push({
					text: raw.str,
					x: transform[4] ?? 0,
					y: transform[5] ?? 0,
					height: raw.height,
					width: raw.width,
				});
			}
			return { kind: 'ok', items };
		} finally {
			await task.destroy();
		}
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { kind: 'invalid', reason: `PDF を読めませんでした: ${reason}` };
	}
}

/** PDF のファイルの内容から、授業時間割を読む */
export async function parseTimetablePdf(
	data: Uint8Array,
	options?: Partial<TimetablePdfOptions>,
): Promise<TimetablePdfResult> {
	const extracted = await extractPdfTextItems(data);
	if (extracted.kind === 'invalid') return extracted;
	return parseTimetableItems(extracted.items, options);
}
