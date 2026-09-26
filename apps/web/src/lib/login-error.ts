// ログインに失敗したときに、/login?error=<理由> で渡される理由を、画面に出す文にする。
// URL は誰でも書き換えられるので、知っている理由だけを扱い、値をそのまま表示しない。
const MESSAGES = new Map<string, string>([
	['email-not-verified', 'Google アカウントのメールアドレスが確認されていません。'],
	['domain-not-allowed', '大学の Google アカウント (@fun.ac.jp) でログインしてください。'],
	['hd-mismatch', '大学の Google アカウント (@fun.ac.jp) でログインしてください。'],
	['suspended', 'このアカウントは停止されています。'],
	['registration-closed', '現在、新規の登録を受け付けていません。'],
	[
		'invite-required',
		'新規の登録には招待コードが必要です。招待コードの入った URL を開いてください。',
	],
	['invite-revoked', 'この招待コードは無効になっています。'],
	['invite-expired', 'この招待コードは有効期限が切れています。'],
	['invite-used-up', 'この招待コードは使用できる回数を超えています。'],
	['invite-unknown', '招待コードが見つかりません。URL を確かめてください。'],
	['flow-expired', 'ログインの有効時間が過ぎました。もう一度やり直してください。'],
	['invalid-callback', 'ログインを完了できませんでした。もう一度やり直してください。'],
]);

export function loginErrorMessage(code: string | null): string | null {
	return (code !== null && MESSAGES.get(code)) || null;
}
