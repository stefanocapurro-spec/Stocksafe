import { useState } from 'react'
import { useAuthStore }      from '../stores/authStore'
import { useInventoryStore } from '../stores/inventoryStore'

// ── Set icone ampliato (condiviso con LocationsPage) ─────────────────────────
export const ALL_ICONS = [
  // Cibo & bevande
  '🍎','🥩','🥦','🥛','🧀','🍞','🥚','🐟','🍋','🍇',
  '🥫','🍝','🍕','🍔','☕','🍺','🥤','🧃','🫙','🍯',
  // Casa & pulizia
  '🧹','🧴','🧼','🪣','🧽','🫧','🪥','🧻','🪒','🫗',
  // Salute & cura
  '💊','💉','🩺','🩹','🧬','🌡️','🏥','🦷','👁️','💆',
  // Tecnologia & elettronica
  '🔋','💡','🔌','📱','💻','🖨️','📷','🎮','🖥️','⌨️',
  // Abbigliamento & accessori
  '👕','👖','👟','👜','🧢','🧣','🧤','👔','👗','🩴',
  // Ufficio & finanza
  '📚','📝','💳','📋','🗂️','🖊️','📎','🗃️','💰','🏦',
  // Animali & natura
  '🐾','🌿','🌺','🌳','🐶','🐱','🐠','🦜','🐇','🌱',
  // Sport & hobby
  '⚽','🎵','🎨','🧸','🎯','🏋️','🚴','🎭','🎲','📸',
  // Varie
  '📦','🔧','🗄️','🎁','🔒','⭐','❄️','🌊','🏔️','✈️',
]

const COLORS = [
  '#F59E0B','#EF4444','#10B981','#8B5CF6','#3B82F6',
  '#EC4899','#06B6D4','#84CC16','#F97316','#6366F1',
  '#14B8A6','#F43F5E','#A78BFA','#34D399','#60A5FA',
]

// ── Tipi interni ──────────────────────────────────────────────────────────────

type FormState = { name: string; icon: string; color: string }

const DEFAULT_FORM: FormState = { name: '', icon: '📦', color: '#F59E0B' }

// ── Componente principale ─────────────────────────────────────────────────────

