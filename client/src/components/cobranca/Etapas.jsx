import { useState } from 'react'
import { ChevronDown, ChevronRight, Mail, MessageCircle, Phone, Plus, RotateCcw, Scale, Trash2 } from 'lucide-react'
import { CALL_ATTEMPTS, DEFAULT_STAGES, DUNNING_VARIABLES, stageLabel, titleVars } from '@shared/dunning.js'
import { renderTemplate } from '@shared/template.js'
import { whatsappToHtml } from '../../utils.js'

// Título fictício para as prévias
const SAMPLE = {
  nome: 'Maria Silva',
  telefone: '5511987654321',
  email: 'maria@exemplo.com',
  valor: 1250,
  numero: '1001',
  boleto: 'https://exemplo.com/boletos/1001.pdf',
  pagamento: 'https://pagar.exemplo.com/1001',
  pix: '00020126580014BR.GOV.BCB.PIX0136…',
  promise: { date: '2026-10-20' },
}

function sampleVars(offset) {
  // Vencimento fictício tal que "hoje" seja o dia da etapa
  const today = new Date()
  const due = new Date(today)
  due.setDate(due.getDate() - offset)
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return titleVars({ ...SAMPLE, vencimento: key(due) }, key(today))
}

function Toggle({ checked, onChange, icon: Icon, label }) {
  return (
    <label className={`channel-toggle ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <Icon size={15} /> {label}
    </label>
  )
}

function StageEditor({ stage, update, remove }) {
  const set = (patch) => update({ ...stage, ...patch })
  const setIn = (key, patch) => update({ ...stage, [key]: { ...stage[key], ...patch } })
  const vars = sampleVars(stage.offset)
  const variants = stage.whatsapp.variants.length ? stage.whatsapp.variants : ['']

  return (
    <div className="stage-editor">
      <div className="grid-3">
        <label className="field">
          <span>Marco (dias do vencimento)</span>
          <input type="number" value={stage.offset} min={-90} max={365} onChange={(e) => set({ offset: Number(e.target.value) })} />
          <small className="muted">Negativo = antes. 0 = no dia. Ex.: 15 = D+15.</small>
        </label>
        <label className="field span-2">
          <span>Nome da etapa</span>
          <input value={stage.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
        </label>
      </div>
      <label className="field">
        <span>Objetivo e tom</span>
        <input value={stage.objective} onChange={(e) => set({ objective: e.target.value })} maxLength={300} />
      </label>

      <div className="channel-toggles">
        <Toggle checked={stage.call.enabled} onChange={(enabled) => setIn('call', { enabled, attempts: stage.call.attempts.length ? stage.call.attempts : ['phone'] })} icon={Phone} label="Ligação" />
        <Toggle checked={stage.whatsapp.enabled} onChange={(enabled) => setIn('whatsapp', { enabled })} icon={MessageCircle} label="WhatsApp" />
        <Toggle checked={stage.email.enabled} onChange={(enabled) => setIn('email', { enabled })} icon={Mail} label="E-mail ao cliente" />
        <Toggle checked={stage.internal.enabled} onChange={(enabled) => setIn('internal', { enabled })} icon={Scale} label="E-mail interno" />
      </div>

      {stage.call.enabled && (
        <div className="channel-box">
          <h4>
            <Phone size={15} /> Ligação
          </h4>
          <p className="muted small">
            Vira uma tarefa na aba Ligações. O WhatsApp e o e-mail desta etapa só saem depois do resultado (ou no horário limite). Com
            promessa, sai a confirmação da promessa no lugar da mensagem.
          </p>
          <div className="channel-toggles">
            {Object.entries(CALL_ATTEMPTS).map(([key, label]) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  checked={stage.call.attempts.includes(key)}
                  onChange={(e) =>
                    setIn('call', {
                      attempts: e.target.checked ? [...stage.call.attempts, key] : stage.call.attempts.filter((a) => a !== key),
                    })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {stage.whatsapp.enabled && (
        <div className="channel-box">
          <h4>
            <MessageCircle size={15} /> WhatsApp
            {variants.length > 1 && <span className="muted small"> · {variants.length} variações (sorteadas por cliente)</span>}
          </h4>
          {variants.map((text, i) => (
            <div className="variant" key={i}>
              <div className="variant-edit">
                <textarea
                  rows={6}
                  value={text}
                  placeholder="Mensagem desta etapa"
                  onChange={(e) => setIn('whatsapp', { variants: variants.map((v, k) => (k === i ? e.target.value : v)) })}
                />
                {variants.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setIn('whatsapp', { variants: variants.filter((_, k) => k !== i) })}
                    aria-label="Remover variação"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <div className="chat mini">
                <div className="bubble">
                  <div className="bubble-text" dangerouslySetInnerHTML={{ __html: whatsappToHtml(renderTemplate(text, vars)) }} />
                </div>
              </div>
            </div>
          ))}
          {variants.length < 5 && (
            <button type="button" className="btn small" onClick={() => setIn('whatsapp', { variants: [...variants, ''] })}>
              <Plus size={14} /> Adicionar variação
            </button>
          )}
        </div>
      )}

      {stage.email.enabled && (
        <div className="channel-box">
          <h4>
            <Mail size={15} /> E-mail ao cliente
          </h4>
          <label className="field">
            <span>Assunto</span>
            <input value={stage.email.subject} onChange={(e) => setIn('email', { subject: e.target.value })} maxLength={300} />
          </label>
          <label className="field">
            <span>Texto</span>
            <textarea rows={6} value={stage.email.body} onChange={(e) => setIn('email', { body: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={stage.email.attachBoleto} onChange={(e) => setIn('email', { attachBoleto: e.target.checked })} />
            <span>
              Anexar o PDF do boleto
              <small className="muted">Quando o link do boleto termina em .pdf. Caso contrário, o link vai no texto.</small>
            </span>
          </label>
        </div>
      )}

      {stage.internal.enabled && (
        <div className="channel-box">
          <h4>
            <Scale size={15} /> E-mail interno
          </h4>
          <label className="field">
            <span>Para (ex.: jurídico)</span>
            <input value={stage.internal.to} onChange={(e) => setIn('internal', { to: e.target.value })} placeholder="juridico@suaempresa.com.br" />
          </label>
          {!stage.internal.to.trim() && (
            <div className="callout warn small">Informe o destinatário. Sem ele, o e-mail interno desta etapa não é enviado.</div>
          )}
          <label className="field">
            <span>Assunto</span>
            <input value={stage.internal.subject} onChange={(e) => setIn('internal', { subject: e.target.value })} maxLength={300} />
          </label>
          <label className="field">
            <span>Texto</span>
            <textarea rows={6} value={stage.internal.body} onChange={(e) => setIn('internal', { body: e.target.value })} />
          </label>
        </div>
      )}

      <div className="stage-footer">
        <button type="button" className="btn danger-ghost small" onClick={remove}>
          <Trash2 size={14} /> Remover etapa
        </button>
      </div>
    </div>
  )
}

/** Etapas da régua (marcos D-7 … D+60) com canais, textos e prévias. */
export default function Etapas({ config, setConfig }) {
  const [open, setOpen] = useState(null)
  const stages = config.stages

  const update = (key, next) => setConfig({ ...config, stages: stages.map((s) => (s.key === key ? next : s)) })
  const remove = (key) => {
    if (!window.confirm('Remover esta etapa da régua?')) return
    setConfig({ ...config, stages: stages.filter((s) => s.key !== key) })
  }
  const add = () => {
    const offset = Math.max(...stages.map((s) => s.offset), 0) + 15
    const key = `etapa-${Date.now().toString(36)}`
    const stage = {
      key,
      offset,
      name: 'Nova etapa',
      phase: 'recuperacao',
      objective: '',
      enabled: true,
      call: { enabled: false, attempts: [] },
      whatsapp: { enabled: true, variants: ['Olá, {{nome}}. O título de *{{valor}}* está em aberto há {{dias_atraso}} dias. {{link_pagamento}}'] },
      email: { enabled: false, subject: '', body: '', attachBoleto: false },
      internal: { enabled: false, to: '', subject: '', body: '' },
    }
    setConfig({ ...config, stages: [...stages, stage] })
    setOpen(key)
  }
  const restore = () => {
    if (!window.confirm('Restaurar as 10 etapas padrão? Os textos editados serão substituídos.')) return
    setConfig({ ...config, stages: DEFAULT_STAGES })
  }

  const sorted = [...stages].sort((a, b) => a.offset - b.offset)

  return (
    <section className="card">
      <p className="muted small">
        A régua opera em duas fases: <strong>preventiva</strong> (até o vencimento) e <strong>recuperação</strong> (após). Os dias são
        contados a partir do vencimento (D0). Cada título recebe uma etapa por dia, a mais recente que ainda não rodou.
      </p>
      <details className="help">
        <summary>Variáveis disponíveis nos textos</summary>
        <div className="var-chips">
          {DUNNING_VARIABLES.map(([name, label]) => (
            <span key={name} className="var-chip static" title={label}>{`{{${name}}}`}</span>
          ))}
          <span className="muted small">e qualquer coluna do CSV, como {'{{empresa}}'}. Valor reserva: {'{{pix|peça o código Pix}}'}.</span>
        </div>
      </details>

      <div className="stage-list">
        {sorted.map((s) => {
          const isOpen = open === s.key
          return (
            <div key={s.key} className={`stage-card phase-${s.offset <= 0 ? 'preventiva' : 'recuperacao'} ${s.enabled ? '' : 'off'}`}>
              <div className="stage-row">
                <button type="button" className="stage-toggle" onClick={() => setOpen(isOpen ? null : s.key)} aria-expanded={isOpen}>
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="stage-label">{stageLabel(s.offset)}</span>
                  <span className="stage-name">
                    <strong>{s.name}</strong>
                    <span className="muted small">{s.objective}</span>
                  </span>
                </button>
                {s.enabled && s.internal.enabled && !s.internal.to.trim() && <span className="badge tone-warn">falta o e-mail interno</span>}
                <span className="stage-icons">
                  {s.call.enabled && <Phone size={15} title="Ligação" />}
                  {s.whatsapp.enabled && <MessageCircle size={15} title="WhatsApp" />}
                  {s.email.enabled && <Mail size={15} title="E-mail" />}
                  {s.internal.enabled && <Scale size={15} title="E-mail interno" />}
                </span>
                <label className="check stage-enabled" title="Etapa ativa">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => update(s.key, { ...s, enabled: e.target.checked })} />
                  <span className="small">Ativa</span>
                </label>
              </div>
              {isOpen && <StageEditor stage={s} update={(next) => update(s.key, next)} remove={() => remove(s.key)} />}
            </div>
          )
        })}
      </div>

      <div className="actions">
        <button type="button" className="btn" onClick={add}>
          <Plus size={16} /> Adicionar etapa
        </button>
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={restore}>
          <RotateCcw size={16} /> Restaurar padrão
        </button>
      </div>
    </section>
  )
}
