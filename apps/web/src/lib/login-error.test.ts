import { describe, expect, it } from 'vitest';
import { loginErrorMessage } from './login-error.ts';

describe('loginErrorMessage', () => {
	it('理由ごとに、次にすることが分かる文を返す', () => {
		expect(loginErrorMessage('invite-required')).toContain('招待コード');
		expect(loginErrorMessage('domain-not-allowed')).toContain('大学');
		expect(loginErrorMessage('suspended')).toContain('停止');
		expect(loginErrorMessage('flow-expired')).toContain('やり直');
	});

	it('知らない値や、値がないときは、何も表示しない', () => {
		expect(loginErrorMessage('<script>')).toBeNull();
		expect(loginErrorMessage(null)).toBeNull();
		expect(loginErrorMessage('')).toBeNull();
	});

	it('Object のプロパティの名前を渡されても、何も表示しない', () => {
		expect(loginErrorMessage('constructor')).toBeNull();
		expect(loginErrorMessage('__proto__')).toBeNull();
	});
});
