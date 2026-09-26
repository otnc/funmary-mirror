import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PortalFetch } from '../portal/http.ts';
import { fetchSyllabusCatalog } from './client.ts';

const listHtml = readFileSync(new URL('./fixtures/list.html', import.meta.url), 'utf8');
const detailHtml = readFileSync(new URL('./fixtures/detail.html', import.meta.url), 'utf8');

const html = (body: string) =>
	new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

/** 検索結果のページ。total 件のうち、ids の行を載せる */
function resultPage(total: number, ids: string[]): string {
	const rows = ids
		.map(
			(id) =>
				`<tr><td><a href="Syllabus.aspx?lesson_id=${id}&amp;year=2026">詳細</a></td>` +
				`<td data-col-responsive-title="履修年度">2026</td><td data-col-responsive-title="授業コード">${id}</td>` +
				`<td data-col-responsive-title="授業科目名">科目 ${id}</td><td data-col-responsive-title="Course">C${id}</td>` +
				`<td data-col-responsive-title="担当教員名">教員</td><td data-col-responsive-title="授業形態">講義</td></tr>`,
		)
		.join('');
	return (
		`<html><body><form><input type="hidden" name="__VIEWSTATE" value="vs-${ids.join('')}">` +
		`<h3>検索結果(${total})</h3><table id="MainContent_GridView"><tbody>${rows}</tbody></table>` +
		`<a href="javascript:__doPostBack('ctl00$MainContent$GridView','Page$2')">2</a></form></body></html>`
	);
}

interface Call {
	method: string;
	url: string;
	body: URLSearchParams | null;
}

function fakeSyllabus(pages: Record<number, string>, options: { detailFails?: string[] } = {}) {
	const calls: Call[] = [];
	const fetch: PortalFetch = (url, init) => {
		const call: Call = {
			method: init?.method ?? 'GET',
			url,
			body: typeof init?.body === 'string' ? new URLSearchParams(init.body) : null,
		};
		calls.push(call);
		const u = new URL(url);
		if (u.pathname === '/Lesson/SyllabusList' && call.method === 'GET')
			return Promise.resolve(html(listHtml));
		if (u.pathname === '/Lesson/SyllabusList' && call.method === 'POST') {
			const target = call.body?.get('__EVENTARGUMENT');
			const page = target ? Number(target.replace('Page$', '')) : 1;
			return Promise.resolve(html(pages[page] ?? resultPage(0, [])));
		}
		if (u.pathname === '/Lesson/Syllabus') {
			if (options.detailFails?.includes(u.searchParams.get('lesson_id') ?? '')) {
				return Promise.resolve(html('<html><body>エラー</body></html>'));
			}
			return Promise.resolve(html(detailHtml));
		}
		return Promise.resolve(new Response('not found', { status: 404 }));
	};
	return { fetch, calls };
}

const noSleep = () => Promise.resolve();

