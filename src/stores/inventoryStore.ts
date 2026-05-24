import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { encrypt, decrypt, getSessionKey } from '../lib/crypto'

export type ItemUnit = 'pz' | 'g' | 'kg' | 'ml' | 'l' | 'mg' | 'cl'

export interface ItemDecrypted {
  id: string
  categoryId:  string | null
  locationId:  string | null
  name: string
  barcode: string
  brand: string
  notes: string
  purchasePrice: number
  quantity: number
  unit: ItemUnit
  purchaseDate: string | null
  expiryDate:   string | null
  totalValue:   number
  imageUrl:     string | null
  createdAt:    string
  updatedAt:    string
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  isDefault: boolean
}

export interface ItemPayload {
  name: string
  barcode?:       string
  brand?:         string
  notes?:         string
  purchasePrice?: number
  quantity:       number
  unit:           ItemUnit
  categoryId?:    string | null
  locationId?:    string | null
  purchaseDate?:  string | null
  expiryDate?:    string | null
}

interface InventoryState {
  items:      ItemDecrypted[]
  categories: Category[]
  loading:    boolean
  error:      string | null

  fetchAll:        (userId: string) => Promise<void>
  addItem:         (userId: string, payload: ItemPayload) => Promise<void>
  updateItem:      (id: string, userId: string, payload: Partial<ItemPayload>) => Promise<void>
  moveItems:       (ids: string[], locationId: string | null) => Promise<void>
  deleteItem:      (id: string) => Promise<void>
  addCategory:     (userId: string, name: string, icon?: string, color?: string) => Promise<void>
  updateCategory:  (id: string, patch: { name?: string; icon?: string; color?: string }) => Promise<void>
  deleteCategory:  (id: string) => Promise<void>
  clearError:      () => void
}

async function encryptPayload(p: ItemPayload) {
  const key = getSessionKey()
  if (!key) throw new Error('Chiave di cifratura non disponibile.')
  const sensitive = {
    name: p.name, barcode: p.barcode ?? '', brand: p.brand ?? '',
    notes: p.notes ?? '', purchasePrice: p.purchasePrice ?? 0,
  }
  const { ciphertext, ivHex } = await encrypt(JSON.stringify(sensitive), key)
  const totalValue = (p.purchasePrice ?? 0) * p.quantity
  const valEnc = await encrypt(String(totalValue), key)
  return {
    encrypted_data:  ciphertext,  iv_hex:         ivHex,
    encrypted_value: valEnc.ciphertext, iv_value_hex: valEnc.ivHex,
    quantity:      p.quantity,    unit:           p.unit,
    category_id:   p.categoryId  ?? null,
    location_id:   p.locationId  ?? null,
    purchase_date: p.purchaseDate ?? null,
    expiry_date:   p.expiryDate   ?? null,
  }
}

async function decryptRow(row: Record<string, unknown>): Promise<ItemDecrypted | null> {
  const key = getSessionKey()
  if (!key) return null
  try {
    const sensitive = JSON.parse(
      await decrypt({ ciphertext: row.encrypted_data as string, ivHex: row.iv_hex as string }, key)
    )
    const totalValue = row.encrypted_value
      ? parseFloat(await decrypt({ ciphertext: row.encrypted_value as string, ivHex: row.iv_value_hex as string }, key))
      : 0
    return {
      id:            row.id as string,
      categoryId:    row.category_id as string | null,
      locationId:    row.location_id as string | null,
      name:          sensitive.name,
      barcode:       sensitive.barcode,
      brand:         sensitive.brand,
      notes:         sensitive.notes,
      purchasePrice: sensitive.purchasePrice,
      quantity:      row.quantity as number,
      unit:          row.unit as ItemUnit,
      purchaseDate:  row.purchase_date as string | null,
      expiryDate:    row.expiry_date  as string | null,
      totalValue,
      imageUrl:      (row.image_url as string | null) ?? null,
      createdAt:     row.created_at as string,
      updatedAt:     row.updated_at as string,
    }
  } catch { return null }
}

