import { describe, expect, it } from 'vitest';
import { extractPdfTextItems, parseTimetablePdf } from './extract.ts';

/** 1 ページに、Helvetica の文字を、指定した位置に置いた、最小の PDF を作る */
function minimalPdf(texts: { text: string; x: number; y: number }[]): Uint8Array {
	const stream = texts.map((t) => `BT /F1 10 Tf ${t.x} ${t.y} Td (${t.text}) Tj ET`).join('\n');
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	];
	let body = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((object, i) => {
		offsets.push(body.length);
		body += `${i + 1} 0 obj\n${object}\nendobj\n`;
	});
	const xref = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return new TextEncoder().encode(body);
}

describe('PDF からの文字の取り出し', () => {
	it('文字と、その位置 (左端の x、下端の y) を取り出す', async () => {
		const result = await extractPdfTextItems(
			minimalPdf([
				{ text: 'Hello', x: 100, y: 200 },
				{ text: 'World', x: 300, y: 150 },
			]),
		);
		if (result.kind !== 'ok') throw new Error(`読めるはず: ${JSON.stringify(result)}`);
		const hello = result.items.find((i) => i.text === 'Hello');
		expect(hello).toMatchObject({ x: 100, y: 200 });
		expect(hello?.width).toBeGreaterThan(0);
		expect(result.items.find((i) => i.text === 'World')).toMatchObject({ x: 300, y: 150 });
	});

	it('空の入力と、PDF ではない入力は、例外にせず invalid にする', async () => {
		expect((await extractPdfTextItems(new Uint8Array())).kind).toBe('invalid');
		expect((await extractPdfTextItems(new TextEncoder().encode('これは PDF ではない'))).kind).toBe(
			'invalid',
		);
	});

	it('大きすぎる入力は、読まずに invalid にする', async () => {
		const result = await extractPdfTextItems(new Uint8Array(11 * 1024 * 1024));
		expect(result).toMatchObject({ kind: 'invalid', reason: 'PDF が大きすぎます' });
	});

	it('時間割の表でない PDF は、構造が違うものとして invalid にする', async () => {
		const result = await parseTimetablePdf(minimalPdf([{ text: 'Hello', x: 100, y: 200 }]));
		expect(result.kind).toBe('invalid');
	});
});