describe('公開シラバスの取得', () => {
	it('検索し、ページ送りですべての科目を集め、詳細を取る', async () => {
		const portal = fakeSyllabus({ 1: resultPage(3, ['1', '2']), 2: resultPage(3, ['3']) });
		const result = await fetchSyllabusCatalog({
			fetch: portal.fetch,
			academicYear: 2026,
			needsDetail: () => true,
			sleep: noSleep,
		});
		if (result.kind !== 'ok') throw new Error(`成功するはず: ${JSON.stringify(result)}`);
		expect(result.entries.map((e) => e.row.lessonId)).toEqual(['1', '2', '3']);
		expect(result.entries.every((e) => e.detail?.name === '架空の科目入門1～4')).toBe(true);
		expect(result.failedDetails).toBe(0);
		expect(result.year).toBe(2026);
	});

	it('検索では年度と検索ボタンを、ページ送りでは、前のページの hidden の値と Page$N を送る', async () => {
		const portal = fakeSyllabus({ 1: resultPage(3, ['1', '2']), 2: resultPage(3, ['3']) });
		await fetchSyllabusCatalog({
			fetch: portal.fetch,
			academicYear: 2026,
			needsDetail: () => false,
			sleep: noSleep,
		});
		const posts = portal.calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(2);
		expect(posts[0]!.body!.get('ctl00$MainContent$param_Syllabus_year_eq')).toBe('2026');
		expect(posts[0]!.body!.get('ctl00$MainContent$SearchButton')).toBe('検索の実行');
		expect(posts[1]!.body!.get('__EVENTTARGET')).toBe('ctl00$MainContent$GridView');
		expect(posts[1]!.body!.get('__EVENTARGUMENT')).toBe('Page$2');
		expect(posts[1]!.body!.get('__VIEWSTATE')).toBe('vs-12');
		expect(posts[1]!.body!.get('ctl00$MainContent$param_Syllabus_year_eq')).toBe('2026');
	});

	it('詳細が不要な科目は、取りに行かない', async () => {
		const portal = fakeSyllabus({ 1: resultPage(2, ['1', '2']) });
		const result = await fetchSyllabusCatalog({
			fetch: portal.fetch,
			academicYear: 2026,
			needsDetail: (row) => row.lessonId === '2',
			sleep: noSleep,
		});
		if (result.kind !== 'ok') throw new Error('成功するはず');
		expect(result.entries.map((e) => e.detail !== null)).toEqual([false, true]);
		expect(portal.calls.filter((c) => c.url.includes('/Lesson/Syllabus?'))).toHaveLength(1);
	});

	it('詳細が読めない科目があっても、ほかの科目は続け、失敗の数を返す', async () => {
		const portal = fakeSyllabus({ 1: resultPage(2, ['1', '2']) }, { detailFails: ['1'] });
		const result = await fetchSyllabusCatalog({
			fetch: portal.fetch,
			academicYear: 2026,
			needsDetail: () => true,
			sleep: noSleep,
		});
		if (result.kind !== 'ok') throw new Error('成功するはず');
		expect(result.failedDetails).toBe(1);
		expect(result.entries[0]!.detail).toBeNull();
		expect(result.entries[1]!.detail).not.toBeNull();
	});

	it('リクエストの間に、待ちを入れる', async () => {
		const portal = fakeSyllabus({ 1: resultPage(2, ['1', '2']) });
		const waits: number[] = [];
		await fetchSyllabusCatalog({
			fetch: portal.fetch,
			academicYear: 2026,
			needsDetail: () => true,
			requestIntervalMs: 1500,
			sleep: (ms) => {
				waits.push(ms);
				return Promise.resolve();
			},
		});
		expect(waits.length).toBeGreaterThanOrEqual(2);
		expect(waits.every((ms) => ms >= 1500)).toBe(true);
	});

	it('年度が画面の選択肢になければ、その年度はまだないものとして返す', async () => {
		const portal = fakeSyllabus({});
		const result = await fetchSyllabusCatalog({
			fetch: portal.fetch,
			academicYear: 2031,
			needsDetail: () => true,
			sleep: noSleep,
		});
		expect(result).toMatchObject({ kind: 'year-unavailable', availableYears: [2026, 2025] });
		expect(portal.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
	});

	it('集めた件数が、検索結果の件数より大きく足りなければ、失敗にする', async () => {
		const portal = fakeSyllabus({ 1: resultPage(100, ['1', '2']), 2: resultPage(100, []) });
		const result = await fetchSyllabusCatalog({
			fetch: portal.fetch,
			academicYear: 2026,
			needsDetail: () => false,
			sleep: noSleep,
		});
		expect(result.kind).toBe('failed');
	});

	it('検索結果が 0 件なら、0 件の成功として返す', async () => {
		const portal = fakeSyllabus({ 1: resultPage(0, []) });
		const result = await fetchSyllabusCatalog({
			fetch: portal.fetch,
			academicYear: 2026,
			needsDetail: () => true,
			sleep: noSleep,
		});
		expect(result).toMatchObject({ kind: 'ok', entries: [] });
	});

	it('検索画面の構造が変わっていたら、知らせる', async () => {
		const result = await fetchSyllabusCatalog({
			fetch: () => Promise.resolve(html('<html><body>変わった</body></html>')),
			academicYear: 2026,
			needsDetail: () => true,
			sleep: noSleep,
		});
		expect(result.kind).toBe('structure-changed');
	});

	it('通信が例外になっても、投げずに失敗として返す', async () => {
		const result = await fetchSyllabusCatalog({
			fetch: () => Promise.reject(new Error('ECONNRESET')),
			academicYear: 2026,
			needsDetail: () => true,
			sleep: noSleep,
		});
		expect(result.kind).toBe('failed');
	});

	it('中断の合図 (signal) が出たら、途中でやめて、失敗として返す', async () => {
		const controller = new AbortController();
		const portal = fakeSyllabus({ 1: resultPage(2, ['1', '2']) });
		const result = await fetchSyllabusCatalog({
			fetch: portal.fetch,
			academicYear: 2026,
			needsDetail: () => true,
			signal: controller.signal,
			sleep: () => {
				controller.abort();
				return Promise.resolve();
			},
		});
		expect(result.kind).toBe('failed');
	});
});
