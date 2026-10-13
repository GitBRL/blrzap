import { useMemo, useRef, useState } from 'react'
import { LoaderCircle, Upload, X } from 'lucide-react'
import { autoMapColumns, formatDateBR, formatMoney, isPaidStatus, parseDateKey, TITLE_FIELDS } from '@shared/dunning.js'
import { parseNumber } from '@shared/filters.js'
import { normalizePhone } from '@shared/phone.js'
import { api } from '../../api.js'
import { formatNumber, readCsvFile } from '../../utils.js'

const PREVIEW = 6

/** Importa títulos de um CSV: escolha das colunas, prévia já interpretada e resultado. */
export default function ImportTitulos({ onClose, onDone }) {
  const inputRef = useRef(null)
  const [csv, setCsv] = useState(null)
  const [mapping, setMapping] = useState({})
  const [countryCode, setCountryCode] = useState('55')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const pick = async (file) => {
    if (!file) return
    setError('')
    try {
      const data = await readCsvFile(file)
      setCsv({ fileName: file.name, ...data })
      setMapping(autoMapColumns(data.headers))
    } catch (err) {
      setError(err.message)
    }
  }

  // Interpreta as linhas como o servidor fará, para mostrar problemas antes de importar
  const parsed = useMemo(() => {
    if (!csv) return []
    const get = (row, key) => (mapping[key] ? String(row[mapping[key]] ?? '').trim() : '')
    return csv.rows.map((row) => {
      const p = {
        nome: get(row, 'nome'),
        telefone: normalizePhone(get(row, 'telefone'), countryCode),
        vencimento: parseDateKey(get(row, 'vencimento')),
        valor: parseNumber(get(row, 'valor')),
        email: get(row, 'email'),
        paid: Boolean(mapping.status) && isPaidStatus(get(row, 'status')),
      }
      p.problems = [!p.nome && 'sem nome', !p.telefone && 'telefone inválido', !p.vencimento && 'vencimento inválido', p.valor === null && 'sem valor'].filter(Boolean)
      return p
    })
  }, [csv, mapping, countryCode])

  const invalid = parsed.filter((p) => p.problems.length).length
  const missingRequired = TITLE_FIELDS.filter((f) => f.required && !mapping[f.key])

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api.importTitulos({ rows: csv.rows, mapping, countryCode })
      setResult(r)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-head">
          <h2 id="import-title">Importar títulos</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        {result ? (
          <>
            <div className="stats">
              <div className="stat tone-ok">
                <span className="stat-value">{formatNumber(result.created)}</span>
                <span className="stat-label">novos</span>
              </div>
              <div className="stat tone-info">
                <span className="stat-value">{formatNumber(result.updated)}</span>
                <span className="stat-label">atualizados</span>
              </div>
              <div className="stat tone-ok">
                <span className="stat-value">{formatNumber(result.paid)}</span>
                <span className="stat-label">baixados como pagos</span>
              </div>
              <div className="stat tone-bad">
                <span className="stat-value">{formatNumber(result.errors.length)}</span>
                <span className="stat-label">linhas com erro</span>
              </div>
            </div>
            {result.restarted > 0 && (
              <p className="muted small">{result.restarted} títulos tiveram o vencimento alterado: a régua deles recomeçou.</p>
            )}
            {result.errors.length > 0 && (
              <ul className="problems">
                {result.errors.slice(0, 10).map((e) => (
                  <li key={e.line}>
                    Linha {e.line}: {e.error}
                  </li>
                ))}
                {result.errors.length > 10 && <li>… e mais {result.errors.length - 10}</li>}
              </ul>
            )}
            <p className="muted small">
              Os títulos entram na régua na próxima execução (ou clique em <strong>Executar agora</strong>). Títulos já vencidos recebem
              só a etapa atual.
            </p>
            <div className="modal-actions">
              <button className="btn primary" onClick={onClose}>
                Concluir
              </button>
            </div>
          </>
        ) : !csv ? (
          <>
            <div
              className="dropzone"
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                pick(e.dataTransfer.files?.[0])
              }}
            >
              <Upload size={28} />
              <strong>Arraste o CSV dos títulos ou clique para selecionar</strong>
              <span className="muted small">Uma linha por título. Reimportar atualiza os existentes (pelo número do título).</span>
              <input ref={inputRef} type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => pick(e.target.files?.[0])} />
            </div>
            {error && <div className="callout bad">{error}</div>}
            <a className="link small" href="/exemplo-titulos.csv" download>
              Baixar CSV de exemplo
            </a>
          </>
        ) : (
          <>
            <p className="muted small">
              <strong>{csv.fileName}</strong> · {formatNumber(csv.rows.length)} linhas. Confira de qual coluna vem cada informação:
            </p>
            <div className="mapping-grid">
              {TITLE_FIELDS.map((f) => (
                <label className="field" key={f.key}>
                  <span>
                    {f.label}
                    {f.required && <span className="text-bad"> *</span>}
                  </span>
                  <select value={mapping[f.key] || ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}>
                    <option value="">{f.required ? 'Escolha a coluna' : 'Não usar'}</option>
                    {csv.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="field">
                <span>DDI padrão</span>
                <input value={countryCode} onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" />
              </label>
            </div>

            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Telefone</th>
                    <th>Vencimento</th>
                    <th>Valor</th>
                    <th>E-mail</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, PREVIEW).map((p, i) => (
                    <tr key={i} className={p.problems.length ? 'row-bad' : ''}>
                      <td>{p.nome || '—'}</td>
                      <td>{p.telefone || <span className="text-bad">inválido</span>}</td>
                      <td>{p.vencimento ? formatDateBR(p.vencimento) : <span className="text-bad">inválido</span>}</td>
                      <td>{p.valor !== null ? formatMoney(p.valor) : <span className="text-bad">—</span>}</td>
                      <td>{p.email || <span className="muted">—</span>}</td>
                      <td>{p.paid ? 'pago' : 'em aberto'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {invalid > 0 && (
              <div className="callout warn small">
                {formatNumber(invalid)} {invalid === 1 ? 'linha tem problema e será ignorada' : 'linhas têm problema e serão ignoradas'} (
                {[...new Set(parsed.flatMap((p) => p.problems))].join(', ')}).
              </div>
            )}
            {error && <div className="callout bad">{error}</div>}

            <div className="modal-actions">
              <button className="btn" onClick={() => setCsv(null)}>
                Trocar arquivo
              </button>
              <button className="btn primary" onClick={submit} disabled={busy || missingRequired.length > 0 || invalid === parsed.length}>
                {busy && <LoaderCircle size={16} className="spin" />} Importar {formatNumber(parsed.length - invalid)} títulos
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
