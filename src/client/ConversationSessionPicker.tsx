import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConversationSessionTarget } from './session-target.ts'
import css from './panel.module.css'

export interface ConversationSessionPickerLabels {
  title: string
  hint: string
  target: string
  placeholder: string
  confirm: string
  cancel: string
}

/** Require a deliberate target choice when DSH has no current session id. */
export function ConversationSessionPicker(props: {
  options: readonly ConversationSessionTarget[]
  labels: ConversationSessionPickerLabels
  onSelect: (sessionId: SessionId) => void
  onCancel: () => void
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<SessionId | ''>('')
  return (
    <div className={css.conversationPicker} role="dialog" aria-modal="true" aria-label={props.labels.title} data-dsh-imagegen-session-picker>
      <section className={css.conversationPickerBody}>
        <h2>{props.labels.title}</h2>
        <p>{props.labels.hint}</p>
        <label>
          <span>{props.labels.target}</span>
          <select
            autoFocus
            aria-label={props.labels.target}
            value={selectedId}
            onChange={event => { setSelectedId(event.target.value as SessionId | '') }}
          >
            <option value="">{props.labels.placeholder}</option>
            {props.options.map(option => <option key={option.id} value={option.id}>{option.title}</option>)}
          </select>
        </label>
        <footer>
          <button type="button" onClick={props.onCancel}>{props.labels.cancel}</button>
          <button type="button" disabled={selectedId === ''} onClick={() => { if (selectedId !== '') props.onSelect(selectedId) }}>{props.labels.confirm}</button>
        </footer>
      </section>
    </div>
  )
}
