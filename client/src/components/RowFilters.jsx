import { Filter, Plus, Trash2 } from 'lucide-react'
import { OPERATORS, parseNumber } from '@shared/filters.js'
import { formatNumber } from '../utils.js'

const OPS = Object.fromEntries(OPERATORS.map((o) => [o.value, o]))

export default function RowFilters({ headers, filters, setFilters, kept, total }) {
  const rules = filters.rules

  const update = (i, patch) => setFilters({ ...filters, rules: rules.map((r, k) => (k === i ? { ...r, ...patch } : r)) })
  const remove = (i) => setFilters({ ...filters, rules: rules.filter((_, k) => k !== i) })
  const add = () => setFilters({ ...filters, rules: [...rules, { column: headers[0] || '', op: 'gt', value: '' }] })

  return (
    <div className="filters">
      <div className="filters-head">
        <span className="filters-title">
          <Filter size={15} /> Filtrar contatos
        </span>
        <button type="button" className="btn small" onClick={add}>
          <Plus size={14} /> Adicionar filtro
        </button>
      </div>

      {rules.length === 0 && (
        <p className="muted small">Opcional. Ex.: enviar só para quem tem <em>faturamento maior que 80 mil</em>.</p>
      )}

      {rules.map((rule, i) => {
        const op = OPS[rule.op]
        const parsed = op?.numeric && String(rule.value).trim() ? parseNumber(rule.value) : null
        return (
          <div className="filter-rule" key={i}>
            <select value={rule.column} onChange={(e) => update(i, { column: e.target.value })} aria-label="Coluna">
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <select value={rule.op} onChange={(e) => update(i, { op: e.target.value })} aria-label="Condição">
              {OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {!op?.noValue ? (
              <div className="filter-value">
                <input
                  value={rule.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder={op?.numeric ? 'Ex.: 80 mil' : 'Valor'}
                  aria-label="Valor"
                />
                {op?.numeric && String(rule.value).trim() && (
                  <small className={parsed === null ? 'text-bad' : 'muted'}>
                    {parsed === null ? 'Valor não reconhecido como número' : `= ${parsed.toLocaleString('pt-BR')}`}
                  </small>
                )}
              </div>
            ) : (
              <span />
            )}
            <button type="button" className="icon-btn" onClick={() => remove(i)} aria-label="Remover filtro">
              <Trash2 size={16} />
            </button>
          </div>
        )
      })}

      {rules.length > 1 && (
        <div className="segmented small-seg" role="radiogroup" aria-label="Combinação dos filtros">
          {[
            ['all', 'Atende a todos'],
            ['any', 'Atende a qualquer um'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filters.match === value}
              className={filters.match === value ? 'active' : ''}
              onClick={() => setFilters({ ...filters, match: value })}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {rules.length > 0 && (
        <p className="filters-result">
          <strong>{formatNumber(kept)}</strong> de {formatNumber(total)} linhas atendem ao filtro
        </p>
      )}
    </div>
  )
}
