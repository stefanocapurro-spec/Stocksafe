import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useInventoryStore, type ItemDecrypted } from '../stores/inventoryStore'
import { useLocationStore }  from '../stores/locationStore'

type SortField   = 'name' | 'expiry' | 'value' | 'date' | 'quantity'
type ExpiryFilter = 'all' | 'expired' | 'week' | 'month' | 'ok' | 'nodate' | 'noloc'

export function InventoryPage() {
  const { items, categories, deleteItem, loading } = useInventoryStore()
  const { locations, activeLocationId }            = useLocationStore()

  const [search,       setSearch]       = useState('')
  const [catFilter,    setCatFilter]    = useState('all')
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all')
  const [sortBy,       setSortBy]       = useState<SortField>('name')
  const [sortAsc,      setSortAsc]      = useState(true)
  const [confirmDel,   setConfirmDel]   = useState<string | null>(null)

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const in7   = useMemo(() => { const d = new Date(); d.setDate(d.getDate()+7);  return d.toISOString().slice(0,10) }, [])
  const in30  = useMemo(() => { const d = new Date(); d.setDate(d.getDate()+30); return d.toISOString().slice(0,10) }, [])

  // Filtra prima per deposito attivo
  const locationItems = useMemo(() =>
    activeLocationId ? items.filter(i => i.locationId === activeLocationId) : items
  , [items, activeLocationId])

  const activeLoc = locations.find(l => l.id === activeLocationId)

  const filtered = useMemo(() => {
    let list = [...locationItems]
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.brand.toLowerCase().includes(q) ||
      i.barcode.includes(q) ||
      i.notes.toLowerCase().includes(q) ||
      categories.find(c => c.id === i.categoryId)?.name.toLowerCase().includes(q)
    )
    if (catFilter !== 'all') list = list.filter(i => i.categoryId === catFilter)
    switch (expiryFilter) {
      case 'expired': list = list.filter(i => i.expiryDate && i.expiryDate < today); break
      case 'week':    list = list.filter(i => i.expiryDate && i.expiryDate >= today && i.expiryDate <= in7); break
      case 'month':   list = list.filter(i => i.expiryDate && i.expiryDate > in7 && i.expiryDate <= in30); break
      case 'ok':      list = list.filter(i => i.expiryDate && i.expiryDate > in30); break
      case 'nodate':  list = list.filter(i => !i.expiryDate); break
      case 'noloc':   list = list.filter(i => !i.locationId); break
    }
    list.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name')     cmp = a.name.localeCompare(b.name)
      if (sortBy === 'expiry')   cmp = (a.expiryDate ?? 'z').localeCompare(b.expiryDate ?? 'z')
      if (sortBy === 'value')    cmp = a.totalValue - b.totalValue
      if (sortBy === 'date')     cmp = a.createdAt.localeCompare(b.createdAt)
      if (sortBy === 'quantity') cmp = a.quantity - b.quantity
      return sortAsc ? cmp : -cmp
    })
    return list
  }, [locationItems, search, catFilter, expiryFilter, sortBy, sortAsc, today, in7, in30, categories])

  const toggleSort = (f: SortField) => {
    if (sortBy === f) setSortAsc(a => !a); else { setSortBy(f); setSortAsc(true) }
  }

  const totalValue = filtered.reduce((s, i) => s + (i.totalValue || 0), 0)
  const fmt = (v: number) => new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR' }).format(v)

  const EXPIRY_BTNS: { key: ExpiryFilter; label: string; color?: string }[] = [
    { key:'all',     label:'Tutte' },
    { key:'expired', label:'🚨 Scaduti',       color:'var(--red)' },
    { key:'week',    label:'⚠️ <7gg',          color:'var(--accent)' },
    { key:'month',   label:'⏳ <30gg',         color:'var(--accent)' },
    { key:'ok',      label:'✅ OK',            color:'var(--green)' },
    { key:'nodate',  label:'— Senza data' },
    { key:'noloc',   label:'📍 Senza deposito', color:'var(--purple)' },
  ]

  return (
    <div className="page-container" style={{ paddingTop: 24 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <div>
          <h2 style={{ fontSize:'1.2rem' }}>
            {activeLoc ? `${activeLoc.icon} ${activeLoc.name}` : 'Scorte'}
          </h2>
          <p style={{ fontSize:'0.76rem', marginTop:2 }}>
            {filtered.length} articoli · {fmt(totalValue)}
          </p>
        </div>
        <Link to="/add" className="btn btn-primary btn-sm">+ Nuovo</Link>
      </div>

      {/* Ricerca */}
      <div style={{ position:'relative', marginBottom:10 }}>
        <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)',
          color:'var(--text-muted)', pointerEvents:'none' }}>🔍</span>
        <input type="search" className="input" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Cerca nome, marca, barcode, categoria..."
          style={{ paddingLeft:36 }}/>
      </div>

      {/* Filtri scadenza */}
      <div style={{ display:'flex', gap:6, marginBottom:8, overflowX:'auto', paddingBottom:2 }}>
        {EXPIRY_BTNS.map(f => (
          <button key={f.key}
            className={`btn btn-sm ${expiryFilter===f.key?'btn-primary':'btn-ghost'}`}
            style={{ flexShrink:0, ...(expiryFilter!==f.key && f.color ? { color:f.color, borderColor:f.color+'55' } : {}) }}
            onClick={() => setExpiryFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {/* Filtri categoria */}
      {categories.length > 0 && (
        <div style={{ display:'flex', gap:6, marginBottom:8, overflowX:'auto', paddingBottom:2 }}>
          <button className={`btn btn-sm ${catFilter==='all'?'btn-primary':'btn-ghost'}`}
            style={{ flexShrink:0 }} onClick={() => setCatFilter('all')}>Tutte categ.</button>
          {categories.map(c => (
            <button key={c.id}
              className={`btn btn-sm ${catFilter===c.id?'btn-primary':'btn-ghost'}`}
              style={{ flexShrink:0 }} onClick={() => setCatFilter(c.id)}>
              {c.icon} {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Ordinamento */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:14, overflowX:'auto' }}>
        <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', flexShrink:0 }}>Ordina:</span>
        {([['name','Nome'],['expiry','Scad.'],['value','Valore'],['quantity','Qtà'],['date','Data']] as [SortField,string][]).map(([f,l]) => (
          <button key={f}
            className={`btn btn-sm ${sortBy===f?'btn-primary':'btn-ghost'}`}
            style={{ flexShrink:0, fontSize:'0.7rem', padding:'4px 9px' }}
            onClick={() => toggleSort(f)}>
            {l}{sortBy===f?(sortAsc?'↑':'↓'):''}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign:'center', padding:'40px 0' }}><span className="spinner" style={{ width:28,height:28 }}/></div>}

      {!loading && filtered.length === 0 && (
        <div className="card" style={{ textAlign:'center', padding:'40px 24px' }}>
          <p style={{ fontSize:'2.5rem', marginBottom:12 }}>🔍</p>
          <h3>Nessun risultato</h3>
          <p style={{ marginTop:6 }}>
            {search||expiryFilter!=='all'||catFilter!=='all'
              ? 'Nessun articolo corrisponde ai filtri.'
              : 'Aggiungi il primo articolo con il pulsante +'}
          </p>
          {(search||expiryFilter!=='all'||catFilter!=='all') && (
            <button className="btn btn-ghost" style={{ marginTop:14 }}
              onClick={() => { setSearch(''); setExpiryFilter('all'); setCatFilter('all') }}>
              Rimuovi filtri
            </button>
          )}
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {filtered.map(item => (
          <ItemCard key={item.id} item={item} today={today}
            category={categories.find(c => c.id === item.categoryId)}
            confirmingDelete={confirmDel===item.id}
            onDelete={() => setConfirmDel(item.id)}
            onCancelDelete={() => setConfirmDel(null)}
            onConfirmDelete={async () => { await deleteItem(item.id); setConfirmDel(null) }}/>
        ))}
      </div>
      <div style={{ height:24 }}/>
    </div>
  )
}

function ItemCard({ item, today, category, confirmingDelete, onDelete, onCancelDelete, onConfirmDelete }: {
  item: ItemDecrypted; today: string
  category?: { icon:string; name:string; color:string }
  confirmingDelete:boolean; onDelete:()=>void; onCancelDelete:()=>void; onConfirmDelete:()=>void
}) {
  const isExpired = item.expiryDate ? item.expiryDate < today : false
  const daysLeft  = item.expiryDate
    ? Math.ceil((new Date(item.expiryDate).getTime() - Date.now()) / 86400000) : null
  const isUrgent  = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7
  const fmt = (v:number) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(v)

  return (
    <div className="card fade-in" style={{
      borderColor: isExpired?'rgba(239,68,68,.4)':isUrgent?'var(--accent-border)':'var(--border)' }}>
      <div style={{ display:'flex', gap:11, alignItems:'flex-start' }}>
        <div style={{ width:48,height:48,borderRadius:10,flexShrink:0,
          background:category?`${category.color}20`:'var(--bg-raised)',
          border:`1px solid ${category?category.color+'30':'var(--border)'}`,
          display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.2rem',
          overflow:'hidden' }}>
          {item.imageUrl
            ? <img src={item.imageUrl} alt="" loading="lazy"
                onError={e => { const t=e.target as HTMLImageElement; t.style.display='none'; if(t.nextSibling) (t.nextSibling as HTMLElement).style.display='flex' }}
                style={{ width:'100%',height:'100%',objectFit:'contain',padding:2 }}/>
            : null}
          <span style={{ display: item.imageUrl ? 'none' : 'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%' }}>
            {category?.icon??'📦'}
          </span>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginBottom:3 }}>
            <span style={{ fontWeight:700, fontSize:'0.9rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:200 }}>{item.name}</span>
            {isExpired  && <span className="badge badge-red">Scaduto</span>}
            {!isExpired && isUrgent && <span className="badge badge-accent">{daysLeft}gg</span>}
          </div>
          {item.brand && <div style={{ fontSize:'0.74rem', color:'var(--text-muted)', marginBottom:3 }}>{item.brand}</div>}
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, fontSize:'0.74rem', color:'var(--text-secondary)' }}>
            <span className="mono">{item.quantity} {item.unit}</span>
            {item.expiryDate && <span>Scade: <span className="mono">{item.expiryDate}</span></span>}
            {item.totalValue>0 && <span style={{ color:'var(--green)' }}>{fmt(item.totalValue)}</span>}
          </div>
          {item.barcode && <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', fontFamily:'var(--font-mono)', marginTop:3 }}>▧ {item.barcode}</div>}
        </div>
      </div>
      {!confirmingDelete ? (
        <div style={{ display:'flex', gap:8, marginTop:10, paddingTop:10, borderTop:'1px solid var(--border)' }}>
          <Link to={`/edit/${item.id}`} className="btn btn-ghost btn-sm" style={{ flex:1 }}>✏ Modifica</Link>
          <button className="btn btn-danger btn-sm" onClick={onDelete}>🗑</button>
        </div>
      ) : (
        <div style={{ display:'flex', gap:8, marginTop:10, paddingTop:10, borderTop:'1px solid rgba(239,68,68,.3)' }}>
          <span style={{ flex:1, fontSize:'0.8rem', color:'var(--red)', display:'flex', alignItems:'center' }}>Eliminare?</span>
          <button className="btn btn-ghost btn-sm" onClick={onCancelDelete}>No</button>
          <button className="btn btn-danger btn-sm" onClick={onConfirmDelete}>Sì</button>
        </div>
      )}
    </div>
  )
}
