<script lang="ts">
	import { resolve } from '$app/paths';
	import { DEFAULT_PERIODS } from '@funmary/core';
	import { formatPeriod } from '$lib/period-label.ts';

	let { data }: { data: { user: { email: string } | null } } = $props();
</script>

<svelte:head>
	<title>Funmary</title>
	<meta
		name="description"
		content="公立はこだて未来大学の学生向けの便利な総合 Web アプリ (非公式)"
	/>
</svelte:head>

<main>
	<h1>Funmary</h1>
	<p>公立はこだて未来大学の学生向けの便利な総合 Web アプリです。準備中です。</p>

	{#if data.user}
		<p>{data.user.email} でログインしています。</p>
		<!-- /auth は、サーバーが処理する。SvelteKit の form の処理を通さず、通常の送信にする -->
		<form method="POST" action="/auth/logout" data-sveltekit-reload>
			<button type="submit">ログアウト</button>
		</form>
	{:else}
		<p><a href={resolve('/login')}>ログイン</a></p>
	{/if}

	<h2>時限</h2>
	<ul>
		{#each DEFAULT_PERIODS as period (period.number)}
			<li>{formatPeriod(period)}</li>
		{/each}
	</ul>

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
</style>
