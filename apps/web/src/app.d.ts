// SvelteKit の型の拡張。https://svelte.dev/docs/kit/types#app.d.ts
import type { AuthUser } from '@funmary/db';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** ログインしている利用者。ログインしていなければ null */
			user: AuthUser | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
