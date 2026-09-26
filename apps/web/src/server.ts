// 本番の入口 (リリースの server.js になる)。adapter-node の入口を読み込む前に、環境変数を整える。
// 起動の手順は systemd の unit の ExecStart=/usr/bin/node server.js (設計書 20.4)。
import { prepareAdapterEnv } from './lib/server/adapter-env.ts';

prepareAdapterEnv(process.env);

// adapter-node の入口は、リリースの中で server.js の隣の build/ にある。
// URL を実行時に組み立てるのは、ビルドのときに読み込み先を解決させず、そのまま残すため
await import(new URL('./build/index.js', import.meta.url).href);
