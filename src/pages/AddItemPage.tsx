import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore }      from '../stores/authStore'
import { useInventoryStore, type ItemUnit } from '../stores/inventoryStore'
import { useLocationStore }  from '../stores/locationStore'
import { startScanner, stopScanner, lookupBarcode } from '../lib/barcode'
import { contributeBarcode, type CommunityContribution } from '../lib/communityDb'
import { calcRemindDate }    from '../lib/calendar'

const UNITS: ItemUnit[] = ['pz','g','kg','ml','l','cl','mg']
const UNIT_LABELS: Record<ItemUnit,string> = {
  pz:'pezzi', g:'grammi', kg:'chilogrammi', ml:'millilitri',
  l:'litri', cl:'centilitri', mg:'milligrammi',
}

function buildNavList(
  items: ReturnType<typeof useInventoryStore.getState>['items'],
  locationId: string | null
) {
  return [...items]
    .filter(i => locationId ? i.locationId === locationId : true)
    .sort((a,b) => a.name.localeCompare(b.name,'it',{sensitivity:'base'}))
    .map(i => i.id)
}

export function AddItemPage() {
  const { id }   = useParams<{ id?: string }>()
  const isEdit   = !!id
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { items, categories, addItem, updateItem, loading } = useInventoryStore()
  const { locations, activeLocationId } = useLocationStore()

  // ── Form state ───────────────────────────────────────────────────────────
  const [name, setName]             = useState('')
  const [barcode, setBarcode]       = useState('')
  const [brand, setBrand]           = useState('')
  const [notes, setNotes]           = useState('')
  const [quantity, setQuantity]     = useState('1')
  const [unit, setUnit]             = useState<ItemUnit>('pz')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [purchaseDate, setPurchaseDate]  = useState('')
  const [expiryDate, setExpiryDate]     = useState('')
  const [imageUrl, setImageUrl]     = useState('')
  const [weightValue, setWeightValue] = useState<number|null>(null)
  const [weightUnit, setWeightUnit]   = useState<string|null>(null)
  const [error, setError]   = useState('')
  const [saved, setSaved]   = useState(false)
  const [dirty, setDirty]   = useState(false)

  // ── Scanner state ────────────────────────────────────────────────────────
  const [scanning, setScanning]           = useState(false)
  const [barcodeLoading, setBarcodeLoading] = useState(false)
  const [barcodeInfo, setBarcodeInfo]     = useState('')
  const [barcodeSource, setBarcodeSource] = useState<string|null>(null)
  const videoRef    = useRef<HTMLVideoElement>(null)
  const stopScanRef = useRef<(()=>void)|null>(null)

  // ── Community contribute state ────────────────────────────────────────────
  const [showContribute, setShowContribute]     = useState(false)
  const [contributeStatus, setContributeStatus] = useState('')
  const [contributing, setContributing]         = useState(false)

  // ── Navigazione prev/next ────────────────────────────────────────────────
  const navList = buildNavList(items, activeLocationId)
  const navIdx  = id ? navList.indexOf(id) : -1
  const prevId  = navIdx > 0 ? navList[navIdx-1] : null
  const nextId  = navIdx >= 0 && navIdx < navList.length-1 ? navList[navIdx+1] : null
  const [pendingNav, setPendingNav]         = useState<string|null>(null)
  const [showSaveDialog, setShowSaveDialog] = useState(false)

  // ── Carica articolo esistente ────────────────────────────────────────────
  useEffect(() => {
    setDirty(false); setSaved(false); setError(''); setShowContribute(false)
    setBarcodeInfo(''); setBarcodeSource(null)
    if (isEdit && id) {
      const item = items.find(i => i.id === id)
      if (item) {
        setName(item.name); setBarcode(item.barcode); setBrand(item.brand)
        setNotes(item.notes); setQuantity(String(item.quantity)); setUnit(item.unit)
        setPurchasePrice(item.purchasePrice ? String(item.purchasePrice) : '')
        setCategoryId(item.categoryId ?? ''); setLocationId(item.locationId ?? '')
        setPurchaseDate(item.purchaseDate ?? ''); setExpiryDate(item.expiryDate ?? '')
        setImageUrl(item.imageUrl ?? '')
        setWeightValue(null); setWeightUnit(null)
      }
    } else {
      setName(''); setBarcode(''); setBrand(''); setNotes('')
      setQuantity('1'); setUnit('pz'); setPurchasePrice(''); setImageUrl('')
      setCategoryId(''); setLocationId(activeLocationId ?? '')
      setPurchaseDate(''); setExpiryDate('')
      setWeightValue(null); setWeightUnit(null)
    }
  }, [id, isEdit])

  const markDirty = () => setDirty(true)

  // ── Navigazione con controllo dirty ──────────────────────────────────────
  const requestNav = (targetId: string | null) => {
    if (!targetId) return
    if (dirty && isEdit) { setPendingNav(targetId); setShowSaveDialog(true) }
    else navigate(`/edit/${targetId}`)
  }

  const confirmNav = async (save: boolean) => {
    setShowSaveDialog(false)
    if (save && user && id) { try { await doSave() } catch { /* già gestito */ } }
    if (pendingNav) navigate(`/edit/${pendingNav}`)
    setPendingNav(null)
  }

  // ── Rilascia camera all'uscita ────────────────────────────────────────────
  useEffect(() => () => {
    stopScanRef.current?.()
    stopScanner()
  }, [])

  // ── Gestione risultato lookup ─────────────────────────────────────────────
  const applyLookupResult = useCallback((info: Awaited<ReturnType<typeof lookupBarcode>>) => {
    if (info.found) {
      if (!name  && info.name)  { setName(info.name);   markDirty() }
      if (!brand && info.brand) { setBrand(info.brand); markDirty() }
      if (info.weightValue && info.weightUnit) {
        setQuantity(String(info.weightValue))
        setUnit(info.weightUnit as ItemUnit)
        setWeightValue(info.weightValue)
        setWeightUnit(info.weightUnit)
        markDirty()
      }
      if (info.imageUrl) { setImageUrl(info.imageUrl); markDirty() }

      const sourceLabel: Record<string,string> = {
        off:       '🥫 Open Food Facts',
        obf:       '💄 Open Beauty Facts',
        opff:      '🐾 Open Pet Food Facts',
        opf:       '📦 Open Products Facts',
        upc:       '🏪 UPC Item DB',
        community: '👥 Database community',
      }
      const wLabel  = info.weightValue && info.weightUnit ? ` · ${info.weightValue} ${info.weightUnit}` : ''
      const srcLabel = info.source ? ` (${sourceLabel[info.source] ?? info.source})` : ''
      setBarcodeInfo(`✓ Trovato: ${info.name || 'Prodotto'}${wLabel}${srcLabel}`)
      setBarcodeSource(info.source ?? null)
      setShowContribute(false)
    } else {
      setBarcodeInfo('Prodotto non trovato in nessun database.')
      setBarcodeSource(null)
      setShowContribute(true)
    }
  }, [name, brand])

  // ── Avvio scanner ─────────────────────────────────────────────────────────
  const handleStartScan = async () => {
    setBarcodeInfo(''); setShowContribute(false)
    setScanning(true)
    setTimeout(async () => {
      if (!videoRef.current) { setScanning(false); return }
      const stop = await startScanner(
        videoRef.current,
        async (code) => {
          stop(); stopScanRef.current = null; setScanning(false)
          setBarcode(code); markDirty()
          setBarcodeLoading(true); setBarcodeInfo('🔍 Ricerca in corso...')
          const info = await lookupBarcode(code)
          setBarcodeLoading(false)
          applyLookupResult(info)
        },
        (err) => {
          setBarcodeInfo(`⚠️ ${err.message}`)
          setScanning(false)
        }
      )
      stopScanRef.current = stop
    }, 150)
  }

  const handleStopScan = () => {
    stopScanRef.current?.(); stopScanRef.current = null
    setScanning(false)
  }

  // ── Contribuisci al database community ───────────────────────────────────
  const handleContribute = async () => {
    if (!barcode.trim() || !name.trim()) {
      setContributeStatus('⚠️ Compila almeno il codice a barre e il nome prima di contribuire.')
      return
    }
    setContributing(true); setContributeStatus('')
    const uid = (user as unknown as { id?: string; $id?: string })?.id
           ?? (user as unknown as { id?: string; $id?: string })?.$id
           ?? ''
    const contribution: CommunityContribution = {
      name: name.trim(), brand: brand.trim(),
      category: '',      imageUrl: imageUrl.trim(),
      weightValue, weightUnit,
    }
    const result = await contributeBarcode(barcode.trim(), contribution, uid)
    setContributing(false)
    setContributeStatus(result.ok ? `✓ ${result.message}` : `⚠️ ${result.message}`)
    if (result.ok) setShowContribute(false)
  }

  // ── Salvataggio ───────────────────────────────────────────────────────────
  const doSave = useCallback(async () => {
    if (!user) throw new Error('Non autenticato')
    if (!name.trim()) throw new Error('Il nome è obbligatorio.')
    const qty = parseFloat(quantity)
    if (isNaN(qty) || qty <= 0) throw new Error('Quantità non valida.')
    const payload = {
      name: name.trim(), barcode: barcode.trim(), brand: brand.trim(), notes: notes.trim(),
      quantity: qty, unit,
      purchasePrice: purchasePrice ? parseFloat(purchasePrice) : undefined,
      categoryId: categoryId || null, locationId: locationId || null,
      purchaseDate: purchaseDate || null, expiryDate: expiryDate || null,
      imageUrl: imageUrl || null,
    }
    const uid = (user as unknown as { id?: string; $id?: string }).id
           ?? (user as unknown as { id?: string; $id?: string }).$id
           ?? ''
    if (isEdit && id) await updateItem(id, uid, payload)
    else await addItem(uid, payload)
    setDirty(false)
  }, [user, name, barcode, brand, notes, quantity, unit, purchasePrice,
      categoryId, locationId, purchaseDate, expiryDate, imageUrl, isEdit, id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('')
    try {
      await doSave()
      setSaved(true)
      if (!isEdit) setTimeout(() => navigate('/inventory'), 900)
    } catch (e) { setError((e as Error).message) }
  }

  const remindDate = expiryDate ? calcRemindDate(expiryDate) : null
  const totalValue = purchasePrice && quantity
    ? (parseFloat(purchasePrice) * parseFloat(quantity)).toFixed(2) : null

  return (
    <div className="page-container" style={{ paddingTop:20, paddingBottom:32 }}>

      {/* ── Dialog salva modifiche ── */}
      {showSaveDialog && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }}>
          <div className="card" style={{ maxWidth:360, width:'100%' }}>
            <h3 style={{ marginBottom:10 }}>💾 Modifiche non salvate</h3>
            <p style={{ fontSize:'0.87rem', marginBottom:20 }}>
              Hai modificato questo articolo senza salvare. Cosa vuoi fare?
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <button className="btn btn-primary" onClick={() => confirmNav(true)}>Salva e continua →</button>
              <button className="btn btn-ghost"   onClick={() => confirmNav(false)}>Ignora modifiche →</button>
              <button className="btn btn-ghost" style={{ color:'var(--text-muted)' }}
                onClick={() => { setShowSaveDialog(false); setPendingNav(null) }}>← Rimani qui</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>←</button>
        <h2 style={{ flex:1 }}>{isEdit ? 'Modifica' : 'Nuovo articolo'}</h2>
        {isEdit && (
          <div style={{ display:'flex', gap:6 }}>
            <button className="btn btn-ghost btn-sm" disabled={!prevId}
              onClick={() => requestNav(prevId)} style={{ opacity: prevId ? 1 : 0.3 }}>‹ Prec</button>
            {navIdx >= 0 && (
              <span style={{ fontSize:'0.72rem', color:'var(--text-muted)', display:'flex',
                alignItems:'center', padding:'0 4px', fontFamily:'var(--font-mono)' }}>
                {navIdx+1}/{navList.length}
              </span>
            )}
            <button className="btn btn-ghost btn-sm" disabled={!nextId}
              onClick={() => requestNav(nextId)} style={{ opacity: nextId ? 1 : 0.3 }}>Succ ›</button>
          </div>
        )}
      </div>

      {saved && <div className="alert alert-success" style={{ marginBottom:14 }}>✓ Salvato!</div>}
      {error && <div className="alert alert-error"   style={{ marginBottom:14 }}>⚠ {error}</div>}

      {/* ── Scanner ── */}
      <div className="card" style={{ marginBottom:18 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <h3 style={{ fontSize:'0.88rem' }}>📷 Codice a barre</h3>
          {!scanning
            ? <button className="btn btn-ghost btn-sm" onClick={handleStartScan}>Avvia scanner</button>
            : <button className="btn btn-danger btn-sm" onClick={handleStopScan}>Ferma</button>
          }
        </div>

        {scanning && (
          <div style={{ position:'relative', borderRadius:10, overflow:'hidden', background:'#000', marginBottom:8 }}>
            <video ref={videoRef} style={{ width:'100%', maxHeight:220, objectFit:'cover', display:'block' }}
              autoPlay muted playsInline />
            <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center',
              justifyContent:'center', pointerEvents:'none' }}>
              <div style={{ width:'72%', height:'38%', border:'2px solid var(--accent)',
                borderRadius:8, boxShadow:'0 0 0 9999px rgba(0,0,0,0.4)' }}/>
            </div>
          </div>
        )}

        {imageUrl && (
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
            <img src={imageUrl} alt="Prodotto"
              onError={e => { (e.target as HTMLImageElement).style.display='none' }}
              style={{ width:64, height:64, objectFit:'contain', borderRadius:8,
                background:'var(--bg-raised)', border:'1px solid var(--border)', padding:4 }}/>
            <div>
              <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginBottom:4 }}>
                📸 Immagine dal database
              </div>
              <button type="button" className="btn btn-ghost btn-sm"
                style={{ fontSize:'0.72rem', padding:'2px 8px' }}
                onClick={() => { setImageUrl(''); markDirty() }}>Rimuovi</button>
            </div>
          </div>
        )}

        {barcodeInfo && (
          <div className={`alert ${barcodeSource ? 'alert-success' : 'alert-warn'}`}
            style={{ fontSize:'0.8rem', padding:'7px 12px', marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
            {barcodeLoading && <span className="spinner" style={{ width:14, height:14 }}/>}
            <span>{barcodeInfo}</span>
          </div>
        )}

        {/* ── Contribuisci al database community ── */}
        {showContribute && barcode && (
          <div className="card" style={{
            marginTop:10, background:'rgba(245,158,11,0.06)',
            border:'1px solid rgba(245,158,11,0.25)' }}>
            <div style={{ fontSize:'0.82rem', fontWeight:600, marginBottom:8 }}>
              👥 Contribuisci al database condiviso
            </div>
            <p style={{ fontSize:'0.78rem', color:'var(--text-secondary)', lineHeight:1.6, marginBottom:12 }}>
              Questo codice a barre non è in nessun database pubblico.
              Se inserisci il prodotto manualmente, puoi condividerlo cifrato con tutti gli utenti
              di StockSafe: la prossima volta verrà riconosciuto automaticamente.
            </p>
            {contributeStatus && (
              <div className={`alert ${contributeStatus.startsWith('✓') ? 'alert-success' : 'alert-warn'}`}
                style={{ fontSize:'0.78rem', marginBottom:10 }}>
                {contributeStatus}
              </div>
            )}
            <div style={{ display:'flex', gap:8 }}>
              <button type="button" className="btn btn-primary btn-sm"
                style={{ flex:1 }} disabled={contributing || !name.trim()}
                onClick={handleContribute}>
                {contributing ? <span className="spinner" style={{ width:14, height:14 }}/> : '📤 Condividi con la community'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => setShowContribute(false)}>Non ora</button>
            </div>
            {!name.trim() && (
              <p style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:6 }}>
                Compila almeno il nome del prodotto per poter contribuire.
              </p>
            )}
          </div>
        )}

        <div className="field" style={{ marginTop:10 }}>
          <label>Codice manuale</label>
          <div className="input-group">
            <input type="text" className="input" value={barcode}
              onChange={e => { setBarcode(e.target.value); markDirty() }}
              placeholder="Es. 8001090148322" style={{ fontFamily:'var(--font-mono)' }}/>
            {barcode && (
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={async () => {
                  setBarcodeLoading(true); setBarcodeInfo('🔍 Ricerca in corso...')
                  setShowContribute(false); setContributeStatus('')
                  const info = await lookupBarcode(barcode)
                  setBarcodeLoading(false)
                  applyLookupResult(info)
                }}>Cerca</button>
            )}
          </div>
        </div>
      </div>

      {/* ── Form principale ── */}
      <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:16 }}>

        <div className="card">
          <h3 style={{ fontSize:'0.8rem', color:'var(--text-muted)', textTransform:'uppercase',
            letterSpacing:'0.07em', marginBottom:13 }}>📦 Prodotto</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div className="field">
              <label>Nome *</label>
              <input type="text" className="input" value={name}
                onChange={e => { setName(e.target.value); markDirty() }} required/>
            </div>
            <div className="field">
              <label>Marca</label>
              <input type="text" className="input" value={brand}
                onChange={e => { setBrand(e.target.value); markDirty() }}/>
            </div>
            <div className="field">
              <label>Deposito</label>
              <select className="select" value={locationId}
                onChange={e => { setLocationId(e.target.value); markDirty() }}>
                <option value="">— Nessun deposito —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.icon} {l.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Categoria</label>
              <select className="select" value={categoryId}
                onChange={e => { setCategoryId(e.target.value); markDirty() }}>
                <option value="">— Nessuna categoria —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Note</label>
              <textarea className="textarea" value={notes} rows={2}
                onChange={e => { setNotes(e.target.value); markDirty() }}/>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontSize:'0.8rem', color:'var(--text-muted)', textTransform:'uppercase',
            letterSpacing:'0.07em', marginBottom:13 }}>📊 Quantità</h3>
          <div className="grid-2" style={{ gap:12 }}>
            <div className="field">
              <label>Quantità</label>
              <input type="number" className="input" value={quantity}
                onChange={e => { setQuantity(e.target.value); markDirty() }}
                min="0.001" step="0.001" required style={{ fontFamily:'var(--font-mono)' }}/>
            </div>
            <div className="field">
              <label>Unità</label>
              <select className="select" value={unit}
                onChange={e => { setUnit(e.target.value as ItemUnit); markDirty() }}>
                {UNITS.map(u => <option key={u} value={u}>{u} — {UNIT_LABELS[u]}</option>)}
              </select>
            </div>
          </div>
          <div className="field" style={{ marginTop:12 }}>
            <label>Prezzo unitario (€)</label>
            <input type="number" className="input" value={purchasePrice}
              onChange={e => { setPurchasePrice(e.target.value); markDirty() }}
              min="0" step="0.01" placeholder="0.00" style={{ fontFamily:'var(--font-mono)' }}/>
          </div>
          {totalValue && (
            <div className="alert alert-info" style={{ marginTop:10 }}>
              💶 Valore totale: <strong>€ {totalValue}</strong>
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ fontSize:'0.8rem', color:'var(--text-muted)', textTransform:'uppercase',
            letterSpacing:'0.07em', marginBottom:13 }}>📅 Date</h3>
          <div className="grid-2" style={{ gap:12 }}>
            <div className="field">
              <label>Data acquisto</label>
              <input type="date" className="input" value={purchaseDate}
                onChange={e => { setPurchaseDate(e.target.value); markDirty() }}/>
            </div>
            <div className="field">
              <label>Data scadenza</label>
              <input type="date" className="input" value={expiryDate}
                onChange={e => { setExpiryDate(e.target.value); markDirty() }}/>
            </div>
          </div>
          {remindDate && (
            <div className="alert alert-warn" style={{ marginTop:12, fontSize:'0.81rem' }}>
              🔔 Promemoria al <strong>{remindDate}</strong>
              <span style={{ opacity:0.8 }}> (1° del mese precedente)</span>
            </div>
          )}
        </div>

        <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading || saved}>
          {loading ? <span className="spinner"/> : saved ? '✓ Salvato!' : isEdit ? 'Salva modifiche' : '+ Aggiungi'}
        </button>

        {isEdit && (
          <div style={{ display:'flex', gap:10 }}>
            <button type="button" className="btn btn-ghost" style={{ flex:1 }}
              disabled={!prevId} onClick={() => requestNav(prevId)}>‹ Precedente</button>
            <button type="button" className="btn btn-ghost" style={{ flex:1 }}
              disabled={!nextId} onClick={() => requestNav(nextId)}>Successivo ›</button>
          </div>
        )}
      </form>
    </div>
  )
}
