import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { readContactsFile, formatNumber } from '../utils.js'
import RowFilters from './RowFilters.jsx'

const PREVIEW_ROWS = 5

export default function CsvImport({
  csv,
  onLoad,
  onClear,
  phoneColumn,
  setPhoneColumn,
  countryCode,
  setCountryCode,
  stats,
  filters,
  setFilters,
  filteredRows,
}) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    setLoading(true)
    try {
      const parsed = await readContactsFile(file)
      onLoad({ fileName: file.name, ...parsed })
    } catch (err) {
      setError(err.message || 'Não foi possível ler o arquivo.')
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  if (!csv) {
    return (
      <>
        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        >
          <Upload size={28} />
          <strong>{loading ? 'Lendo arquivo…' : 'Arraste o CSV ou a planilha (XLS, XLSX) aqui ou clique para selecionar'}</strong>
          <span className="muted small">CSV separado por vírgula ou ponto e vírgula, ou planilha do Excel, com cabeçalho na primeira linha</span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,.txt,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
        {error && <div className="callout bad">{error}</div>}
        <a className="link small" href="/exemplo-contatos.csv" download>
          <Download size={14} /> Baixar CSV de exemplo
        </a>
      </>
    )
  }

  const previewRows = filteredRows.slice(0, PREVIEW_ROWS)

  return (
    <>
      <div className="file-chip">
        <FileSpreadsheet size={20} />
        <div className="file-chip-text">
          <strong>{csv.fileName}</strong>
          <span className="muted small">
            {formatNumber(csv.rows.length)} linhas · {csv.headers.length} colunas
            {csv.sheet && csv.sheets?.length === 1 ? ` · aba ${csv.sheet}` : ''}
          </span>
        </div>
        {csv.sheets?.length > 1 && (
          <select
            className="sheet-pick"
            value={csv.sheet}
            onChange={(e) => {
              const sh = csv.sheets.find((x) => x.name === e.target.value)
              if (sh) onLoad({ ...csv, headers: sh.headers, rows: sh.rows, sheet: sh.name })
            }}
            aria-label="Aba da planilha"
            title="Aba da planilha"
          >
            {csv.sheets.map((sh) => (
              <option key={sh.name} value={sh.name}>
                Aba: {sh.name} ({formatNumber(sh.rows.length)})
              </option>
            ))}
          </select>
        )}
        <button className="icon-btn" onClick={onClear} title="Remover arquivo" aria-label="Remover arquivo">
          <X size={18} />
        </button>
      </div>

      <div className="grid-2">
        <label className="field">
          <span>Coluna do telefone</span>
          <select value={phoneColumn} onChange={(e) => setPhoneColumn(e.target.value)}>
            {csv.headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>DDI padrão</span>
          <input
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="55"
            inputMode="numeric"
          />
          <small className="muted">Adicionado aos números sem código do país</small>
        </label>
      </div>

      <RowFilters headers={csv.headers} filters={filters} setFilters={setFilters} kept={filteredRows.length} total={csv.rows.length} />

      <div className="stat-row">
        <span className="chip ok">{formatNumber(stats.valid)} válidos</span>
        {stats.invalid > 0 && <span className="chip bad">{formatNumber(stats.invalid)} inválidos</span>}
        {stats.duplicates > 0 && <span className="chip warn">{formatNumber(stats.duplicates)} duplicados</span>}
      </div>

      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              {csv.headers.map((h) => (
                <th key={h} className={h === phoneColumn ? 'hl' : ''}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, i) => (
              <tr key={i}>
                {csv.headers.map((h) => (
                  <td key={h} className={h === phoneColumn ? 'hl' : ''}>
                    {row[h]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filteredRows.length > PREVIEW_ROWS && (
        <p className="muted small">
          Mostrando {PREVIEW_ROWS} de {formatNumber(filteredRows.length)} linhas{filteredRows.length < csv.rows.length ? ' filtradas' : ''}.
        </p>
      )}
    </>
  )
}
