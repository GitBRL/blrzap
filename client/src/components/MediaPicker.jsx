import { useEffect, useRef } from 'react'
import { FileText, Image, Info, Mic, Music, Paperclip, RefreshCw, Video, X } from 'lucide-react'
import { formatBytes, uploadFile } from '../utils.js'

export const MEDIA_TYPES = [
  { value: 'image', label: 'Imagem', icon: Image, accept: 'image/*' },
  { value: 'video', label: 'Vídeo (MP4)', icon: Video, accept: 'video/mp4,video/*' },
  { value: 'document', label: 'Documento', icon: FileText, accept: '*/*' },
  { value: 'audio', label: 'Áudio', icon: Music, accept: 'audio/*' },
  { value: 'ptt', label: 'Mensagem de voz', icon: Mic, accept: 'audio/*' },
]

// Mesmos limites do servidor (o servidor confere de novo)
const DEFAULT_LIMITS_MB = { video: 512, document: 512, image: 32, audio: 32, ptt: 32 }

export const EMPTY_MEDIA = { mode: 'none', type: 'image', url: '', file: null, uploadId: null, upload: null }

function guessType(mimetype = '') {
  if (mimetype.startsWith('image/')) return 'image'
  if (mimetype.startsWith('video/')) return 'video'
  if (mimetype.startsWith('audio/')) return 'audio'
  return 'document'
}

/** Problema que impede usar a mídia agora (upload em andamento ou com erro). */
export function mediaProblem(media) {
  if (media.mode !== 'file' || !media.file) return null
  if (media.upload?.status === 'uploading') return `Aguarde o envio do arquivo (${Math.round(media.upload.progress * 100)}%).`
  if (media.upload?.status === 'error') return 'O envio do arquivo falhou. Tente de novo ou escolha outro arquivo.'
  if (!media.uploadId) return 'Aguarde o envio do arquivo.'
  return null
}

