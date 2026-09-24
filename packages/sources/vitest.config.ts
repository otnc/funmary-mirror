import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'sources',
		include: ['src/**/*.test.ts'],
		environment: 'node',
	},
});
