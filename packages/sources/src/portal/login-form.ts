// 学生ポータルのログイン画面 (ASP.NET Web Forms) のフォームを読む (設計書 9.1)。
// 送るものは、hidden の値 (__VIEWSTATE など)、年度と学期の既定値、ID、パスワード、ボタン。
// 入力欄の名前は "ctl00$MainContent$LoginId" のように接頭辞が付くので、末尾で探す。
import { fromHtml } from 'hast-util-from-html';
import { selectAll } from 'hast-util-select';

export interface LoginForm {
	/** hidden の値。外部の文字列をキーにするので Map にする */
	readonly hidden: ReadonlyMap<string, string>;
	readonly fields: {
		readonly year: string;
		readonly term: string;
		readonly userId: string;
		readonly password: string;
		readonly submit: string;
	};
	readonly submitValue: string;
	/** 画面で既定になっている年度 */
	readonly year: string;
	/** 画面で既定になっている学期 (例: 3Q は 21) */
	readonly term: string;
}

export type LoginFormResult =
	| { readonly kind: 'ok'; readonly form: LoginForm }
	| { readonly kind: 'invalid'; readonly reason: string };

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** name が suffix で終わる要素の name を返す */
function findName(
	elements: readonly { properties: Record<string, unknown> }[],
	suffix: string,
): string | undefined {
	for (const element of elements) {
		const name = str(element.properties['name']);
		if (name !== undefined && (name === suffix || name.endsWith(`$${suffix}`))) return name;
	}
	return undefined;
}

export function parseLoginForm(html: string): LoginFormResult {
	let tree;
	try {
		tree = fromHtml(html);
	} catch {
		return { kind: 'invalid', reason: 'HTML を読めませんでした' };
	}
	const inputs = selectAll('input', tree);

	const hidden = new Map<string, string>();
	for (const input of inputs) {
		if (str(input.properties['type']) !== 'hidden') continue;
		const name = str(input.properties['name']);
		if (name) hidden.set(name, str(input.properties['value']) ?? '');
	}
	if (!hidden.has('__VIEWSTATE')) return { kind: 'invalid', reason: '__VIEWSTATE がありません' };

	const userId = findName(inputs, 'LoginId');
	const password = findName(inputs, 'LoginPassword');
	const submitInput = inputs.find(
		(input) =>
			str(input.properties['type']) === 'submit' &&
			str(input.properties['name'])?.endsWith('LoginButton'),
	);
	if (!userId || !password || !submitInput) {
		return { kind: 'invalid', reason: 'ID、パスワード、ログインのボタンの入力欄がありません' };
	}

	const selects = selectAll('select', tree);
	const defaultOf = (suffix: string) => {
		const select = selects.find((s) => {
			const name = str(s.properties['name']);
			return name !== undefined && name.endsWith(suffix);
		});
		if (!select) return undefined;
		const selected = selectAll('option', select).find(
			(o) => o.properties['selected'] !== undefined,
		);
		if (!selected) return undefined;
		return { name: str(select.properties['name'])!, value: str(selected.properties['value']) };
	};
	const year = defaultOf('TargetYearList');
	const term = defaultOf('TargetTermList');
	if (!year?.value || !term?.value) {
		return { kind: 'invalid', reason: '年度と学期の既定値を読めませんでした' };
	}

	return {
		kind: 'ok',
		form: {
			hidden,
			fields: {
				year: year.name,
				term: term.name,
				userId,
				password,
				submit: str(submitInput.properties['name'])!,
			},
			submitValue: str(submitInput.properties['value']) ?? '',
			year: year.value,
			term: term.value,
		},
	};
}

/** ログインで POST する本文 (application/x-www-form-urlencoded) */
export function buildLoginBody(
	form: LoginForm,
	credentials: { readonly userId: string; readonly password: string },
): string {
	const body = new URLSearchParams();
	for (const [name, value] of form.hidden) body.set(name, value);
	body.set(form.fields.year, form.year);
	body.set(form.fields.term, form.term);
	body.set(form.fields.userId, credentials.userId);
	body.set(form.fields.password, credentials.password);
	body.set(form.fields.submit, form.submitValue);
	return body.toString();
}
