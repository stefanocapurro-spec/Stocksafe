import { useState } from 'react'
import { useAuthStore }      from '../stores/authStore'
import { useLocationStore }  from '../stores/locationStore'
import { useInventoryStore } from '../stores/inventoryStore'
import { buildChecklist, exportXlsx, exportDocx } from '../lib/checklist'
import { ALL_ICONS } from './CategoriesPage'

const COLORS = [
  '#F59E0B','#EF4444','#10B981','#3B82F6','#8B5CF6',
  '#EC4899','#06B6D4','#84CC16','#F97316','#6366F1',
  '#14B8A6','#F43F5E','#A78BFA','#34D399','#60A5FA',
]

type ExportFormat = 'xlsx' | 'docx'

export function LocationsPage() {
  const { user }    = useAuthStore()
  const { locations, activeLocationId, fetchLocations,
          setActiveLocation, addLocation, updateLocation,
          deleteLocation, reorderLocation, error, clearError } = useLocationStore()
  const { items, categories } = useInventoryStore()

  const [showAdd, setShowAdd]         = useState(false)
  const [editId, setEditId]           = useState<string | null>(null)
  const [confirmDel, setConfirmDel]   = useState<string | null>(null)
  const [fname, setFname]             = useState('')
  const [ficon, setFicon]             = useState('📦')
  const [fcolor, setFcolor]           = useState('#F59E0B')
  const [fdesc, setFdesc]             = useState('')
  const [formErr, setFormErr]         = useState('')
  const [exporting, setExporting]     = useState<string | null>(null)   // locationId in export
  const [exportErr, setExportErr]     = useState('')

  const openAdd = () => {
    setFname(''); setFicon('📦'); setFcolor('#F59E0B'); setFdesc(''); setFormErr('')
    setEditId(null); setShowAdd(true)
  }
  const openEdit = (id: string) => {
    const loc = locations.find(l => l.id === id); if (!loc) return
    setFname(loc.name); setFicon(loc.icon); setFcolor(loc.color); setFdesc(loc.description); setFormErr('')
    setEditId(id); setShowAdd(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormErr('')
    if (!fname.trim()) { setFormErr('Il nome è obbligatorio.'); return }
    if (locations.some(l => l.name.toLowerCase() === fname.trim().toLowerCase() && l.id !== editId)) {
      setFormErr('Esiste già un deposito con questo nome.'); return
    }
    if (editId) {
      await updateLocation(editId, { name: fname.trim(), icon: ficon, color: fcolor, description: fdesc.trim() })
    } else {
      if (!user) return
      await addLocation(user.id, fname.trim(), ficon, fcolor, fdesc.trim())
    }
    setShowAdd(false)
  }

  const handleExport = async (locId: string, fmt: ExportFormat) => {
    const loc = locations.find(l => l.id === locId); if (!loc) return
    const locItems = items.filter(i => i.locationId === locId)
    if (locItems.length === 0) { setExportErr('Nessun articolo in questo deposito.'); return }
    setExporting(locId); setExportErr('')
    try {
      const data = buildChecklist(locItems, categories, loc)
      if (fmt === 'xlsx') await exportXlsx(data)
      else               await exportDocx(data)
    } catch (e) {
      setExportErr((e as Error).message)
    } finally {
      setExporting(null)
    }
  }

  const itemCount   = (id: string) => items.filter(i => i.locationId === id).length
  const totalValue  = (id: string) => items.filter(i => i.locationId === id).reduce((s,i) => s+(i.totalValue||0), 0)
  const fmtCurrency = (v: number)  => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(v)
  const expiring    = (id: string) => {
    const today = new Date().toISOString().slice(0,10)
    const n30   = new Date(); n30.setDate(n30.getDate()+30)
    return items.filter(i => i.locationId===id && i.expiryDate && i.expiryDate>=today && i.expiryDate<=n30.toISOString().slice(0,10)).length
  }

  return (
    <div className="page-container" style={{ paddingTop:24 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h2>Depositi</h2>
          <p style={{ fontSize:'0.78rem', marginTop:2 }}>{locations.length} depositi</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Nuovo</button>
      </div>

      {(error || exportErr) && (
        <div className="alert alert-error" style={{ marginBottom:14 }}>
          ⚠ {error || exportErr}
          <button onClick={() => { clearError(); setExportErr('') }}
            style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'inherit' }}>✕</button>
        </div>
      )}

      <div className="alert alert-info" style={{ marginBottom:16, fontSize:'0.82rem' }}>
        💡 Tocca un deposito per selezionarlo. Usa ↑↓ per riordinare.
      </div>

      {/* Form aggiunta/modifica */}
      {showAdd && (
        <div className="card fade-in" style={{ marginBottom:20, borderColor:'var(--accent-border)' }}>
          <h3 style={{ marginBottom:14, fontSize:'0.9rem' }}>{editId ? 'Modifica deposito' : 'Nuovo deposito'}</h3>
          {formErr && <div className="alert alert-error" style={{ marginBottom:12 }}>⚠ {formErr}</div>}
          <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:13 }}>
            <div className="field">
              <label>Nome *</label>
              <input type="text" className="input" value={fname} onChange={e=>setFname(e.target.value)}
                placeholder="Es. Cantina, Auto, Ufficio..." autoFocus/>
            </div>
            <div className="field">
              <label>Descrizione (opzionale)</label>
              <input type="text" className="input" value={fdesc} onChange={e=>setFdesc(e.target.value)}
                placeholder="Breve descrizione"/>
            </div>
            <div className="field">
              <label>Icona</label>
              <LocationIconPicker value={ficon} onChange={setFicon} />
            </div>
            <div className="field">
              <label>Colore</label>
              <LocationColorPicker value={fcolor} onChange={setFcolor} />
            </div>
            {/* Anteprima */}
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px',
              background:'var(--bg-base)', borderRadius:10, border:'1px solid var(--border)' }}>
              <span style={{ fontSize:'1.4rem' }}>{ficon}</span>
              <div>
                <div style={{ fontWeight:700, color:fcolor }}>{fname || 'Anteprima'}</div>
                {fdesc && <div style={{ fontSize:'0.76rem', color:'var(--text-muted)' }}>{fdesc}</div>}
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button type="button" className="btn btn-ghost" style={{ flex:1 }} onClick={() => setShowAdd(false)}>Annulla</button>
              <button type="submit" className="btn btn-primary" style={{ flex:2 }}>
                {editId ? 'Salva modifiche' : 'Crea deposito'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista depositi */}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {locations.map((loc, idx) => {
          const isActive   = loc.id === activeLocationId
          const count      = itemCount(loc.id)
          const value      = totalValue(loc.id)
          const exp        = expiring(loc.id)
          const isDeleting = confirmDel === loc.id
          const isExporting = exporting === loc.id

          return (
            <div key={loc.id}
              className={`card fade-in ${isActive ? 'card-accent' : ''}`}
              style={{ cursor:'pointer', transition:'all 0.18s',
                borderColor: isActive ? loc.color+'80' : 'var(--border)',
                boxShadow: isActive ? `0 0 16px ${loc.color}25` : 'none' }}
              onClick={() => setActiveLocation(loc.id)}>

              {/* Header riga */}
              <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                {/* Tasti riordino */}
                <div style={{ display:'flex', flexDirection:'column', gap:2, flexShrink:0 }}
                  onClick={e => e.stopPropagation()}>
                  <button
                    disabled={idx === 0}
                    onClick={() => reorderLocation(loc.id, 'up')}
                    style={{ background:'none', border:'none', cursor: idx===0?'default':'pointer',
                      color: idx===0?'var(--text-muted)':'var(--text-secondary)', fontSize:'0.9rem', lineHeight:1, padding:'2px 4px' }}
                    title="Sposta su">↑</button>
                  <button
                    disabled={idx === locations.length-1}
                    onClick={() => reorderLocation(loc.id, 'down')}
                    style={{ background:'none', border:'none', cursor: idx===locations.length-1?'default':'pointer',
                      color: idx===locations.length-1?'var(--text-muted)':'var(--text-secondary)', fontSize:'0.9rem', lineHeight:1, padding:'2px 4px' }}
                    title="Sposta giù">↓</button>
                </div>

                {/* Icona */}
                <div style={{ width:46, height:46, borderRadius:12, flexShrink:0,
                  background:`${loc.color}18`, border:`1px solid ${loc.color}30`,
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.3rem' }}>
                  {loc.icon}
                </div>

                {/* Info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontWeight:700, color: isActive ? loc.color : 'var(--text-primary)' }}>{loc.name}</span>
                    {isActive && <span className="badge" style={{ background:`${loc.color}20`, color:loc.color, border:`1px solid ${loc.color}40` }}>Attivo</span>}
                    {loc.isDefault && <span className="badge badge-muted">Default</span>}
                  </div>
                  {loc.description && <div style={{ fontSize:'0.74rem', color:'var(--text-muted)', marginTop:2 }}>{loc.description}</div>}
                </div>
              </div>

              {/* Stats */}
              <div style={{ display:'flex', gap:20, marginTop:12, paddingTop:10, borderTop:'1px solid var(--border)', flexWrap:'wrap' }}>
                <Stat label="Articoli" value={String(count)}          color="var(--text-primary)"/>
                <Stat label="Valore"   value={fmtCurrency(value)}     color="var(--green)"/>
                {exp > 0 && <Stat label="In scadenza" value={String(exp)} color="var(--accent)"/>}
              </div>

              {/* Azioni */}
              {!isDeleting ? (
                <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }} onClick={e=>e.stopPropagation()}>
                  <button className="btn btn-ghost btn-sm" style={{ flex:1 }} onClick={() => openEdit(loc.id)}>✏ Modifica</button>

                  {/* Export checklist */}
                  <div style={{ display:'flex', gap:4 }}>
                    <button className="btn btn-ghost btn-sm" disabled={isExporting || count===0}
                      title="Esporta checklist Excel"
                      onClick={() => handleExport(loc.id,'xlsx')}>
                      {isExporting ? <span className="spinner" style={{width:14,height:14}}/> : '📊 .xlsx'}
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={isExporting || count===0}
                      title="Esporta checklist Word"
                      onClick={() => handleExport(loc.id,'docx')}>
                      {isExporting ? <span className="spinner" style={{width:14,height:14}}/> : '📄 .docx'}
                    </button>
                  </div>

                  <button className="btn btn-danger btn-sm" disabled={locations.length<=1}
                    title={locations.length<=1?'Serve almeno un deposito':'Elimina'}
                    onClick={() => setConfirmDel(loc.id)}>🗑</button>
                </div>
              ) : (
                <div style={{ display:'flex', gap:8, marginTop:10, paddingTop:10,
                  borderTop:'1px solid rgba(239,68,68,.3)' }} onClick={e=>e.stopPropagation()}>
                  <span style={{ flex:1, fontSize:'0.82rem', color:'var(--red)', display:'flex', alignItems:'center' }}>
                    {count>0 ? `⚠ Elimina anche ${count} articoli?` : 'Eliminare il deposito?'}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(null)}>No</button>
                  <button className="btn btn-danger btn-sm" onClick={() => { deleteLocation(loc.id); setConfirmDel(null) }}>Sì</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ height:24 }}/>
    </div>
  )
}

function Stat({ label, value, color }: { label:string; value:string; color:string }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
      <span style={{ fontSize:'0.66rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:700 }}>{label}</span>
      <span style={{ fontSize:'0.88rem', fontWeight:700, color, fontFamily:'var(--font-mono)' }}>{value}</span>
    </div>
  )
}

// ── Picker icona per depositi (usa ALL_ICONS + ricerca) ───────────────────────

function LocationIconPicker({ value, onChange }: { value: string; onChange: (ic: string) => void }) {
  const [search, setSearch] = useState('')
  const EMOJI_LABELS: Record<string, string> = {
    '🏠':'casa home','🎒':'zaino borsa','🚗':'auto macchina','🏕️':'campeggio',
    '🏢':'ufficio edificio','🏪':'negozio','🏫':'scuola','🏥':'ospedale',
    '⛺':'tenda campeggio','🛖':'capanna','🚢':'nave barca','✈️':'aereo viaggio',
    '🏔️':'montagna','🌊':'mare acqua','🔒':'lucchetto sicurezza','📦':'scatola',
    '🧰':'cassetta attrezzi','🗄️':'armadio schedario','💼':'valigetta ufficio','🎁':'regalo',
  }
  const getLabel = (ic: string) => EMOJI_LABELS[ic] ?? ic
  const filtered = search.trim()
    ? ALL_ICONS.filter(ic => getLabel(ic).toLowerCase().includes(search.toLowerCase()))
    : ALL_ICONS

  return (
    <div>
      <input
        type="text" className="input"
        style={{ marginBottom:8, fontSize:'0.82rem' }}
        placeholder="Cerca icona (es. casa, auto, ufficio…)"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div style={{
        display:'flex', flexWrap:'wrap', gap:5,
        maxHeight:160, overflowY:'auto',
        padding:4, borderRadius:8,
        background:'var(--bg-base)', border:'1px solid var(--border)',
      }}>
        {filtered.map(ic => (
          <button key={ic} type="button"
            style={{
              width:36, height:36, fontSize:'1.2rem', borderRadius:8, cursor:'pointer',
              background: value===ic ? 'var(--accent-glow)' : 'var(--bg-raised)',
              border:`1px solid ${value===ic ? 'var(--accent)' : 'var(--border)'}`,
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
            }}
            onClick={() => onChange(ic)}>{ic}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Picker colore per depositi (con colore custom) ────────────────────────────

function LocationColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
      {COLORS.map(c => (
        <button key={c} type="button"
          style={{
            width:28, height:28, borderRadius:'50%', background:c, cursor:'pointer',
            border:`2px solid ${value===c?'#fff':'transparent'}`,
            outline:value===c?`2px solid ${c}`:'none', outlineOffset:2, transition:'all 0.15s',
          }}
          onClick={() => onChange(c)}/>
      ))}
      <label title="Colore personalizzato" style={{ position:'relative', cursor:'pointer' }}>
        <div style={{
          width:28, height:28, borderRadius:'50%',
          background: COLORS.includes(value) ? 'var(--bg-raised)' : value,
          border:`2px solid ${!COLORS.includes(value)?'#fff':'var(--border)'}`,
          outline:!COLORS.includes(value)?`2px solid ${value}`:'none',
          outlineOffset:2, display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:'0.75rem', color:'var(--text-muted)',
        }}>
          {COLORS.includes(value) ? '🎨' : ''}
        </div>
        <input
          type="color" value={value} onChange={e => onChange(e.target.value)}
          style={{ position:'absolute', inset:0, opacity:0, width:'100%', height:'100%', cursor:'pointer' }}
        />
      </label>
    </div>
  )
}
