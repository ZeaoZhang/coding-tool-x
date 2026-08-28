import {
  ChatboxEllipsesOutline,
  CodeSlashOutline,
  ExtensionPuzzleOutline,
  PlanetOutline,
  SparklesOutline,
  TerminalOutline
} from '@vicons/ionicons5'

export const ICON_TOKENS = Object.freeze({
  claude: ChatboxEllipsesOutline,
  code: CodeSlashOutline,
  codex: CodeSlashOutline,
  gemini: SparklesOutline,
  opencode: ExtensionPuzzleOutline,
  omp: PlanetOutline,
  terminal: TerminalOutline
})

export function resolveIconToken(token) {
  return ICON_TOKENS[String(token || '').trim().toLowerCase()] || TerminalOutline
}
