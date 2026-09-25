// 管理用コマンド。手元では pnpm funmary <コマンド>、本番では funmary <コマンド> で使う (設計書 19.4)。
// 秘密の値は画面に出さない。出すのは変数の名前だけにする。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineCommand, runMain } from 'citty';
import { openDatabase } from '@funmary/db';
import { parseConfig, type Config } from './lib/server/config.ts';
import { fillSecrets, generateSecrets } from './lib/server/env-file.ts';

/** 手元の開発では .env を読む。本番では systemd やラッパーが環境変数を渡すので読まない */
function loadDevelopmentEnv(): void {
	if (process.env['NODE_ENV'] !== 'production' && existsSync('.env')) {
		process.loadEnvFile('.env');
	}
}

/** 設定を読む。足りない値や誤りがあれば、直し方を示して終える */
function loadConfigOrExit(): Config {
	loadDevelopmentEnv();
	const result = parseConfig(process.env);
	if (result.ok) return result.config;
	console.error('環境変数に足りない値か誤りがあります。次の変数を直してください。');
	for (const issue of result.issues) console.error(`  ${issue.name}: ${issue.message}`);
	process.exit(1);
}

const init = defineCommand({
	meta: {
		name: 'init',
		description: '環境変数ファイルの空の鍵を作って埋める。値のある行は変えない',
	},
	args: {
		file: {
			type: 'string',
			description: '書き換える環境変数ファイル。なければ .env.example から作る',
			default: '.env',
		},
	},
	run({ args }) {
		const exists = existsSync(args.file);
		const text = exists
			? readFileSync(args.file, 'utf8')
			: existsSync('.env.example')
				? readFileSync('.env.example', 'utf8')
				: '';
		const result = fillSecrets(text, generateSecrets);
		if (exists && result.filled.length === 0) {
			console.log(`${args.file} の鍵はすべて埋まっています。何も変えていません。`);
			return;
		}
		// 既存のファイルは上書きしても所有者と権限が変わらない。新しく作るときは自分だけが読めるようにする
		writeFileSync(args.file, result.text, exists ? {} : { mode: 0o600 });
		console.log(`${args.file} に次の鍵を書きました: ${result.filled.join(', ')}`);
		console.log('VAPID_SUBJECT (連絡先の mailto:) と Google の値は、自分で書いてください。');
	},
});

const migrate = defineCommand({
	meta: { name: 'migrate', description: 'DB のマイグレーションを行う (起動時にも自動で行われる)' },
	run() {
		const config = loadConfigOrExit();
		mkdirSync(config.dataDir, { recursive: true });
		const database = openDatabase(join(config.dataDir, 'funmary.db'), {
			backupDir: join(config.dataDir, 'backups'),
		});
		database.close();
		console.log(`${join(config.dataDir, 'funmary.db')} のマイグレーションを終えました。`);
	},
});

const main = defineCommand({
	meta: { name: 'funmary', description: 'Funmary の管理用コマンド' },
	subCommands: { init, migrate },
});

await runMain(main);