export const useInventoryStore = create<InventoryState>()((set, get) => ({
  items: [], categories: [], loading: false, error: null,
  clearError: () => set({ error: null }),

  fetchAll: async (userId) => {
    set({ loading: true, error: null })
    try {
      const [ir, cr] = await Promise.all([
        supabase.from('items').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase.from('categories').select('*').eq('user_id', userId).order('name'),
      ])
      if (ir.error) throw new Error(ir.error.message)
      if (cr.error) throw new Error(cr.error.message)
      const decrypted = await Promise.all((ir.data ?? []).map(r => decryptRow(r as Record<string, unknown>)))
      const categories: Category[] = (cr.data ?? []).map(c => ({
        id: c.id, name: c.name, icon: c.icon, color: c.color, isDefault: c.is_default,
      }))
      set({ items: decrypted.filter(Boolean) as ItemDecrypted[], categories, loading: false })
    } catch (e) { set({ error: (e as Error).message, loading: false }) }
  },

  addItem: async (userId, payload) => {
    set({ loading: true, error: null })
    try {
      const enc = await encryptPayload(payload)
      const { data, error } = await supabase.from('items').insert({ user_id: userId, ...enc }).select().single()
      if (error) throw new Error(error.message)
      const dec = await decryptRow(data as Record<string, unknown>)
      if (dec) set(s => ({ items: [dec, ...s.items], loading: false }))
      else set({ loading: false })
    } catch (e) { set({ error: (e as Error).message, loading: false }); throw e }
  },

  updateItem: async (id, userId, payload) => {
    set({ loading: true, error: null })
    try {
      const existing = get().items.find(i => i.id === id)
      if (!existing) throw new Error('Articolo non trovato')
      const merged: ItemPayload = {
        name:          payload.name          ?? existing.name,
        barcode:       payload.barcode       ?? existing.barcode,
        brand:         payload.brand         ?? existing.brand,
        notes:         payload.notes         ?? existing.notes,
        purchasePrice: payload.purchasePrice ?? existing.purchasePrice,
        quantity:      payload.quantity      ?? existing.quantity,
        unit:          payload.unit          ?? existing.unit,
        categoryId:    payload.categoryId  !== undefined ? payload.categoryId  : existing.categoryId,
        locationId:    payload.locationId  !== undefined ? payload.locationId  : existing.locationId,
        purchaseDate:  payload.purchaseDate !== undefined ? payload.purchaseDate : existing.purchaseDate,
        expiryDate:    payload.expiryDate   !== undefined ? payload.expiryDate  : existing.expiryDate,
      }
      const enc = await encryptPayload(merged)
      const { data, error } = await supabase.from('items')
        .update(enc).eq('id', id).eq('user_id', userId).select().single()
      if (error) throw new Error(error.message)
      const dec = await decryptRow(data as Record<string, unknown>)
      if (dec) set(s => ({ items: s.items.map(i => i.id === id ? dec : i), loading: false }))
      else set({ loading: false })
    } catch (e) { set({ error: (e as Error).message, loading: false }); throw e }
  },

  // ── Sposta più articoli in un deposito (o rimuove il deposito con null) ──
  moveItems: async (ids, locationId) => {
    if (!ids.length) return
    set({ loading: true, error: null })
    try {
      const { error } = await supabase.from('items')
        .update({ location_id: locationId })
        .in('id', ids)
      if (error) throw new Error(error.message)
      set(s => ({
        items: s.items.map(i => ids.includes(i.id) ? { ...i, locationId } : i),
        loading: false,
      }))
    } catch (e) { set({ error: (e as Error).message, loading: false }) }
  },

  deleteItem: async (id) => {
    const { error } = await supabase.from('items').delete().eq('id', id)
    if (!error) set(s => ({ items: s.items.filter(i => i.id !== id) }))
  },

  addCategory: async (userId, name, icon = '📦', color = '#F59E0B') => {
    const { data, error } = await supabase.from('categories')
      .insert({ user_id: userId, name, icon, color, is_default: false }).select().single()
    if (!error && data) {
      const cat: Category = { id: data.id, name: data.name, icon: data.icon, color: data.color, isDefault: false }
      set(s => ({ categories: [...s.categories, cat].sort((a, b) => a.name.localeCompare(b.name)) }))
    }
  },

  updateCategory: async (id, patch) => {
    const { error } = await supabase.from('categories').update({
      ...(patch.name  !== undefined && { name:  patch.name  }),
      ...(patch.icon  !== undefined && { icon:  patch.icon  }),
      ...(patch.color !== undefined && { color: patch.color }),
    }).eq('id', id)
    if (!error) {
      set(s => ({
        categories: s.categories
          .map(c => c.id === id ? { ...c, ...patch } : c)
          .sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }))
      }))
    }
  },

  deleteCategory: async (id) => {
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (!error) set(s => ({ categories: s.categories.filter(c => c.id !== id) }))
  },
}))
