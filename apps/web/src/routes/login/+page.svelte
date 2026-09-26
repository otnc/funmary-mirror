<script lang="ts">
	import { page } from '$app/state';
	import { loginErrorMessage } from '$lib/login-error.ts';

	const message = $derived(loginErrorMessage(page.url.searchParams.get('error')));
</script>

<svelte:head>
	<title>ログイン - Funmary</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<h1>ログイン</h1>

	{#if message}
		<p class="error" role="alert">{message}</p>
	{/if}

	<p>大学の Google アカウント (@fun.ac.jp) でログインします。</p>
	<!-- /auth は SvelteKit の画面ではなく、サーバーが処理するので、ページの遷移ではなく通常の移動にする -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- 画面の経路ではなく、サーバーの口 -->
	<p><a class="button" href="/auth/google" data-sveltekit-reload>Google でログイン</a></p>

	<footer>
		<p>Funmary は公立はこだて未来大学の公式のアプリではありません。</p>
	</footer>
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
		font-family: system-ui, sans-serif;
		line-height: 1.7;
	}
	.error {
		padding: 0.75rem 1rem;
		border: 1px solid currentcolor;
		border-radius: 0.25rem;
		color: #b3261e;
	}
	.button {
		display: inline-block;
		padding: 0.5rem 1rem;
		border: 1px solid currentcolor;
		border-radius: 0.25rem;
		text-decoration: none;
	}
</style>
