// 授業名を科目と照合する (設計書 9.1 の 7)。休講一覧などに書かれた授業名は、シラバスの科目名と表記が違うことがある。
// 完全一致、Unicode 正規化 (NFKC) 後の一致、"(旧:...)" を除いた一致、類似度の順に試す。
// 類似度で選ぶのは、1 位が閾値を超え、かつ 2 位と十分な差があるときだけにする。
// 誤った科目に紐付けると、別の授業の休講を通知してしまうので、迷うときは決めずに人の確認へ回す。

export interface SubjectName {
	readonly id: number;
	readonly name: string;
}

export type MatchResult =
	| {
			readonly kind: 'matched';
			readonly subjectId: number;
			readonly method: 'exact' | 'normalized' | 'old-name-removed' | 'similarity';
	  }
	/** 決められない。管理画面に出して、手で紐付ける */
	| { readonly kind: 'ambiguous'; readonly reason: 'same-name' | 'close-candidates' }
	| { readonly kind: 'unmatched' };

/** 類似度の閾値。これ以上でなければ選ばない */
export const SIMILARITY_THRESHOLD = 0.8;
/** 1 位と 2 位の類似度の差。これ以上なければ決めない */
export const SIMILARITY_MARGIN = 0.1;

/** NFKC で正規化し、空白を除き、小文字にする */
function normalize(text: string): string {
	return text.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/** 末尾の "(旧:...)" を除く。括弧と冒号は全角と半角の両方を受け付ける */
function removeOldName(text: string): string {
	return text.normalize('NFKC').replace(/\s*\(\s*旧\s*[:：][^)]*\)\s*$/u, '');
}

/** 末尾の番号 (I、II、III、数字など)。"線形代数 I" と "線形代数 II" は別の科目なので、類似度で取り違えないために使う */
function trailingNumber(text: string): string | undefined {
	return /(?:^|[^A-Za-z])([IVX]{1,4}|d+)s*$/.exec(text.normalize('NFKC'))?.[1];
}

/** 文字の 2 つ組 (bigram) の集合の Dice 係数。0 から 1 */
function similarity(a: string, b: string): number {
	if (a === b) return 1;
	if (a.length < 2 || b.length < 2) return 0;
	const grams = (text: string) => {
		const map = new Map<string, number>();
		for (let i = 0; i < text.length - 1; i++) {
			const gram = text.slice(i, i + 2);
			map.set(gram, (map.get(gram) ?? 0) + 1);
		}
		return map;
	};
	const ga = grams(a);
	const gb = grams(b);
	let overlap = 0;
	for (const [gram, count] of ga) overlap += Math.min(count, gb.get(gram) ?? 0);
	return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function findUnique(
	subjects: readonly SubjectName[],
	predicate: (subject: SubjectName) => boolean,
): SubjectName | 'multiple' | undefined {
	const hits = subjects.filter(predicate);
	if (hits.length === 0) return undefined;
	return hits.length === 1 ? hits[0] : 'multiple';
}

/** どちらも末尾に番号があり、その番号が違う (別の科目) */
function differentNumber(a: string, b: string): boolean {
	const na = trailingNumber(removeOldName(a));
	const nb = trailingNumber(removeOldName(b));
	return na !== undefined && nb !== undefined && na !== nb;
}

export function matchLessonName(lessonName: string, subjects: readonly SubjectName[]): MatchResult {
	if (lessonName.trim() === '' || subjects.length === 0) return { kind: 'unmatched' };

	const steps: {
		method: 'exact' | 'normalized' | 'old-name-removed';
		test: (s: SubjectName) => boolean;
	}[] = [
		{ method: 'exact', test: (s) => s.name === lessonName },
		{ method: 'normalized', test: (s) => normalize(s.name) === normalize(lessonName) },
		{
			method: 'old-name-removed',
			test: (s) => normalize(removeOldName(s.name)) === normalize(removeOldName(lessonName)),
		},
	];
	for (const { method, test } of steps) {
		const hit = findUnique(subjects, test);
		if (hit === 'multiple') return { kind: 'ambiguous', reason: 'same-name' };
		if (hit) return { kind: 'matched', subjectId: hit.id, method };
	}

	const target = normalize(removeOldName(lessonName));
	const ranked = subjects
		.map((subject) => ({
			subject,
			score: differentNumber(lessonName, subject.name)
				? 0
				: similarity(target, normalize(removeOldName(subject.name))),
		}))
		.sort((a, b) => b.score - a.score);
	const [first, second] = ranked;
	if (!first || first.score < SIMILARITY_THRESHOLD) return { kind: 'unmatched' };
	if (second && first.score - second.score < SIMILARITY_MARGIN) {
		return { kind: 'ambiguous', reason: 'close-candidates' };
	}
	return { kind: 'matched', subjectId: first.subject.id, method: 'similarity' };
}
