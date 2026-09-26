// 利用者、セッション、招待コードの保存 (設計書 8 章)。
// セッションの ID と招待コードは、DB には SHA-256 だけを保存する。DB が漏れても、そのまま使われないようにするため。
import { randomBytes } from 'node:crypto';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from './database.ts';
import { generateToken, hashToken } from './secrets.ts';
import { inviteCodes, sessions, users } from './schema.ts';

/** セッションの有効期限。使うたびに延ばす */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthUser {
	readonly id: string;
	readonly email: string;
	readonly name: string | null;
	readonly role: 'user' | 'admin';
	readonly status: 'active' | 'suspended';
}

export interface NewUser {
	readonly googleSub: string;
	readonly email: string;
	readonly name: string | null;
	readonly role: 'user' | 'admin';
}

export interface InviteCodeRecord {
	readonly id: number;
	readonly maxUses: number;
	readonly usedCount: number;
	readonly expiresAt: Date | null;
	readonly revoked: boolean;
}

export type RegisterResult =
	| { readonly kind: 'created'; readonly userId: string }
	/** 招待コードが、使い切り、期限切れ、取り消し済みなどで使えなかった。利用者は作られていない */
	| { readonly kind: 'invite-unavailable' };

export interface AuthStore {
	findUserBySub(googleSub: string): AuthUser | null;
	findUserById(id: string): AuthUser | null;
	/** 招待コードを使わずに利用者を作る。作った利用者の ID を返す */
	createUser(user: NewUser, now: Date): string;
	/** 利用者の作成と、招待コードの使用を、1 つのトランザクションで行う */
	registerUser(user: NewUser, invite: { inviteCodeId: number | null }, now: Date): RegisterResult;
	recordLogin(
		userId: string,
		now: Date,
		update?: { name?: string | null; role?: 'user' | 'admin' },
	): void;
	/** 停止すると、その利用者のセッションもすべて消す */
	setStatus(userId: string, status: 'active' | 'suspended'): void;

	/** セッションを作り、Cookie に渡す ID を返す */
	createSession(userId: string, now: Date): string;
	/** 有効なセッションの利用者を返す。使うたびに有効期限を延ばす。停止された利用者は null */
	resolveSession(token: string, now: Date): AuthUser | null;
	deleteSession(token: string): void;
	purgeExpiredSessions(now: Date): number;

	/** 招待コードを発行し、コードを返す (DB には SHA-256 だけを保存する) */
	createInviteCode(
		options: {
			maxUses: number;
			expiresAt?: Date | null;
			note?: string | null;
			createdBy?: string | null;
		},
		now: Date,
	): string;
	findInviteCode(code: string): InviteCodeRecord | null;
	revokeInviteCode(id: number, now: Date): void;
}

type UserRow = typeof users.$inferSelect;

const toUser = (row: UserRow): AuthUser => ({
	id: row.id,
	email: row.email,
	name: row.name,
	role: row.role,
	status: row.status,
});

/** 推測できない乱数の ID */
const newUserId = () => randomBytes(16).toString('base64url');

