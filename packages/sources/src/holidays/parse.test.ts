import { describe, expect, it } from 'vitest';
import { decodeHolidayCsv, parseHolidayCsv } from './parse.ts';

const HEADER = '国民の祝日・休日月日,国民の祝日・休日名称';

describe('parseHolidayCsv', () => {
	it('日付を YYYY-MM-DD にそろえ、名称と一緒に返す', () => {
		const result = parseHolidayCsv(
			`${HEADER}\n2026/1/1,元日\n2026/1/12,成人の日\n2026/12/23,天皇誕生日\n`,
		);
		expect(result).toEqual({
			kind: 'ok',
			holidays: [
				{ date: '2026-01-01', name: '元日' },
				{ date: '2026-01-12', name: '成人の日' },
				{ date: '2026-12-23', name: '天皇誕生日' },
			],
			skipped: 0,
		});
	});

	it('CRLF の改行、末尾の空行、前後の空白があっても読める', () => {
		const result = parseHolidayCsv(`${HEADER}\r\n 2027/2/11 , 建国記念の日 \r\n\r\n`);
		expect(result).toMatchObject({
			kind: 'ok',
			holidays: [{ date: '2027-02-11', name: '建国記念の日' }],
		});
	});

	it('日付として読めない行や、存在しない日付の行は捨てて、その数を返す', () => {
		const result = parseHolidayCsv(
			`${HEADER}\n2026/1/1,元日\nあいう,不明\n2026/2/30,存在しない日\n2026/5/3,\n`,
		);
		expect(result).toMatchObject({
			kind: 'ok',
			holidays: [{ date: '2026-01-01', name: '元日' }],
			skipped: 3,
		});
	});

	it('祝日が 1 件も読めなければ、失敗として扱う (HTML のエラー画面などを取り込まない)', () => {
		expect(parseHolidayCsv('<html><body>503 Service Unavailable</body></html>')).toMatchObject({
			kind: 'invalid',
		});
		expect(parseHolidayCsv('')).toMatchObject({ kind: 'invalid' });
		expect(parseHolidayCsv(`${HEADER}\n`)).toMatchObject({ kind: 'invalid' });
	});

	it('同じ日付が重なったら、あとの行を使う', () => {
		const result = parseHolidayCsv(`${HEADER}\n2026/1/1,元日\n2026/1/1,元日 (訂正)\n`);
		expect(result).toMatchObject({
			kind: 'ok',
			holidays: [{ date: '2026-01-01', name: '元日 (訂正)' }],
		});
	});

	it('年を固定せず、どの年でも同じ規則で読める', () => {
		for (const year of [1955, 2026, 2027, 2099]) {
			const result = parseHolidayCsv(`${HEADER}\n${year}/11/3,文化の日\n`);
			expect(result).toMatchObject({ kind: 'ok', holidays: [{ date: `${year}-11-03` }] });
		}
	});
});

describe('decodeHolidayCsv', () => {
	it('Shift_JIS のバイト列を文字列にする', () => {
		// "元日" を Shift_JIS にしたバイト列
		const bytes = new Uint8Array([0x8c, 0xb3, 0x93, 0xfa]);
		expect(decodeHolidayCsv(bytes)).toBe('元日');
	});
});
