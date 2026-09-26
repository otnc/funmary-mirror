import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLoginBody, parseLoginForm } from './login-form.ts';

const fixture = readFileSync(new URL('./fixtures/login.html', import.meta.url), 'utf8');

describe('ログイン画面のフォームの読み取り', () => {
	it('hidden の値と、既定で選ばれている年度と学期を読む', () => {
		const result = parseLoginForm(fixture);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		expect(result.form.hidden.get('__VIEWSTATE')).toBe('dummy-viewstate+/=');
		expect(result.form.hidden.get('__EVENTVALIDATION')).toBe('dummy-validation+/=');
		expect(result.form.hidden.get('__EVENTTARGET')).toBe('');
		expect(result.form.year).toBe('2026');
		expect(result.form.term).toBe('21');
	});

	it('送る本文に、hidden、年度、学期、ID、パスワード、ボタンを入れる', () => {
		const result = parseLoginForm(fixture);
		if (result.kind !== 'ok') throw new Error('読めるはず');
		const body = new URLSearchParams(
			buildLoginBody(result.form, { userId: 'u1', password: 'p w' }),
		);
		expect(body.get('__VIEWSTATE')).toBe('dummy-viewstate+/=');
		expect(body.get('ctl00$MainContent$TargetYearList')).toBe('2026');
		expect(body.get('ctl00$MainContent$TargetTermList')).toBe('21');
		expect(body.get('ctl00$MainContent$LoginId')).toBe('u1');
		expect(body.get('ctl00$MainContent$LoginPassword')).toBe('p w');
		expect(body.get('ctl00$MainContent$LoginButton')).toBe('ログイン');
	});

	it('選択肢に既定がなければ、先頭の値を使わず、読めなかったものとして知らせる', () => {
		const html = fixture.replace(' selected="selected"', '');
		const result = parseLoginForm(html);
		expect(result.kind).toBe('invalid');
	});

	it('ID の入力欄がなければ、構造が変わったものとして知らせる', () => {
		expect(parseLoginForm('<html><body><p>メンテナンス中</p></body></html>').kind).toBe('invalid');
	});

	it('崩れた HTML でも例外にせず、結果を返す', () => {
		expect(parseLoginForm('<form><input name=').kind).toBe('invalid');
		expect(parseLoginForm('').kind).toBe('invalid');
	});
});
