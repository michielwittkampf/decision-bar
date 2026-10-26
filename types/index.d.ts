// A decision Claude proposes: its label and the proposal in one sentence.
export type Proposal = { label: string; text: string }
export type Decision = 'agree' | 'disagree' | null
// A row of the bar: the proposal with its choice and remark.
export type Row = { p: Proposal; d: Decision; r: string }
// The last hidden set: each row with its choice and remark.
export type LastHidden = { rows: Row[]; show: boolean }

declare module 'claude-code' {
  interface PluginState {
    'decision-bar': {
      rows: Row[]
      sentRemarks: Record<string, string>
      hiddenLabels: string[]
      lastHidden: LastHidden | null
      collapsed: boolean
      editing: string[]
      answered: Record<string, 'agree' | 'disagree'>
      answeredRemarks: Record<string, string>
      texts: Record<string, string>
    }
  }
}