export default function MediaPicker({ media, setMedia, allowAudio = true, server }) {
  const inputRef = useRef(null)
  const types = allowAudio ? MEDIA_TYPES : MEDIA_TYPES.filter((t) => t.value !== 'audio' && t.value !== 'ptt')
  const typeInfo = types.find((t) => t.value === media.type) || types[0]
  const limits = server?.limitsMB || DEFAULT_LIMITS_MB
  const inlineLimit = server && !server.publicMedia ? server.inlineLimitMB : null

  // Libera a URL temporária da miniatura
  useEffect(() => () => media.previewUrl && URL.revokeObjectURL(media.previewUrl), [media.previewUrl])

  /** Envia o arquivo em partes e acompanha o progresso (ignora se o arquivo foi trocado no meio). */
  const startUpload = (file, type) => {
    const update = (patch) => setMedia((m) => (m.file === file ? { ...m, ...patch } : m))
    update({ uploadId: null, upload: { status: 'uploading', progress: 0 } })
    uploadFile(file, type, (progress) => update({ upload: { status: 'uploading', progress } }))
      .then((uploadId) => update({ uploadId, upload: { status: 'done', progress: 1 } }))
      .catch((err) => update({ upload: { status: 'error', progress: 0, error: err.message } }))
  }

  const pickFile = (file) => {
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    const guessed = guessType(file.type)
    if (!allowAudio && guessed === 'audio') {
      alert('Mensagens com botões aceitam imagem, vídeo ou documento.')
      return
    }
    const type = media.type === 'ptt' && guessed === 'audio' ? 'ptt' : guessed
    const limitMB = limits[type] || limits.document
    if (file.size > limitMB * 1024 * 1024) {
      alert(`Arquivo de ${formatBytes(file.size)}: o limite para ${typeInfo.label.toLowerCase()} é ${limitMB} MB.`)
      return
    }
    if (inlineLimit && file.size > inlineLimit * 1024 * 1024) {
      alert(
        `Arquivos acima de ${inlineLimit} MB só podem ser enviados com o painel publicado num endereço público (ex.: Railway), ` +
          'para a uazapi baixar o arquivo. Use um arquivo menor ou a opção Link (URL).',
      )
      return
    }
    setMedia((m) => ({
      ...m,
      mode: 'file',
      type,
      file,
      uploadId: null,
      upload: { status: 'uploading', progress: 0 },
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }))
    startUpload(file, type)
  }

  const upload = media.upload
  const separateMedia = !allowAudio && (media.type === 'video' || media.type === 'document') && server?.version && !server.buttonMedia

  return (
    <div className="media-picker">
      <div className="segmented" role="radiogroup" aria-label="Anexo">
        {[
          ['none', allowAudio ? 'Sem anexo' : 'Sem mídia'],
          ['file', 'Enviar arquivo'],
          ['url', 'Link (URL)'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={media.mode === mode}
            className={media.mode === mode ? 'active' : ''}
            onClick={() => setMedia({ ...media, mode })}
          >
            {label}
          </button>
        ))}
      </div>

      {media.mode !== 'none' && (
        <>
          <label className="field">
            <span>Tipo de mídia</span>
            <select value={media.type} onChange={(e) => setMedia({ ...media, type: e.target.value })}>
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {media.mode === 'url' ? (
            <label className="field">
              <span>URL pública do arquivo</span>
              <input
                type="url"
                placeholder="https://exemplo.com/arquivo.mp4"
                value={media.url}
                onChange={(e) => setMedia({ ...media, url: e.target.value })}
              />
              <small className="muted">O servidor da uazapi precisa conseguir baixar esse endereço.</small>
            </label>
          ) : media.file ? (
            <div className={`file-chip ${upload?.status === 'error' ? 'error' : ''}`}>
              {media.previewUrl ? <img src={media.previewUrl} alt="" className="thumb" /> : <typeInfo.icon size={20} />}
              <div className="file-chip-text">
                <strong>{media.file.name}</strong>
                {upload?.status === 'uploading' ? (
                  <>
                    <span className="muted small">
                      Enviando… {Math.round(upload.progress * 100)}% ({formatBytes(media.file.size * upload.progress)} de{' '}
                      {formatBytes(media.file.size)})
                    </span>
                    <span className="upload-bar">
                      <span style={{ width: `${Math.max(2, upload.progress * 100)}%` }} />
                    </span>
                  </>
                ) : upload?.status === 'error' ? (
                  <span className="small text-bad">{upload.error}</span>
                ) : (
                  <span className="muted small">{formatBytes(media.file.size)} · enviado</span>
                )}
              </div>
              {upload?.status === 'error' && (
                <button type="button" className="btn small" onClick={() => startUpload(media.file, media.type)}>
                  <RefreshCw size={14} /> Tentar de novo
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label="Remover arquivo"
                onClick={() => setMedia({ ...media, file: null, uploadId: null, upload: null, previewUrl: null })}
              >
                <X size={18} />
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
              <Paperclip size={16} /> Escolher arquivo
            </button>
          )}
          <input ref={inputRef} type="file" hidden accept={typeInfo.accept} onChange={(e) => pickFile(e.target.files?.[0])} />

          {separateMedia && (
            <div className="callout info small">
              <Info size={16} />
              <span>
                Sua uazapi está na versão {server.version}, que não mostra vídeo nem documento no topo de botões. O arquivo será
                enviado numa mensagem logo antes da mensagem com botões. Na versão 2.6 ou superior ele aparece no topo.
              </span>
            </div>
          )}

          <p className="muted small">
            {media.type === 'audio' || media.type === 'ptt'
              ? 'Áudios não têm legenda: o texto da mensagem não será exibido.'
              : allowAudio
                ? 'O texto da mensagem será enviado como legenda do arquivo.'
                : separateMedia
                  ? 'O texto vai na mensagem com botões, logo depois do arquivo.'
                  : 'A mídia aparece no topo da mensagem com botões.'}{' '}
            Vídeos e documentos até {limits.video} MB; imagens e áudios até {limits.image} MB
            {inlineLimit ? ` (até ${inlineLimit} MB enquanto o painel não tiver endereço público)` : ''}.
          </p>
        </>
      )}
    </div>
  )
}
