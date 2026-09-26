import { redirect, type ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = ({ locals }) => {
	// ログイン済みなら、ログインの画面は要らない
	if (locals.user) redirect(303, '/');
};
