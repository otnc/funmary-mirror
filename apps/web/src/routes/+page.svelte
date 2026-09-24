<script lang="ts">
	import { DEFAULT_PERIODS } from '@funmary/core';
	import { formatPeriod } from '$lib/period-label.ts';
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
