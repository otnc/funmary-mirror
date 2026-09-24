// コミットメッセージの規約。詳しくは CONTRIBUTING.md の "コミットメッセージ" を参照
export default {
	extends: ['@commitlint/config-conventional'],
	rules: {
		// 説明は日本語で書くので、大文字小文字の規則は使わない
		'subject-case': [0],
		'header-max-length': [2, 'always', 100],
		'body-max-line-length': [0],
		'footer-max-line-length': [0],
		// 説明の末尾に句点を付けない
		'subject-full-stop': [2, 'never', '。'],
		'scope-enum': [
			1,
			'always',
			[
				'web',
				'core',
				'db',
				'auth',
				'api',
				'sources',
				'notify',
				'jobs',
				'extension',
				'deploy',
				'deps',
				'ci',
				'repo',
				'docs',
			],
		],
	},
};
