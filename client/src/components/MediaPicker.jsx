import { useEffect, useRef } from 'react'
import { FileText, Image, Mic, Music, Paperclip, Video, X } from 'lucide-react'

export const MEDIA_TYPES = [
  { value: 'image', label: 'Imagem', icon: Image, accept: 'image/*' },
  { value: 'video', label: 'Vídeo (MP4)', icon: Video, accept: 'video/mp4,video/*' },
  { value: 'document', label: 'Documento', icon: FileText, accept: '*/*' },
  { value: 'audio', label: 'Áudio', icon: Music, accept: 'audio/*' },
  { value: 'ptt', label: 'Mensagem de voz', icon: Mic, accept: 'audio/*' },
]

const MAX_FILE_MB = 45

export const EMPTY_MEDIA = { mode: 'none', type: 'image', url: '', file: null, uploadId: null }

function guessType(mimetype = '') {
  if (mimetype.startsWith('image/')) return 'image'
  if (mimetype.startsWith('video/')) return 'video'
  if (mimetype.startsWith('audio/')) return 'audio'
  return 'document'
}

const formatSize = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`)

export default function MediaPicker({ media, setMedia, allowAudio = true }) {
  const inputRef = useRef(null)
  const types = allowAudio ? MEDIA_TYPES : MEDIA_TYPES.filter((t) => t.value !== 'audio' && t.value !== 'ptt')
  const typeInfo = types.find((t) => t.value === media.type) || types[0]

  // Libera a URL temporária da miniatura
  useEffect(() => () => media.previewUrl && URL.revokeObjectURL(media.previewUrl), [media.previewUrl])

  const pickFile = (file) => {
    if (!file) return
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      alert(`Arquivo muito grande. Use até ${MAX_FILE_MB} MB ou informe uma URL pública.`)
      return
    }
    const type = guessType(file.type)
    if (!allowAudio && type === 'audio') {
      alert('Mensagens com botões aceitam imagem, vídeo ou documento.')
      return
    }
    setMedia({
      ...media,
      mode: 'file',
      type: media.type === 'ptt' && type === 'audio' ? 'ptt' : type,
      file,
      uploadId: null,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    })
  }

  return (
    <div className="media-picker">
      <div className="segmented" role="radiogroup" aria-label="Anexo">
        {[
          ['none', allowAudio ? 'Sem anexo' : 'Sem imagem'],
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
                placeholder="https://exemplo.com/arquivo.jpg"
                value={media.url}
                onChange={(e) => setMedia({ ...media, url: e.target.value })}
              />
              <small className="muted">O servidor da uazapi precisa conseguir baixar esse endereço.</small>
            </label>
          ) : media.file ? (
            <div className="file-chip">
              {media.previewUrl ? <img src={media.previewUrl} alt="" className="thumb" /> : <typeInfo.icon size={20} />}
              <div className="file-chip-text">
                <strong>{media.file.name}</strong>
                <span className="muted small">{formatSize(media.file.size)}</span>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Remover arquivo"
                onClick={() => setMedia({ ...media, file: null, uploadId: null, previewUrl: null })}
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

          <p className="muted small">
            {media.type === 'audio' || media.type === 'ptt'
              ? 'Áudios não têm legenda: o texto da mensagem não será exibido.'
              : 'O texto da mensagem será enviado como legenda do arquivo.'}
          </p>
        </>
      )}
    </div>
  )
}
