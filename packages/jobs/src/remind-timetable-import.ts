// 授業時間割の PDF を取り込む時期を、管理者に知らせる定期処理 (忘れ物の防止)。
// 時間割の枠は、大学のログインが要る場所の PDF から、管理者が取り込む (自動では取得しない)。
// 前期は 3 月 31 日 (新年度の前)、後期は 8 月 31 日 (後期の前) の朝 9 時に、管理用の Discord に知らせる。
import type { JobDefinition } from './runner.ts';
import type { SourceAlert } from './source-run.ts';

export interface RemindTimetableImportDeps {
	readonly alert: (alert: SourceAlert) => Promise<unknown>;
}

export function createRemindTimetableImportJob(deps: RemindTimetableImportDeps): JobDefinition {
	return {
		name: 'remind-timetable-import',
		// 日本時間の 3 月 31 日と 8 月 31 日の 9 時
		schedule: '0 9 31 3,8 *',
		timeoutMs: 60 * 1000,
		async run({ now }) {
			const at = now();
			// 日本時間の月と、その年の暦年 (年度ではなく、3 月と 8 月が属する年)
			const jst = new Date(at.getTime() + 9 * 60 * 60 * 1000);
			const month = jst.getUTCMonth() + 1;
			const year = jst.getUTCFullYear();
			// 3 月は新年度の前期、8 月はその年の後期
			const term = month === 3 ? '前期' : month === 8 ? '後期' : null;
			if (term === null) return '今日は、時間割を取り込む通知の日ではありません';
			const label = `${year} 年度${term}`;
			await deps.alert({
				severity: 'info',
				title: `${label}の授業時間割を取り込む時期です`,
				message:
					`大学が配る ${label}の授業時間割の PDF を用意して、取り込んでください。\n` +
					'手順: funmary-admin timetable import <PDF のファイル> で、内容を確かめて取り込みます。\n' +
					'読み取りの警告が出たら内容を確かめ、照合できなかった授業名を管理画面で紐付けます。\n' +
					'作業の Issue (needs-author のラベル) も見てください。',
				key: `timetable-import-reminder:${year}-${term}`,
			});
			return `${label}の時間割を取り込む時期だと、管理者に知らせました`;
		},
	};
}
