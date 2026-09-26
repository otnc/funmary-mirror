import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@funmary/log';
import { createAdminAlerter } from './admin-alert.ts';

const WEBHOOK = 'https://discord.com/api/webhooks/123456789/SECRET-token_abc';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function setup(options: { webhookUrl?: string; dryRun?: boolean; fetchImpl?: FetchLike } = {}) {
	const lines: string[] = [];
	const log = createLogger({
		level: 'debug',
		format: 'text',
		mode: 'production',
		write: (line) => lines.push(line),
	});
	let time = new Date('2026-10-01T00:00:00Z').getTime();
	const calls: { url: string; body: { content: string; allowed_mentions: unknown } }[] = [];
	const fetchImpl =
		options.fetchImpl ??
		vi.fn((url: string, init?: RequestInit) => {
			calls.push({
				url,
				body: JSON.parse(
					typeof init?.body === 'string' ? init.body : '{}',
				) as (typeof calls)[number]['body'],
			});
			return Promise.resolve(new Response(null, { status: 204 }));
		});
	const alerter = createAdminAlerter({
		webhookUrl: options.webhookUrl ?? WEBHOOK,
		dryRun: options.dryRun ?? false,
		fetch: fetchImpl,
		log,
		now: () => new Date(time),
	});
	return {
		alerter,
		lines,
		calls,
		fetchImpl,
		advance: (ms: number) => {
			time += ms;
		},
	};
}

describe('createAdminAlerter: 送る', () => {
	it('Discord の Webhook に、題と本文を送り、メンションを効かせない', async () => {
		const { alerter, calls } = setup();
		expect(
			await alerter.send({
				severity: 'warn',
				title: '取得元が不調です',
				message: 'portal が 3 回失敗',
			}),
		).toBe('sent');
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe(WEBHOOK);
		expect(calls[0]!.body.content).toContain('取得元が不調です');
		expect(calls[0]!.body.content).toContain('portal が 3 回失敗');
		// @everyone などを本文に混ぜられても、通知が飛ばないようにする
		expect(calls[0]!.body.allowed_mentions).toEqual({ parse: [] });
	});

	it('ログに warn 以上で残す (error は error、info は info)', async () => {
		const { alerter, lines } = setup();
		await alerter.send({ severity: 'error', title: 'E' });
		await alerter.send({ severity: 'warn', title: 'W' });
		await alerter.send({ severity: 'info', title: 'I' });
		expect(lines.filter((l) => l.startsWith('<3>'))).toHaveLength(1);
		expect(lines.filter((l) => l.startsWith('<4>'))).toHaveLength(1);
		expect(lines.filter((l) => l.startsWith('<6>'))).toHaveLength(1);
	});

	it('本文の秘密の値を伏せてから送る (Webhook の URL、トークン、メールアドレス)', async () => {
		const { alerter, calls } = setup();
		await alerter.send({
			severity: 'error',
			title: '失敗',
			message: `POST ${WEBHOOK} と /cal/secret-token.ics と taro@fun.ac.jp`,
		});
		const content = calls[0]!.body.content;
		expect(content).not.toContain('SECRET-token_abc');
		expect(content).not.toContain('secret-token');
		expect(content).not.toContain('taro@fun.ac.jp');
	});

	it('長すぎる本文は、Discord の上限 (2000 文字) に収まるように切る', async () => {
		const { alerter, calls } = setup();
		await alerter.send({ severity: 'warn', title: 't', message: 'あ'.repeat(5000) });
		expect(calls[0]!.body.content.length).toBeLessThanOrEqual(2000);
	});
});

describe('createAdminAlerter: 同じ内容のまとめ', () => {
	it('同じ内容 (キー) の通知は、1 時間に 1 回までにする', async () => {
		const { alerter, calls, advance } = setup();
		expect(await alerter.send({ severity: 'warn', title: 'A' })).toBe('sent');
		advance(30 * 60 * 1000);
		expect(await alerter.send({ severity: 'warn', title: 'A' })).toBe('suppressed');
		advance(31 * 60 * 1000);
		expect(await alerter.send({ severity: 'warn', title: 'A' })).toBe('sent');
		expect(calls).toHaveLength(2);
	});

	it('キーを指定すれば、題や本文が違っても同じ内容として数える。キーが違えば別々に送る', async () => {
		const { alerter, calls } = setup();
		await alerter.send({ severity: 'warn', title: 'A', message: '1', key: 'source:portal' });
		expect(
			await alerter.send({ severity: 'warn', title: 'A', message: '2', key: 'source:portal' }),
		).toBe('suppressed');
		expect(
			await alerter.send({ severity: 'warn', title: 'A', message: '1', key: 'source:hope' }),
		).toBe('sent');
		expect(calls).toHaveLength(2);
	});
});

describe('createAdminAlerter: 送れないとき', () => {
	it('Webhook が空なら、ログにだけ残して送らない', async () => {
		const { alerter, lines, fetchImpl } = setup({ webhookUrl: '' });
		expect(await alerter.send({ severity: 'warn', title: 'A' })).toBe('logged');
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(lines.some((l) => l.includes('A'))).toBe(true);
	});

	it('Discord の Webhook の URL ではない値は、使わない (送り先のすり替えを防ぐ)', async () => {
		const { alerter, fetchImpl } = setup({ webhookUrl: 'https://evil.example.com/hook' });
		expect(await alerter.send({ severity: 'warn', title: 'A' })).toBe('logged');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('dry-run のときは、送らず内容だけをログに出す', async () => {
		const { alerter, lines, fetchImpl } = setup({ dryRun: true });
		expect(await alerter.send({ severity: 'warn', title: 'A', message: '内容' })).toBe('logged');
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(lines.some((l) => l.includes('内容'))).toBe(true);
	});

	it('送信が失敗したら 1 回だけ再送し、それでも失敗ならログに残して終える。例外は出さない', async () => {
		const fetchImpl = vi.fn(() => Promise.resolve(new Response('x', { status: 500 })));
		const { alerter, lines } = setup({ fetchImpl });
		expect(await alerter.send({ severity: 'error', title: 'A' })).toBe('failed');
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(lines.some((l) => l.includes('送れませんでした'))).toBe(true);
	});

	it('通信のエラーでも、例外にせず失敗として返す。1 回目だけ失敗なら、再送で送れる', async () => {
		const fetchImpl = vi
			.fn<() => Promise<Response>>()
			.mockRejectedValueOnce(new TypeError('fetch failed'))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		const { alerter } = setup({ fetchImpl });
		expect(await alerter.send({ severity: 'warn', title: 'A' })).toBe('sent');
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});
