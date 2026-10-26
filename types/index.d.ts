// A decision Claude proposes: its label, the proposal in one sentence and, optionally, the answers
// shown as buttons in place of agree and disagree.
export type Proposal = { label: string; text: string; options?: string[] }
// Agree, disagree, the index of the chosen answer button, or nothing yet.
export type Decision = 'agree' | 'disagree' | number | null
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
      answered: Record<string, string>
      answeredRemarks: Record<string, string>
      texts: Record<string, string>
    }
  }
}
