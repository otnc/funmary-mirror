import { expect, test } from '@playwright/test';

test('トップページにアプリ名と時限が出る', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'Funmary' })).toBeVisible();
	await expect(page.getByRole('listitem').first()).toHaveText('1 限 09:00-10:30');
});