export function createAuthStore(database: Database): AuthStore {
	const { db, sqlite } = database;

	const insertUser = (
		user: NewUser,
		now: Date,
		invite: { inviteCodeId: number | null },
	): string => {
		const id = newUserId();
		let invitedBy: string | null = null;
		if (invite.inviteCodeId !== null) {
			invitedBy =
				db
					.select({ createdBy: inviteCodes.createdBy })
					.from(inviteCodes)
					.where(eq(inviteCodes.id, invite.inviteCodeId))
					.get()?.createdBy ?? null;
		}
		db.insert(users)
			.values({
				id,
				email: user.email,
				googleSub: user.googleSub,
				name: user.name,
				role: user.role,
				createdAt: now,
				lastLoginAt: now,
				invitedBy,
				inviteCodeId: invite.inviteCodeId,
			})
			.run();
		return id;
	};

	return {
		findUserBySub(googleSub) {
			const row = db.select().from(users).where(eq(users.googleSub, googleSub)).get();
			return row ? toUser(row) : null;
		},
		findUserById(id) {
			const row = db.select().from(users).where(eq(users.id, id)).get();
			return row ? toUser(row) : null;
		},
		createUser: (user, now) => insertUser(user, now, { inviteCodeId: null }),
		registerUser(user, invite, now) {
			return sqlite.transaction((): RegisterResult => {
				if (invite.inviteCodeId !== null) {
					// 使用回数の上限を、更新の条件に入れる。同時に 2 人が使っても、上限を超えない
					const changed = db
						.update(inviteCodes)
						.set({ usedCount: sql`${inviteCodes.usedCount} + 1` })
						.where(
							and(
								eq(inviteCodes.id, invite.inviteCodeId),
								isNull(inviteCodes.revokedAt),
								sql`${inviteCodes.usedCount} < ${inviteCodes.maxUses}`,
								sql`(${inviteCodes.expiresAt} IS NULL OR ${inviteCodes.expiresAt} > ${now.getTime()})`,
							),
						)
						.run().changes;
					if (changed === 0) return { kind: 'invite-unavailable' };
				}
				return { kind: 'created', userId: insertUser(user, now, invite) };
			})();
		},
		recordLogin(userId, now, update = {}) {
			db.update(users)
				.set({
					lastLoginAt: now,
					...(update.name !== undefined && { name: update.name }),
					...(update.role !== undefined && { role: update.role }),
				})
				.where(eq(users.id, userId))
				.run();
		},
		setStatus(userId, status) {
			sqlite.transaction(() => {
				db.update(users).set({ status }).where(eq(users.id, userId)).run();
				if (status === 'suspended') db.delete(sessions).where(eq(sessions.userId, userId)).run();
			})();
		},

		createSession(userId, now) {
			const token = generateToken();
			db.insert(sessions)
				.values({
					idHash: hashToken(token),
					userId,
					expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
					createdAt: now,
					lastUsedAt: now,
				})
				.run();
			return token;
		},
		resolveSession(token, now) {
			if (!token) return null;
			const idHash = hashToken(token);
			const session = db.select().from(sessions).where(eq(sessions.idHash, idHash)).get();
			if (!session || session.expiresAt.getTime() <= now.getTime()) return null;
			const user = db.select().from(users).where(eq(users.id, session.userId)).get();
			if (!user || user.status !== 'active') return null;
			// 使われるたびに有効期限を延ばす
			db.update(sessions)
				.set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS), lastUsedAt: now })
				.where(eq(sessions.idHash, idHash))
				.run();
			return toUser(user);
		},
		deleteSession(token) {
			db.delete(sessions)
				.where(eq(sessions.idHash, hashToken(token)))
				.run();
		},
		purgeExpiredSessions(now) {
			return db.delete(sessions).where(lt(sessions.expiresAt, now)).run().changes;
		},

		createInviteCode(options, now) {
			// 人が読み上げたり打ち直したりしやすいよう、セッションの ID より短くする
			const code = randomBytes(16).toString('base64url');
			db.insert(inviteCodes)
				.values({
					codeHash: hashToken(code),
					maxUses: options.maxUses,
					expiresAt: options.expiresAt ?? null,
					note: options.note ?? null,
					createdBy: options.createdBy ?? null,
					createdAt: now,
				})
				.run();
			return code;
		},
		findInviteCode(code) {
			if (!code) return null;
			const row = db
				.select()
				.from(inviteCodes)
				.where(eq(inviteCodes.codeHash, hashToken(code)))
				.get();
			return row
				? {
						id: row.id,
						maxUses: row.maxUses,
						usedCount: row.usedCount,
						expiresAt: row.expiresAt,
						revoked: row.revokedAt !== null,
					}
				: null;
		},
		revokeInviteCode(id, now) {
			db.update(inviteCodes).set({ revokedAt: now }).where(eq(inviteCodes.id, id)).run();
		},
	};
}
