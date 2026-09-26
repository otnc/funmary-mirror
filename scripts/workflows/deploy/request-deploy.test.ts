import { describe, expect, it } from 'vitest';
import { isDeployEnabled } from './request-deploy.ts';

describe('isDeployEnabled', () => {
	it('DEPLOY_ENABLED が false のときだけ止める', () => {
		expect(isDeployEnabled('false')).toBe(false);
	});

	it('未設定、空、true、そのほかの値では止めない (止めたいときは明示する)', () => {
		for (const value of [undefined, '', 'true', 'no']) {
			expect(isDeployEnabled(value)).toBe(true);
		}
	});
});
