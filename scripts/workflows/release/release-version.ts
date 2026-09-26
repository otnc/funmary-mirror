// リリースの版の名前。release.yml と deploy.yml が同じ規則で作る。
// VPS の funmary-update と update.sh は、この形 (build-<7 文字以上の 16 進数>) だけを受け付ける。

/** コミットの hash から build-<先頭 7 文字> の版を作る */
export function releaseVersion(sha: string): string {
	if (!/^[0-9a-f]{7,40}$/.test(sha)) {
		throw new Error(`コミットの hash として読めません: ${JSON.stringify(sha)}`);
	}
	return `build-${sha.slice(0, 7)}`;
}
