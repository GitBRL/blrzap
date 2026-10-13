// Templates de workflow: um JSON por workflow em data/workflows.
//
// Salvar aceita rascunho com problemas (o canvas é montado aos poucos); só a campanha
// exige um workflow sem problemas, e guarda uma CÓPIA dele.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR } from './env.js'
import { ValidationError } from './errors.js'
import { cleanWorkflow, legacyFlowToWorkflow, startNode, workflowProblems, workflowWarnings } from '../shared/workflow.js'

const DIR = path.join(DATA_DIR, 'workflows')
const SEED_MARK = path.join(DIR, '.seeded')
fs.mkdirSync(DIR, { recursive: true })

const workflows = new Map()
const fileOf = (id) => path.join(DIR, `${id}.json`)
const ID_RE = /^[0-9a-f-]{36}$/

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, file)
}

function persist(wf) {
  writeAtomic(fileOf(wf.id), JSON.stringify(wf, null, 2))
}

/** Lê os workflows do disco. Na primeira vez, cria o template do fluxo de qualificação. */
export function loadWorkflows() {
  for (const name of fs.readdirSync(DIR)) {
    if (!name.endsWith('.json')) continue
    try {
      const wf = JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'))
      if (ID_RE.test(wf.id)) workflows.set(wf.id, wf)
    } catch (err) {
      console.error(`Não foi possível ler o workflow ${name}:`, err.message)
    }
  }
  if (!fs.existsSync(SEED_MARK)) {
    if (!workflows.size) createWorkflow(legacyFlowToWorkflow())
    fs.writeFileSync(SEED_MARK, new Date().toISOString())
  }
  return workflows.size
}

/** O que a lista mostra (sem o grafo inteiro). */
export function workflowSummary(wf) {
  const start = startNode(wf)
  return {
    id: wf.id,
    name: wf.name,
    description: wf.description,
    createdAt: wf.createdAt,
    updatedAt: wf.updatedAt,
    blocks: wf.nodes.length,
    startChoices: (start?.data.choices || []).map((c) => c.label),
    problems: workflowProblems(wf),
    warnings: workflowWarnings(wf),
  }
}

export const listWorkflows = () => [...workflows.values()].sort((a, b) => b.updatedAt - a.updatedAt)

export function getWorkflow(id) {
  const wf = workflows.get(String(id || ''))
  if (!wf) throw Object.assign(new Error('Workflow não encontrado.'), { status: 404 })
  return wf
}

function prepare(input) {
  const wf = cleanWorkflow(input)
  if (!wf.name) wf.name = 'Workflow sem nome'
  if (!wf.nodes.some((n) => n.type === 'start')) throw new ValidationError('O workflow precisa do bloco de disparo.')
  return wf
}

export function createWorkflow(input) {
  const now = Date.now()
  const wf = { id: crypto.randomUUID(), ...prepare(input), createdAt: now, updatedAt: now }
  workflows.set(wf.id, wf)
  persist(wf)
  return wf
}

export function updateWorkflow(id, input) {
  const current = getWorkflow(id)
  const wf = { ...current, ...prepare(input), id: current.id, createdAt: current.createdAt, updatedAt: Date.now() }
  workflows.set(wf.id, wf)
  persist(wf)
  return wf
}

export function duplicateWorkflow(id) {
  const source = getWorkflow(id)
  return createWorkflow({ ...structuredClone(source), name: `${source.name} (cópia)`.slice(0, 80) })
}

export function deleteWorkflow(id) {
  const wf = getWorkflow(id)
  workflows.delete(wf.id)
  fs.rmSync(fileOf(wf.id), { force: true })
}

/**
 * A cópia que a campanha guarda. Recusa workflow com problemas: a campanha não pode
 * começar com um caminho quebrado.
 */
export function snapshotForCampaign(id, key) {
  const wf = getWorkflow(id)
  const problems = workflowProblems(wf)
  if (problems.length) {
    throw new ValidationError(`O workflow “${wf.name}” tem ${problems.length === 1 ? 'um problema' : `${problems.length} problemas`}: ${problems.slice(0, 3).join(' ')}`)
  }
  const { nodes, edges, name } = structuredClone(wf)
  return { id: wf.id, name, key, nodes, edges }
}
