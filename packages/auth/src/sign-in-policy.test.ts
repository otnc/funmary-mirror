import { describe, expect, it } from 'vitest';
import { decideSignIn, type SignInInput } from './sign-in-policy.ts';

const NOW = new Date('2026-10-01T00:00:00Z');

function input(over: Partial<SignInInput> = {}): SignInInput {
	return {
		claims: { sub: 'g-1', email: 'taro@fun.ac.jp', emailVerified: true, hd: 'fun.ac.jp' },
		allowedDomains: ['fun.ac.jp'],
		registration: 'invite',
		adminEmails: [],
		existingUser: null,
		invite: null,
		now: NOW,
		...over,
	};
}

/** hd に null を渡すと、hd のない (大学のアカウントではない) 値になる */
const claims = (email: string, hd: string | null = 'fun.ac.jp', emailVerified = true) => ({
	sub: 'g',
	email,
	emailVerified,
	...(hd !== null && { hd }),
});

const goodInvite = { id: 7, maxUses: 5, usedCount: 1, expiresAt: null, revoked: false };

describe('メールアドレスの確認 (サーバー側)', () => {
	it('email_verified が true でなければ、断る', () => {
		expect(decideSignIn(input({ claims: claims('a@fun.ac.jp', 'fun.ac.jp', false) }))).toEqual({
			kind: 'denied',
			reason: 'email-not-verified',
		});
	});

	it('メールのドメインが許可されていなければ、断る (hd が合っていても)', () => {
		expect(decideSignIn(input({ claims: claims('a@gmail.com') }))).toEqual({
			kind: 'denied',
			reason: 'domain-not-allowed',
		});
	});

	it('hd がない (大学のアカウントではない) か、許可されていなければ、断る', () => {
		expect(decideSignIn(input({ claims: claims('a@fun.ac.jp', null) }))).toEqual({
			kind: 'denied',
			reason: 'hd-mismatch',
		});
		expect(decideSignIn(input({ claims: claims('a@fun.ac.jp', 'other.jp') }))).toEqual({
			kind: 'denied',
			reason: 'hd-mismatch',
		});
	});

	it('ドメインの大文字小文字は区別しない。似た名前のドメイン (末尾一致など) は許さない', () => {
		expect(
			decideSignIn(input({ claims: claims('Taro@FUN.AC.JP'), registration: 'open' })).kind,
		).toBe('sign-up');
		for (const email of ['a@evilfun.ac.jp', 'a@fun.ac.jp.evil.com', 'a@x.fun.ac.jp']) {
			expect(decideSignIn(input({ claims: claims(email) }))).toEqual({
				kind: 'denied',
				reason: 'domain-not-allowed',
			});
		}
	});

	it('許可するドメインを増やせる (ALLOWED_EMAIL_DOMAINS)', () => {
		const result = decideSignIn(
			input({
				allowedDomains: ['fun.ac.jp', 'm.fun.ac.jp'],
				claims: claims('a@m.fun.ac.jp', 'm.fun.ac.jp'),
				registration: 'open',
			}),
		);
		expect(result.kind).toBe('sign-up');
	});

	it('メールアドレスの形でない値は断る', () => {
		expect(decideSignIn(input({ claims: claims('no-at-sign') }))).toEqual({
			kind: 'denied',
			reason: 'domain-not-allowed',
		});
	});
});

