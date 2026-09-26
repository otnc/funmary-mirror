import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.ts';

function capture(options: Partial<Parameters<typeof createLogger>[0]> = {}) {
	const lines: string[] = [];
	const logger = createLogger({
		level: 'debug',
		format: 'text',
		mode: 'production',
		write: (line) => lines.push(line),
		now: () => new Date('2026-09-26T05:00:00.000Z'),
		...options,
	});
	return { logger, lines };
}

describe('本番の text 形式', () => {
	it('journald が優先度を読めるように、行の先頭に <n> を付ける', () => {
		const { logger, lines } = capture();
		logger.debug('d');
		logger.info('i');
		logger.warn('w');
		logger.error('e');
		expect(lines).toEqual(['<7>d', '<6>i', '<4>w', '<3>e']);
	});

	it('タグを [tag] として付け、withTag で重ねられる', () => {
		const { logger, lines } = capture();
		logger.withTag('portal').info('取得に成功 (12 件、820 ms)');
		logger.withTag('portal').withTag('parse').warn('列が足りない');
		expect(lines).toEqual([
			'<6>[portal] 取得に成功 (12 件、820 ms)',
			'<4>[portal:parse] 列が足りない',
		]);
	});

	it('複数の引数は空白でつなぎ、Error は名前と内容を出す', () => {
		const { logger, lines } = capture();
		logger.error('失敗', new Error('つながらない'), { code: 500 });
		// Error のスタックが数行に分かれるので、どの行にも <3> が付いていて、最後の行に 3 つ目の引数が来る
		expect(lines[0]).toBe('<3>失敗 Error: つながらない');
		expect(lines.every((line) => line.startsWith('<3>'))).toBe(true);
		expect(lines.at(-1)).toContain('{"code":500}');
	});

	it('行が複数に分かれるときは、どの行にも <n> を付ける (journalctl -p で欠けないように)', () => {
		const { logger, lines } = capture();
		logger.error('a\nb\nc');
		expect(lines).toEqual(['<3>a', '<3>b', '<3>c']);
	});
});

describe('レベル', () => {
	it('level より低いものは出さない', () => {
		const { logger, lines } = capture({ level: 'warn' });
		logger.debug('d');
		logger.info('i');
		logger.warn('w');
		logger.error('e');
		expect(lines).toEqual(['<4>w', '<3>e']);
	});
});

describe('json 形式', () => {
	it('1 行 1 件の JSON にする。優先度の <n> は付けない', () => {
		const { logger, lines } = capture({ format: 'json' });
		logger.withTag('portal').info('取得に成功');
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0]!)).toEqual({
			time: '2026-09-26T05:00:00.000Z',
			level: 'info',
			tag: 'portal',
			message: '取得に成功',
		});
	});

	it('改行を含む内容も 1 行に収まる', () => {
		const { logger, lines } = capture({ format: 'json' });
		logger.error('a\nb');
		expect(lines).toHaveLength(1);
		expect((JSON.parse(lines[0]!) as { message: string }).message).toBe('a\nb');
	});
});

describe('秘密の値を伏せる', () => {
	it('text でも json でも、出力の前に伏せる', () => {
		for (const format of ['text', 'json'] as const) {
			const { logger, lines } = capture({ format });
			logger.info('GET /cal/secret-token.ics を返した', new Error('a@example.com'));
			const output = lines.join('\n');
			expect(output).toContain('/cal/***.ics');
			expect(output).not.toContain('secret-token');
			expect(output).not.toContain('a@example.com');
		}
	});

	it('タグに入った値も伏せる', () => {
		const { logger, lines } = capture();
		logger.withTag('x@example.com').info('hi');
		expect(lines[0]).not.toContain('x@example.com');
	});
});
