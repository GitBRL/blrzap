import { useMemo } from 'react'
import { CheckCheck, ChevronLeft, ChevronRight, FileText, List, Mic, MousePointerClick, Music, Reply, Shuffle, Video } from 'lucide-react'
import { extractVariables, hasSpintax, renderTemplate } from '@shared/template.js'
import { dataVars, prefillValue, summaryText } from '@shared/datafields.js'
import { whatsappToHtml } from '../utils.js'

function seeded(seed) {
  // PRNG determinístico para a prévia não mudar a cada render
  let s = seed || 1
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function MediaBlock({ media }) {
  if (media.mode === 'none') return null
  const src = media.mode === 'url' ? media.url : media.previewUrl
  if (media.type === 'image' && src) return <img className="bubble-media" src={src} alt="" />
  const Icon = { video: Video, audio: Music, ptt: Mic }[media.type] || FileText
  const name = media.mode === 'file' ? media.file?.name : media.url.split('/').pop()
  return (
    <div className="bubble-file">
      <Icon size={20} />
      <span>{name || 'arquivo'}</span>
    </div>
  )
}

function Bubble({ children, time }) {
  return (
    <div className="bubble">
      {children}
      <span className="bubble-meta">
        {time} <CheckCheck size={14} />
      </span>
    </div>
  )
}

const Text = ({ text }) => <div className="bubble-text" dangerouslySetInnerHTML={{ __html: whatsappToHtml(text) }} />

function Step({ children }) {
  return (
    <div className="chat-step">
      <MousePointerClick size={13} /> {children}
    </div>
  )
}

/** Sequência do fluxo de qualificação: botões → pergunta → resposta final. */
function FlowPreview({ flow, media, text, vars, time, number, separateMedia }) {
  const render = (tpl, extra = {}) => renderTemplate(tpl, { ...vars, ...extra }, seeded(1))
  const usesList = flow.options.length > 3
  const qualifiedOption = flow.options.find((o) => o.qualified && o.label.trim())
  const ds = flow.dataStep?.enabled ? flow.dataStep : null
  const fields = ds ? ds.fields.filter((f) => f.label.trim()) : []
  // Sem CSV, mostra exemplos no lugar dos dados
  const values = fields.map((f) => (number ? prefillValue(f, vars, number) : `[${f.label}]`))

  return (
    <>
      {separateMedia && media.mode !== 'none' && (
        <Bubble time={time}>
          <MediaBlock media={media} />
        </Bubble>
      )}
      <div className="bubble-group">
        <Bubble time={time}>
          {!separateMedia && <MediaBlock media={media} />}
          {text.trim() ? <Text text={text} /> : <span className="muted small">Escreva o texto da mensagem</span>}
          {flow.footer && <div className="bubble-footer">{flow.footer}</div>}
        </Bubble>
        <div className="bubble-buttons">
          <span>
            <Reply size={14} /> {flow.buttons.yes || 'Botão 1'}
          </span>
          <span>
            <Reply size={14} /> {flow.buttons.no || 'Botão 2'}
          </span>
        </div>
      </div>

      <Step>Contato toca em “{flow.buttons.yes}”</Step>

      <div className="bubble-group">
        <Bubble time={time}>
          <Text text={render(flow.question)} />
        </Bubble>
        <div className="bubble-buttons">
          {usesList ? (
            <span>
              <List size={14} /> {flow.listButton || 'Ver opções'}
            </span>
          ) : (
            flow.options.map((o, i) => <span key={i}>{o.label || `Faixa ${i + 1}`}</span>)
          )}
        </div>
      </div>

      {usesList && (
        <ol className="list-preview">
          {flow.options.map((o, i) => (
            <li key={i} className={o.qualified ? 'q' : ''}>
              {o.label || `Faixa ${i + 1}`}
              {o.qualified && <span className="badge tone-ok">qualificado</span>}
            </li>
          ))}
        </ol>
      )}

      {qualifiedOption && ds && (
        <>
          <Step>Escolhe “{qualifiedOption.label}”</Step>
          <div className="bubble-group">
            <Bubble time={time}>
              <Text text={summaryText(render(ds.intro), fields, values)} />
            </Bubble>
            <div className="bubble-buttons">
              <span>
                <Reply size={14} /> {ds.confirmLabel || 'Confirmar'}
              </span>
              <span>
                <Reply size={14} /> {ds.editLabel || 'Alterar'}
              </span>
            </div>
          </div>
          {values.some((v) => !v) && <p className="chat-note">Dados em branco são perguntados antes do resumo.</p>}
        </>
      )}

      {qualifiedOption && flow.replies.qualified && (
        <>
          <Step>{ds ? `Toca em “${ds.confirmLabel}”` : `Escolhe “${qualifiedOption.label}”`}</Step>
          <Bubble time={time}>
            <Text text={render(flow.replies.qualified, ds ? dataVars(fields, values) : {})} />
          </Bubble>
        </>
      )}
    </>
  )
}

export default function MessagePreview({ template, media, flow, separateMedia, contacts, index, setIndex, seed, onReshuffle }) {
  const contact = contacts[index]
  // Sem CSV, mostra o nome das variáveis no lugar dos valores
  const vars = useMemo(
    () => contact?.vars || Object.fromEntries([template, flow?.question || ''].flatMap(extractVariables).map((v) => [v, `[${v}]`])),
    [contact, template, flow?.question],
  )
  const text = useMemo(() => renderTemplate(template, vars, seeded(seed + index)), [template, vars, seed, index])
  const isAudio = media.mode !== 'none' && (media.type === 'audio' || media.type === 'ptt')
  const showText = text.trim() && !isAudio
  const empty = !showText && media.mode === 'none'
  const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="preview">
      <div className="preview-head">
        <div className="avatar">{(contact?.number || '?').slice(-2)}</div>
        <div>
          <strong>{contact ? `+${contact.number}` : 'Contato de exemplo'}</strong>
          <span className="muted small">{contacts.length ? `Contato ${index + 1} de ${contacts.length.toLocaleString('pt-BR')}` : 'Importe um CSV'}</span>
        </div>
        <div className="preview-nav">
          {hasSpintax(template) && (
            <button className="icon-btn" title="Sortear outra variação" onClick={onReshuffle}>
              <Shuffle size={16} />
            </button>
          )}
          <button className="icon-btn" disabled={index <= 0} onClick={() => setIndex(index - 1)} aria-label="Contato anterior">
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-btn"
            disabled={index >= contacts.length - 1}
            onClick={() => setIndex(index + 1)}
            aria-label="Próximo contato"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="chat">
        {flow ? (
          <FlowPreview flow={flow} media={media} text={text} vars={vars} time={now} number={contact?.number} separateMedia={separateMedia} />
        ) : empty ? (
          <p className="chat-empty">A prévia da mensagem aparece aqui.</p>
        ) : (
          <Bubble time={now}>
            <MediaBlock media={media} />
            {showText && <Text text={text} />}
          </Bubble>
        )}
      </div>
    </div>
  )
}
