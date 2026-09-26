import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'jobs',
		include: ['src/**/*.test.ts'],
		environment: 'node',
	},
});
