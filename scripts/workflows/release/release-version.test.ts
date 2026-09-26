import { describe, expect, it } from 'vitest';
import { releaseVersion } from './release-version.ts';

describe('releaseVersion', () => {
	it('コミットの hash の先頭 7 文字から build-<hash> の版を作る', () => {
		expect(releaseVersion('2d42ad6e8406a407bbe131d056c8a8eb0e8551a6')).toBe('build-2d42ad6');
	});

	it('hash として読めない値は断る (版の名前は VPS のコマンドに渡るため)', () => {
		expect(() => releaseVersion('main; rm -rf /')).toThrow(/コミットの hash/);
		expect(() => releaseVersion('')).toThrow(/コミットの hash/);
	});
});