describe('登録済みの利用者', () => {
	it('登録済みの利用者は、登録の方式や招待コードに関係なくログインできる', () => {
		for (const registration of ['invite', 'open', 'closed'] as const) {
			expect(
				decideSignIn(
					input({ registration, existingUser: { id: 'u1', status: 'active', role: 'user' } }),
				),
			).toEqual({ kind: 'sign-in', userId: 'u1', promoteToAdmin: false });
		}
	});

	it('停止された利用者は、ログインできない', () => {
		expect(
			decideSignIn(input({ existingUser: { id: 'u1', status: 'suspended', role: 'user' } })),
		).toEqual({ kind: 'denied', reason: 'suspended' });
	});

	it('ADMIN_EMAILS に書かれた利用者は、ログインしたときに管理者にする', () => {
		const result = decideSignIn(
			input({
				adminEmails: ['TARO@fun.ac.jp'],
				existingUser: { id: 'u1', status: 'active', role: 'user' },
			}),
		);
		expect(result).toEqual({ kind: 'sign-in', userId: 'u1', promoteToAdmin: true });
	});

	it('すでに管理者なら、昇格の指示は出さない', () => {
		const result = decideSignIn(
			input({
				adminEmails: ['taro@fun.ac.jp'],
				existingUser: { id: 'u1', status: 'active', role: 'admin' },
			}),
		);
		expect(result).toMatchObject({ kind: 'sign-in', promoteToAdmin: false });
	});
});

describe('新規登録', () => {
	it('closed のときは、誰も登録できない', () => {
		expect(decideSignIn(input({ registration: 'closed', invite: goodInvite }))).toEqual({
			kind: 'denied',
			reason: 'registration-closed',
		});
	});

	it('open のときは、許可ドメインの人なら、招待コードなしで登録できる', () => {
		expect(decideSignIn(input({ registration: 'open' }))).toEqual({
			kind: 'sign-up',
			role: 'user',
			inviteCodeId: null,
		});
	});

	it('open でも、有効な招待コードがあれば、その招待で登録したと記録する。無効なコードは無視する', () => {
		expect(decideSignIn(input({ registration: 'open', invite: goodInvite }))).toMatchObject({
			inviteCodeId: 7,
		});
		expect(
			decideSignIn(input({ registration: 'open', invite: { ...goodInvite, revoked: true } })),
		).toMatchObject({ kind: 'sign-up', inviteCodeId: null });
	});

	it('invite のときは、有効な招待コードがあれば登録できる', () => {
		expect(decideSignIn(input({ invite: goodInvite }))).toEqual({
			kind: 'sign-up',
			role: 'user',
			inviteCodeId: 7,
		});
	});

	it('invite のとき、招待コードがなければ断る', () => {
		expect(decideSignIn(input())).toEqual({ kind: 'denied', reason: 'invite-required' });
	});

	it('招待コードが取り消し済み、期限切れ、使い切りのときは、それぞれの理由で断る', () => {
		expect(decideSignIn(input({ invite: { ...goodInvite, revoked: true } }))).toEqual({
			kind: 'denied',
			reason: 'invite-revoked',
		});
		expect(
			decideSignIn(
				input({ invite: { ...goodInvite, expiresAt: new Date('2026-09-30T23:59:59Z') } }),
			),
		).toEqual({ kind: 'denied', reason: 'invite-expired' });
		expect(decideSignIn(input({ invite: { ...goodInvite, usedCount: 5 } }))).toEqual({
			kind: 'denied',
			reason: 'invite-used-up',
		});
	});

	it('有効期限の時刻ちょうどは、期限切れとして扱う。期限の前なら有効', () => {
		expect(decideSignIn(input({ invite: { ...goodInvite, expiresAt: NOW } }))).toEqual({
			kind: 'denied',
			reason: 'invite-expired',
		});
		expect(
			decideSignIn(
				input({ invite: { ...goodInvite, expiresAt: new Date('2026-10-01T00:00:01Z') } }),
			).kind,
		).toBe('sign-up');
	});
});

describe('管理者', () => {
	it('ADMIN_EMAILS に書かれた人は、最初のログインで管理者として登録できる (招待コードも、closed も関係ない)', () => {
		for (const registration of ['invite', 'closed'] as const) {
			expect(decideSignIn(input({ registration, adminEmails: ['taro@fun.ac.jp'] }))).toEqual({
				kind: 'sign-up',
				role: 'admin',
				inviteCodeId: null,
			});
		}
	});

	it('管理者の登録でも、メールの確認とドメインの確認は省かない', () => {
		expect(
			decideSignIn(input({ adminEmails: ['a@gmail.com'], claims: claims('a@gmail.com') })),
		).toEqual({ kind: 'denied', reason: 'domain-not-allowed' });
	});
});
