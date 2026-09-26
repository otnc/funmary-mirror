import type { ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = ({ locals }) => ({
	// 画面に渡すのは、表示に要るものだけにする (ID や権限は渡さない)
	user: locals.user ? { email: locals.user.email } : null,
});
