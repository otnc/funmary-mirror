import { describe, expect, it } from 'vitest';
import { prepareAdapterEnv } from './adapter-env.ts';

describe('prepareAdapterEnv', () => {
	it('何も書かれていなければ、自分だけが届く 127.0.0.1 の 28461 番で待ち受ける', () => {
		const env: NodeJS.ProcessEnv = {};
		prepareAdapterEnv(env);
		expect(env['HOST']).toBe('127.0.0.1');
		expect(env['PORT']).toBe('28461');
	});

	it('空の値 (.env.example を丸ごと写した環境変数ファイルの HOST= や PORT=) は、書かなかったのと同じに扱う', () => {
		const env: NodeJS.ProcessEnv = { HOST: '', PORT: '' };
		prepareAdapterEnv(env);
		expect(env['HOST']).toBe('127.0.0.1');
		expect(env['PORT']).toBe('28461');
	});

	it('書かれた値は、そのまま使う', () => {
		const env: NodeJS.ProcessEnv = { HOST: '0.0.0.0', PORT: '3000' };
		prepareAdapterEnv(env);
		expect(env['HOST']).toBe('0.0.0.0');
		expect(env['PORT']).toBe('3000');
	});

	it('adapter-node が数として読む値 (待ち時間、深さ) が空なら、消して既定に任せる (空のままだと NaN になる)', () => {
		const env: NodeJS.ProcessEnv = {
			SHUTDOWN_TIMEOUT: '',
			IDLE_TIMEOUT: '',
			XFF_DEPTH: '',
			KEEP_ALIVE_TIMEOUT: '',
			HEADERS_TIMEOUT: '',
			BODY_SIZE_LIMIT: '',
		};
		prepareAdapterEnv(env);
		for (const name of Object.keys(env)) {
			if (name !== 'HOST' && name !== 'PORT') expect(name in env).toBe(false);
		}
	});

	it('空のヘッダーの名前や ORIGIN も消す。値のあるものは残す', () => {
		const env: NodeJS.ProcessEnv = {
			ORIGIN: '',
			ADDRESS_HEADER: 'X-Forwarded-For',
			PROTOCOL_HEADER: '',
			XFF_DEPTH: '1',
		};
		prepareAdapterEnv(env);
		expect('ORIGIN' in env).toBe(false);
		expect('PROTOCOL_HEADER' in env).toBe(false);
		expect(env['ADDRESS_HEADER']).toBe('X-Forwarded-For');
		expect(env['XFF_DEPTH']).toBe('1');
	});

	it('adapter-node と関係のない変数には触らない', () => {
		const env: NodeJS.ProcessEnv = { DATA_DIR: '', GOOGLE_CLIENT_ID: '' };
		prepareAdapterEnv(env);
		expect(env['DATA_DIR']).toBe('');
		expect(env['GOOGLE_CLIENT_ID']).toBe('');
	});
});
