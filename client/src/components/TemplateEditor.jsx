import { useRef } from 'react'
import { Bold, Code, Italic, Shuffle, Strikethrough, TriangleAlert } from 'lucide-react'
import { missingVariables } from '@shared/template.js'

export default function TemplateEditor({ template, setTemplate, headers }) {
  const ref = useRef(null)
  const missing = headers.length ? missingVariables(template, headers) : []

  /** Envolve a seleção atual (ou insere no cursor). */
  const wrap = (before, after = '', placeholder = '') => {
    const el = ref.current
    const { selectionStart: start, selectionEnd: end, value } = el
    const selected = value.slice(start, end) || placeholder
    setTemplate(value.slice(0, start) + before + selected + after + value.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  const insertVariable = (name) => {
    const el = ref.current
    const { selectionStart: start, selectionEnd: end, value } = el
    const token = `{{${name}}}`
    setTemplate(value.slice(0, start) + token + value.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <>
      {headers.length > 0 && (
        <div className="var-chips">
          <span className="muted small">Inserir variável:</span>
          {headers.map((h) => (
            <button key={h} type="button" className="var-chip" onClick={() => insertVariable(h)}>
              {`{{${h}}}`}
            </button>
          ))}
        </div>
      )}

      <div className="editor">
        <div className="editor-toolbar">
          <button type="button" title="Negrito (*texto*)" onClick={() => wrap('*', '*', 'texto')}>
            <Bold size={16} />
          </button>
          <button type="button" title="Itálico (_texto_)" onClick={() => wrap('_', '_', 'texto')}>
            <Italic size={16} />
          </button>
          <button type="button" title="Riscado (~texto~)" onClick={() => wrap('~', '~', 'texto')}>
            <Strikethrough size={16} />
          </button>
          <button type="button" title="Monoespaçado (```texto```)" onClick={() => wrap('```', '```', 'texto')}>
            <Code size={16} />
          </button>
          <span className="toolbar-sep" />
          <button type="button" title="Variação aleatória (spintax)" onClick={() => wrap('{', '}', 'Olá|Oi|E aí')}>
            <Shuffle size={16} /> <span className="small">Variação</span>
          </button>
          <span className="spacer" />
          <span className="muted small">{template.length} caracteres</span>
        </div>
        <textarea
          ref={ref}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={9}
          placeholder={'{Olá|Oi} {{nome}}, tudo bem?\n\nTemos uma oferta especial para você em {{cidade}}.\nUse o cupom *{{cupom|BEMVINDO}}* até sexta!'}
          spellCheck
        />
      </div>

      {missing.length > 0 && (
        <div className="callout warn">
          <TriangleAlert size={16} />
          <span>
            {missing.length === 1 ? 'A variável ' : 'As variáveis '}
            {missing.map((m, i) => (
              <span key={m}>
                {i > 0 && ', '}
                <code>{`{{${m}}}`}</code>
              </span>
            ))}{' '}
            não {missing.length === 1 ? 'existe' : 'existem'} no CSV e {missing.length === 1 ? 'ficará vazia' : 'ficarão vazias'}.
          </span>
        </div>
      )}

      <details className="help">
        <summary>Como personalizar a mensagem</summary>
        <ul>
          <li>
            <code>{'{{coluna}}'}</code> — valor da coluna do CSV para cada contato.
          </li>
          <li>
            <code>{'{{coluna|padrão}}'}</code> — usa “padrão” quando a célula estiver vazia.
          </li>
          <li>
            <code>{'{Olá|Oi|E aí}'}</code> — sorteia uma das opções para cada contato. Variar o texto reduz o risco de bloqueio.
          </li>
          <li>
            <code>*negrito*</code>, <code>_itálico_</code>, <code>~riscado~</code> e <code>```mono```</code> seguem a formatação do
            WhatsApp.
          </li>
        </ul>
      </details>
    </>
  )
}
