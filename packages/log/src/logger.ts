// consola を包んだロガー (設計書 4.6)。
// 手元の開発 (端末) では consola の標準の表示を使い、本番では 1 行 1 件の素の文字列か JSON にする。
// どちらも、出力の前に redact で秘密の値を伏せる。
import { createConsola, type ConsolaInstance, type ConsolaReporter } from 'consola';
import { redact } from './redact.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'text' | 'json';

export interface LoggerOptions {
	readonly level: LogLevel;
	readonly format: LogFormat;
	/** production は journald 向けの素の出力。development は端末向けの consola の標準の表示 */
	readonly mode: 'production' | 'development';
	/** 1 行 (production では改行を含まない 1 件) の書き出し先。既定は標準出力。テストで差し替える */
	readonly write?: (line: string) => void;
	readonly now?: () => Date;
}

export interface Logger {
	debug(...args: unknown[]): void;
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
	withTag(tag: string): Logger;
}

// consola のレベルの数字。値が大きいほど細かい
const CONSOLA_LEVEL: Record<LogLevel, number> = { error: 0, warn: 1, info: 3, debug: 4 };
// journald の優先度 (syslog): 3 = err、4 = warning、6 = info、7 = debug
const PRIORITY: Record<LogLevel, number> = { error: 3, warn: 4, info: 6, debug: 7 };

function stringify(arg: unknown): string {
	if (typeof arg === 'string') return arg;
	if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
	try {
		return JSON.stringify(arg) ?? String(arg);
	} catch {
		return String(arg);
	}
}

function productionReporter(options: LoggerOptions): ConsolaReporter {
	const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
	const now = options.now ?? (() => new Date());
	return {
		log(entry) {
			const level = entry.type as LogLevel;
			const message = String(entry.args[0] ?? '');
			const tag = entry.tag || undefined;
			if (options.format === 'json') {
				write(
					JSON.stringify({
						time: now().toISOString(),
						level,
						...(tag && { tag }),
						message,
					}),
				);
				return;
			}
			// journald は行の先頭の <n> を優先度として読む。複数行の内容は、どの行にも付ける
			const prefix = `<${PRIORITY[level]}>`;
			const head = tag ? `[${tag}] ` : '';
			message.split('\n').forEach((line, index) => {
				write(`${prefix}${index === 0 ? head : ''}${line}`);
			});
		},
	};
}

function wrap(instance: ConsolaInstance): Logger {
	const emit =
		(type: LogLevel) =>
		(...args: unknown[]) => {
			// 伏せるのは、consola に渡す前の 1 か所だけ
			instance[type](redact(args.map(stringify).join(' ')));
		};
	return {
		debug: emit('debug'),
		info: emit('info'),
		warn: emit('warn'),
		error: emit('error'),
		withTag: (tag) => wrap(instance.withTag(redact(tag))),
	};
}

export function createLogger(options: LoggerOptions): Logger {
	const instance = createConsola({
		level: CONSOLA_LEVEL[options.level],
		...(options.mode === 'production' && { reporters: [productionReporter(options)] }),
	});
	return wrap(instance);
}
