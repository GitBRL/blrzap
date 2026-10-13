import { useMemo } from 'react'
import { CheckCheck, ChevronLeft, ChevronRight, FileText, List, Mic, MousePointerClick, Music, Reply, Shuffle, Video } from 'lucide-react'
import { extractVariables, hasSpintax, renderTemplate } from '@shared/template.js'
import { nextOf, NODE_TYPES, nodeById, startNode, usesList } from '@shared/workflow.js'
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

/** A mensagem do disparo com os botões do workflow e para onde cada botão leva. */
function WorkflowPreview({ workflow, media, text, time, separateMedia }) {
  const start = startNode(workflow)
  const choices = start?.data.choices || []
  const list = usesList(start)
  const titleOf = (id) => {
    const n = nodeById(workflow, id)
    return n ? n.data.title || NODE_TYPES[n.type]?.label : null
  }
  const after = (handle) => titleOf(nextOf(workflow, start.id, handle))

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
          {start?.data.footer && <div className="bubble-footer">{start.data.footer}</div>}
        </Bubble>
        {choices.length > 0 && (
          <div className="bubble-buttons">
            {list ? (
              <span>
                <List size={14} /> {start.data.listButton || 'Ver opções'}
              </span>
            ) : (
              choices.map((c, i) => (
                <span key={i}>
                  <Reply size={14} /> {c.label || `Opção ${i + 1}`}
                </span>
              ))
            )}
          </div>
        )}
      </div>
      {list && (
        <ol className="list-preview">
          {choices.map((c, i) => (
            <li key={i}>{c.label}</li>
          ))}
        </ol>
      )}

      <div className="wf-preview-next">
        <strong>Depois, pelo workflow “{workflow.name}”:</strong>
        <ul>
          {choices.length ? (
            choices.map((c, i) => (
              <li key={i}>
                <MousePointerClick size={13} /> “{c.label}” → {after(`c${i}`) || 'fim do caminho'}
                {c.tag && <span className="badge tone-ok">{c.tag}</span>}
              </li>
            ))
          ) : (
            <li>
              <MousePointerClick size={13} /> Segue direto para {after('next') || 'o fim (sem próximos blocos)'}
            </li>
          )}
          {after('timeout') && (
            <li>
              <MousePointerClick size={13} /> Sem resposta → {after('timeout')}
            </li>
          )}
        </ul>
      </div>
    </>
  )
}

export default function MessagePreview({ template, media, workflow, separateMedia, contacts, index, setIndex, seed, onReshuffle }) {
  const contact = contacts[index]
  // Sem CSV, mostra o nome das variáveis no lugar dos valores
  const vars = useMemo(
    () => contact?.vars || Object.fromEntries(extractVariables(template).map((v) => [v, `[${v}]`])),
    [contact, template],
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
        {workflow ? (
          <WorkflowPreview workflow={workflow} media={media} text={text} time={now} separateMedia={separateMedia} />
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
