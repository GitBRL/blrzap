import { Clock } from 'lucide-react'
import { estimateFinish, WEEKDAYS } from '@shared/schedule.js'
import { browserTimeZone, estimateSeconds, formatDuration, formatWhen } from '../utils.js'

function NumberField({ label, value, onChange, min = 0, max, step = 1, suffix, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-suffix">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        {suffix && <span>{suffix}</span>}
      </div>
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

export function WindowSettings({ window: w, setWindow }) {
  const toggleDay = (d) => setWindow({ ...w, days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d].sort() })
  const invalid = w.enabled && (!w.days.length || !w.start || !w.end || w.end <= w.start)

  return (
    <div className="window-settings">
      <label className="check">
        <input type="checkbox" checked={w.enabled} onChange={(e) => setWindow({ ...w, enabled: e.target.checked })} />
        <span>
          Enviar apenas dentro de um horário
          <small className="muted">Fora da janela o disparo para e retoma sozinho quando ela abrir.</small>
        </span>
      </label>
      {w.enabled && (
        <div className="window-fields">
          <div className="weekday-picker" role="group" aria-label="Dias da semana">
            {WEEKDAYS.map((label, d) => (
              <button
                key={d}
                type="button"
                className={w.days.includes(d) ? 'active' : ''}
                aria-pressed={w.days.includes(d)}
                onClick={() => toggleDay(d)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="time-range">
            <input type="time" value={w.start} onChange={(e) => setWindow({ ...w, start: e.target.value })} aria-label="Início" />
            <span className="muted">até</span>
            <input type="time" value={w.end} onChange={(e) => setWindow({ ...w, end: e.target.value })} aria-label="Fim" />
          </div>
          {invalid && <small className="text-bad">Escolha ao menos um dia e um horário de fim depois do início.</small>}
        </div>
      )}
    </div>
  )
}

export default function SendSettings({ settings, setSettings, count, startAt }) {
  const set = (key) => (value) => setSettings({ ...settings, [key]: value })
  const lowDelay = Number(settings.minDelay) < 5
  const seconds = estimateSeconds(count, settings)
  const windowWithTz = { ...settings.window, timeZone: browserTimeZone() }
  const w = settings.window
  const windowValid = !w.enabled || (w.days.length > 0 && w.start && w.end && w.end > w.start)
  const showFinish = count > 0 && windowValid && (w.enabled || startAt)
  const finish = showFinish ? estimateFinish(startAt || Date.now(), seconds, windowWithTz) : null

  return (
    <>
      <div className="grid-2">
        <NumberField label="Intervalo mínimo" value={settings.minDelay} onChange={set('minDelay')} min={1} suffix="seg" />
        <NumberField label="Intervalo máximo" value={settings.maxDelay} onChange={set('maxDelay')} min={1} suffix="seg" />
        <NumberField
          label="Mensagens por lote"
          value={settings.batchSize}
          onChange={set('batchSize')}
          min={0}
          hint="0 = sem pausa entre lotes"
        />
        <NumberField label="Pausa entre lotes" value={settings.batchPause} onChange={set('batchPause')} min={0} suffix="min" />
        <NumberField
          label="Simular “digitando…”"
          value={settings.typingSeconds}
          onChange={set('typingSeconds')}
          min={0}
          max={30}
          suffix="seg"
          hint="Exibido ao contato antes de cada mensagem"
        />
      </div>

      <WindowSettings window={settings.window} setWindow={set('window')} />

      <label className="check">
        <input type="checkbox" checked={settings.validateNumbers} onChange={(e) => set('validateNumbers')(e.target.checked)} />
        <span>
          Verificar se os números têm WhatsApp antes de enviar
          <small className="muted">Números sem WhatsApp são ignorados — evita envios inúteis e reduz o risco de bloqueio.</small>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.linkPreview} onChange={(e) => set('linkPreview')(e.target.checked)} />
        <span>Gerar pré-visualização de links no texto</span>
      </label>

      {lowDelay && (
        <div className="callout warn small">
          Intervalos muito curtos aumentam bastante o risco de o WhatsApp restringir ou banir o número.
        </div>
      )}

      <div className="estimate">
        <Clock size={16} />
        <span>
          Tempo de envio estimado para {count.toLocaleString('pt-BR')} contatos: <strong>{formatDuration(seconds)}</strong>
          {finish && (
            <>
              {' '}
              · término previsto: <strong>{formatWhen(finish)}</strong>
            </>
          )}
        </span>
      </div>
    </>
  )
}
