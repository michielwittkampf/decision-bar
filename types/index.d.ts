export type Option = { label: string; text: string }
// A decision (agree / disagree) or, with `options`, a question from the desktop app's next-step
// box, with that box's answer buttons.
export type Proposal = { label: string; text: string; options?: Option[] }
export type Decision = 'agree' | 'disagree' | null
// The last hidden set: each row with its choice and remark.
export type LastHidden = { rows: { p: Proposal; d: Decision; r: string }[]; show: boolean }

declare module 'claude-code' {
  interface PluginState {
    'decision-bar': {
      proposals: Proposal[]
      decisions: Decision[]
      remarks: string[]
      sentRemarks: Record<string, string>
      hiddenLabels: string[]
      lastHidden: LastHidden | null
      collapsed: boolean
      editing: string[]
      answered: Record<string, 'agree' | 'disagree'>
      language: string
      texts: Record<string, string>
    }
  }
}