export function CategoriesPage() {
  const { user } = useAuthStore()
  const { categories, items, addCategory, updateCategory, deleteCategory } = useInventoryStore()

  // form per nuova categoria
  const [adding, setAdding]         = useState(false)
  const [addForm, setAddForm]       = useState<FormState>(DEFAULT_FORM)
  const [addError, setAddError]     = useState('')

  // modifica inline
  const [editId, setEditId]         = useState<string | null>(null)
  const [editForm, setEditForm]     = useState<FormState>(DEFAULT_FORM)
  const [editError, setEditError]   = useState('')

  // conferma eliminazione
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  // ── Aggiunta ────────────────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError('')
    if (!addForm.name.trim()) { setAddError('Inserisci un nome.'); return }
    if (categories.some(c => c.name.toLowerCase() === addForm.name.trim().toLowerCase())) {
      setAddError('Questa categoria esiste già.'); return
    }
    if (!user) return
    await addCategory(user.id, addForm.name.trim(), addForm.icon, addForm.color)
    setAddForm(DEFAULT_FORM)
    setAdding(false)
  }

  // ── Modifica ─────────────────────────────────────────────────────────────────
  const openEdit = (id: string) => {
    const cat = categories.find(c => c.id === id); if (!cat) return
    setEditForm({ name: cat.name, icon: cat.icon, color: cat.color })
    setEditError('')
    setEditId(id)
    setAdding(false)          // chiude il form "aggiungi" se aperto
    setConfirmDel(null)
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    setEditError('')
    if (!editForm.name.trim()) { setEditError('Il nome non può essere vuoto.'); return }
    if (categories.some(c =>
      c.id !== editId &&
      c.name.toLowerCase() === editForm.name.trim().toLowerCase()
    )) { setEditError('Un\'altra categoria ha già questo nome.'); return }
    await updateCategory(editId!, {
      name:  editForm.name.trim(),
      icon:  editForm.icon,
      color: editForm.color,
    })
    setEditId(null)
  }

  const countItems = (catId: string) => items.filter(i => i.categoryId === catId).length

  return (
    <div className="page-container" style={{ paddingTop: 24 }}>

      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h2>Categorie</h2>
          <p style={{ fontSize:'0.78rem', marginTop:2 }}>{categories.length} categorie</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => {
          setAdding(a => !a); setEditId(null); setAddError('')
        }}>
          {adding ? '✕ Annulla' : '+ Nuova'}
        </button>
      </div>

      {/* ── Form nuova categoria ── */}
      {adding && (
        <CategoryForm
          title="Nuova categoria"
          form={addForm}
          onChange={setAddForm}
          error={addError}
          submitLabel="Crea categoria"
          onSubmit={handleAdd}
          onCancel={() => { setAdding(false); setAddForm(DEFAULT_FORM); setAddError('') }}
        />
      )}

      {/* ── Note ── */}
      <div className="alert alert-info" style={{ marginBottom:16, fontSize:'0.82rem' }}>
        Le categorie predefinite non possono essere eliminate se contengono articoli.
      </div>

      {/* ── Lista ── */}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {categories.map(cat => {
          const count = countItems(cat.id)
          const isDeletable = !cat.isDefault || count === 0
          const isEditing   = editId === cat.id

          return (
            <div key={cat.id} className="card fade-in" style={{ padding: isEditing ? 0 : undefined }}>

              {isEditing ? (
                /* ── Form modifica inline ── */
                <div style={{ padding:'16px 16px 4px' }}>
                  <CategoryForm
                    title={`Modifica: ${cat.name}`}
                    form={editForm}
                    onChange={setEditForm}
                    error={editError}
                    submitLabel="Salva modifiche"
                    onSubmit={handleEdit}
                    onCancel={() => { setEditId(null); setEditError('') }}
                  />
                </div>
              ) : (
                /* ── Riga normale ── */
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  {/* Icona */}
                  <div style={{
                    width:44, height:44, borderRadius:12, flexShrink:0,
                    background:`${cat.color}18`, border:`1px solid ${cat.color}30`,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:'1.3rem',
                  }}>
                    {cat.icon}
                  </div>

                  {/* Info */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, color:cat.color }}>{cat.name}</div>
                    <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>
                      {count} {count === 1 ? 'articolo' : 'articoli'}
                      {cat.isDefault && ' · predefinita'}
                    </div>
                  </div>

                  {/* Azioni */}
                  {confirmDel === cat.id ? (
                    <div style={{ display:'flex', gap:6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(null)}>Annulla</button>
                      <button className="btn btn-danger btn-sm" onClick={async () => {
                        await deleteCategory(cat.id); setConfirmDel(null)
                      }}>Elimina</button>
                    </div>
                  ) : (
                    <div style={{ display:'flex', gap:4 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Modifica"
                        onClick={() => openEdit(cat.id)}>
                        ✏
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color:'var(--red)', opacity: isDeletable ? 1 : 0.3 }}
                        disabled={!isDeletable}
                        title={!isDeletable ? 'Rimuovi prima gli articoli' : 'Elimina'}
                        onClick={() => setConfirmDel(cat.id)}>
                        🗑
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ height:24 }} />
    </div>
  )
}

// ── Componente form riutilizzabile (add + edit) ───────────────────────────────

interface CategoryFormProps {
  title:       string
  form:        FormState
  onChange:    (f: FormState) => void
  error:       string
  submitLabel: string
  onSubmit:    (e: React.FormEvent) => void
  onCancel:    () => void
}

function CategoryForm({ title, form, onChange, error, submitLabel, onSubmit, onCancel }: CategoryFormProps) {
  const set = (patch: Partial<FormState>) => onChange({ ...form, ...patch })

  return (
    <form onSubmit={onSubmit} className="card fade-in" style={{ marginBottom:20 }}>
      <h3 style={{ marginBottom:14, fontSize:'0.9rem' }}>{title}</h3>

      {error && <div className="alert alert-error" style={{ marginBottom:12 }}>{error}</div>}

      {/* Nome */}
      <div className="field" style={{ marginBottom:12 }}>
        <label>Nome *</label>
        <input
          type="text" className="input"
          value={form.name}
          onChange={e => set({ name: e.target.value })}
          placeholder="Es. Bevande, Snack, Pulizia casa..."
          autoFocus
        />
      </div>

      {/* Icona */}
      <div className="field" style={{ marginBottom:12 }}>
        <label>Icona</label>
        <IconPicker value={form.icon} onChange={ic => set({ icon: ic })} />
      </div>

      {/* Colore */}
      <div className="field" style={{ marginBottom:16 }}>
        <label>Colore</label>
        <ColorPicker value={form.color} onChange={c => set({ color: c })} />
      </div>

      {/* Anteprima */}
      <div style={{
        display:'flex', alignItems:'center', gap:10, marginBottom:16,
        padding:'10px 14px', background:'var(--bg-base)', borderRadius:10,
        border:'1px solid var(--border)',
      }}>
        <span style={{ fontSize:'1.4rem' }}>{form.icon}</span>
        <span style={{ fontWeight:600, color:form.color }}>{form.name || 'Anteprima'}</span>
      </div>

      <div style={{ display:'flex', gap:8 }}>
        <button type="button" className="btn btn-ghost" style={{ flex:1 }} onClick={onCancel}>Annulla</button>
        <button type="submit"  className="btn btn-primary" style={{ flex:2 }}>{submitLabel}</button>
      </div>
    </form>
  )
}

// ── Picker icona con ricerca ──────────────────────────────────────────────────

function IconPicker({ value, onChange }: { value: string; onChange: (ic: string) => void }) {
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? ALL_ICONS.filter(ic => {
        // cerca per codepoint (emoji Unicode name approssimativo via label)
        const label = getEmojiLabel(ic)
        return label.includes(search.toLowerCase())
      })
    : ALL_ICONS

  return (
    <div>
      <input
        type="text" className="input"
        style={{ marginBottom:8, fontSize:'0.82rem' }}
        placeholder="Cerca icona (es. cibo, casa, salute…)"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div style={{
        display:'flex', flexWrap:'wrap', gap:5,
        maxHeight: 160, overflowY:'auto',
        padding:4, borderRadius:8,
        background:'var(--bg-base)', border:'1px solid var(--border)',
      }}>
        {filtered.length === 0 && (
          <span style={{ fontSize:'0.8rem', color:'var(--text-muted)', padding:8 }}>
            Nessun risultato. Prova un termine diverso.
          </span>
        )}
        {filtered.map(ic => (
          <button key={ic} type="button"
            style={{
              width:36, height:36, fontSize:'1.2rem', borderRadius:8,
              background: value === ic ? 'var(--accent-glow)' : 'var(--bg-raised)',
              border:`1px solid ${value === ic ? 'var(--accent)' : 'var(--border)'}`,
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
              flexShrink:0,
            }}
            title={getEmojiLabel(ic)}
            onClick={() => onChange(ic)}>
            {ic}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Picker colore ─────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
      {COLORS.map(c => (
        <button key={c} type="button"
          style={{
            width:28, height:28, borderRadius:'50%', background:c, cursor:'pointer',
            border:`2px solid ${value === c ? '#fff' : 'transparent'}`,
            outline: value === c ? `2px solid ${c}` : 'none',
            outlineOffset:2, transition:'all 0.15s', flexShrink:0,
          }}
          title={c}
          onClick={() => onChange(c)}
        />
      ))}
      {/* Colore personalizzato */}
      <label title="Colore personalizzato" style={{ position:'relative', cursor:'pointer' }}>
        <div style={{
          width:28, height:28, borderRadius:'50%',
          background: COLORS.includes(value) ? 'var(--bg-raised)' : value,
          border:`2px solid ${!COLORS.includes(value) ? '#fff' : 'var(--border)'}`,
          outline: !COLORS.includes(value) ? `2px solid ${value}` : 'none',
          outlineOffset:2, display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:'0.75rem', color:'var(--text-muted)',
        }}>
          {COLORS.includes(value) ? '🎨' : ''}
        </div>
        <input
          type="color" value={value}
          onChange={e => onChange(e.target.value)}
          style={{ position:'absolute', inset:0, opacity:0, width:'100%', height:'100%', cursor:'pointer' }}
        />
      </label>
    </div>
  )
}

// ── Mappa emoji → label testuale per la ricerca ───────────────────────────────
// (lista parziale ma sufficiente per i tag più usati)

const EMOJI_LABELS: Record<string, string> = {
  '🍎':'mela frutta cibo','🥩':'carne bistecca cibo','🥦':'broccoli verdura cibo',
  '🥛':'latte bevanda','🧀':'formaggio cibo','🍞':'pane cibo','🥚':'uovo cibo',
  '🐟':'pesce cibo','🍋':'limone agrume frutto','🍇':'uva frutta cibo',
  '🥫':'lattina conserva cibo','🍝':'pasta spaghetti cibo','🍕':'pizza cibo',
  '🍔':'hamburger cibo','☕':'caffè bevanda','🍺':'birra bevanda',
  '🥤':'bibita bevanda','🧃':'succo bevanda','🫙':'barattolo dispensa',
  '🍯':'miele dolce cibo',
  '🧹':'scopa pulizia casa','🧴':'shampoo detersivo cura','🧼':'sapone pulizia',
  '🪣':'secchio pulizia','🧽':'spugna pulizia','🫧':'bolle sapone pulizia',
  '🪥':'spazzolino cura','🧻':'carta igienica casa','🪒':'rasoio cura',
  '🫗':'bottiglia detersivo',
  '💊':'medicina farmaco salute','💉':'siringa vaccino salute','🩺':'stetoscopio salute',
  '🩹':'cerotto salute','🧬':'dna salute','🌡️':'termometro temperatura salute',
  '🏥':'ospedale salute','🦷':'dente salute','👁️':'occhio salute','💆':'massaggio',
  '🔋':'batteria energia elettrico','💡':'lampadina luce elettrico','🔌':'spina elettrico',
  '📱':'telefono smartphone','💻':'computer laptop','🖨️':'stampante',
  '📷':'fotocamera','🎮':'videogioco controller','🖥️':'monitor','⌨️':'tastiera',
  '👕':'maglietta vestiti abbigliamento','👖':'pantaloni jeans abbigliamento',
  '👟':'scarpe abbigliamento','👜':'borsa accessorio','🧢':'cappello accessorio',
  '🧣':'sciarpa accessorio','🧤':'guanti accessorio','👔':'camicia abbigliamento',
  '👗':'vestito abbigliamento','🩴':'sandali calzature',
  '📚':'libri ufficio','📝':'penna appunti ufficio','💳':'carta credito finanza',
  '📋':'appunti lista ufficio','🗂️':'archivio cartelle ufficio','🖊️':'penna ufficio',
  '📎':'graffetta ufficio','🗃️':'schedario ufficio','💰':'soldi finanza','🏦':'banca',
  '🐾':'animali zampe pet','🌿':'pianta natura','🌺':'fiore natura',
  '🌳':'albero natura','🐶':'cane animale','🐱':'gatto animale','🐠':'pesce acquario',
  '🦜':'pappagallo uccello','🐇':'coniglio animale','🌱':'piantina giardinaggio',
  '⚽':'calcio sport','🎵':'musica','🎨':'arte pittura','🧸':'peluche giocattolo',
  '🎯':'dardo sport hobby','🏋️':'palestra sport','🚴':'bici ciclismo sport',
  '🎭':'teatro arte','🎲':'gioco da tavolo hobby','📸':'fotografia hobby',
  '📦':'scatola generico','🔧':'attrezzi','🗄️':'armadio','🎁':'regalo',
  '🔒':'lucchetto sicurezza','⭐':'stella','❄️':'freddo ghiaccio',
  '🌊':'mare acqua','🏔️':'montagna','✈️':'aereo viaggio',
  '🏠':'casa home','🎒':'zaino borsa','🚗':'auto macchina',
  '🏕️':'campeggio tenda','🏢':'ufficio edificio','🏪':'negozio',
  '🏫':'scuola','⛺':'tenda campeggio','🛖':'capanna','🚢':'nave barca',
  '🔑':'chiave','🪴':'vaso pianta','🎪':'circo',
}

function getEmojiLabel(emoji: string): string {
  return EMOJI_LABELS[emoji] ?? emoji
}
