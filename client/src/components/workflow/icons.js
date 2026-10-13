import { ClipboardCheck, GitBranch, Megaphone, MessageCircleQuestion, MessageSquare, Webhook } from 'lucide-react'

/** O ícone de cada tipo de bloco — no canvas, na paleta e nos resultados da campanha. */
export const BLOCK_ICONS = {
  start: Megaphone,
  message: MessageSquare,
  question: MessageCircleQuestion,
  data: ClipboardCheck,
  condition: GitBranch,
  webhook: Webhook,
}
