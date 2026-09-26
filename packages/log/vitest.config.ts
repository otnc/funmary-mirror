import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'log',
		include: ['src/**/*.test.ts'],
		environment: 'node',
	},
});
