import type { Period } from '@funmary/core';

/** 画面に出す時限の表記。例: "3 限 13:10-14:40" */
export function formatPeriod(period: Period): string {
	return `${period.number} 限 ${period.start}-${period.end}`;
}
