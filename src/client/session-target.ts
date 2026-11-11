import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

/** The fields needed to present explicit conversation targets. */
export type SessionTargetSnapshot = Pick<ReturnType<ISessions['list']['getSnapshot']>, 'ids' | 'byId'>

/** A session the user can explicitly choose as the destination for an image. */
export interface ConversationSessionTarget {
  id: SessionId
  title: string
}

/** Read only DSH's authoritative current selection; never infer from list order. */
export function currentConversationSessionId(sessions: Pick<ISessions, 'list'> | undefined): SessionId | undefined {
  return sessions?.list.getSnapshot().current
}

/**
 * Build explicit targets from the host's listed sessions.
 *
 * @param snapshot - DSH's current session-list snapshot.
 * @returns listed sessions in host order, with the host-projected display title.
 */
export function conversationSessionTargets(snapshot: SessionTargetSnapshot | undefined): ConversationSessionTarget[] {
  if (snapshot === undefined) return []
  return snapshot.ids.map(id => ({
    id,
    title: snapshot.byId[id]?.displayTitle || snapshot.byId[id]?.title || String(id),
  }))
}
