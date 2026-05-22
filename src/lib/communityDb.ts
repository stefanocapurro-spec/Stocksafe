/**
 * StockSafe – Community Barcode Database
 *
 * Dati condivisi tra tutti gli utenti dell'app, cifrati con una chiave
 * AES-256 a livello applicazione (non per-utente).
 *
 * La chiave è derivata da VITE_COMMUNITY_KEY (env var) con un salt fisso
 * pubblico noto: protegge la riservatezza dei dati a riposo nel DB,
 * non dall'amministratore del progetto (che conosce la chiave).
 *
 * Tabella Supabase: community_barcodes
 *   barcode        text PRIMARY KEY
 *   encrypted_data text NOT NULL   (JSON cifrato)
 *   iv_hex         text NOT NULL
 *   contributed_by uuid            (userId, anonimizzato)
 *   created_at     timestamptz
 *   updated_at     timestamptz
 */

import { supabase }              from './supabase'
import { encrypt, decrypt, hexToBuffer } from './crypto'
import type { ProductInfo }       from './barcode'

const COMMUNITY_SALT = 'stocksafe_community_v1_2026'  // salt pubblico fisso

// ── Chiave condivisa ────────────────────────────────────────────────────────

let _communityKey: CryptoKey | null = null

async function getCommunityKey(): Promise<CryptoKey | null> {
  if (_communityKey) return _communityKey

  const secret = import.meta.env.VITE_COMMUNITY_KEY as string | undefined
  if (!secret) return null   // chiave non configurata → feature disabilitata

  try {
    const enc  = new TextEncoder()
    const salt = enc.encode(COMMUNITY_SALT)
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']
    )
    _communityKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
    return _communityKey
  } catch { return null }
}

// ── Lookup nel database community ────────────────────────────────────────────

export async function communityLookup(barcode: string): Promise<ProductInfo | null> {
  const key = await getCommunityKey()
  if (!key) return null

  try {
    const { data, error } = await supabase
      .from('community_barcodes')
      .select('encrypted_data, iv_hex')
      .eq('barcode', barcode)
      .maybeSingle()

    if (error || !data) return null

    const plain = await decrypt(
      { ciphertext: data.encrypted_data, ivHex: data.iv_hex },
      key
    )
    const parsed = JSON.parse(plain) as Omit<ProductInfo, 'barcode' | 'found'>
    return { ...parsed, barcode, found: true }
  } catch { return null }
}

// ── Contribuisci un prodotto al database community ───────────────────────────

export interface CommunityContribution {
  name:        string
  brand:       string
  category:    string
  imageUrl:    string
  weightValue: number | null
  weightUnit:  string | null
}

export async function contributeBarcode(
  barcode:   string,
  data:      CommunityContribution,
  userId:    string
): Promise<{ ok: boolean; message: string }> {
  const key = await getCommunityKey()
  if (!key) return { ok: false, message: 'Database community non disponibile.' }

  if (!barcode?.trim() || !data.name?.trim()) {
    return { ok: false, message: 'Codice a barre e nome sono obbligatori.' }
  }

  try {
    // Controlla se esiste già
    const { data: existing } = await supabase
      .from('community_barcodes')
      .select('barcode')
      .eq('barcode', barcode)
      .maybeSingle()

    const payload: Omit<ProductInfo, 'barcode' | 'found'> = {
      name:        data.name.trim(),
      brand:       data.brand?.trim()    ?? '',
      category:    data.category?.trim() ?? '',
      imageUrl:    data.imageUrl?.trim() ?? '',
      weightValue: data.weightValue,
      weightUnit:  data.weightUnit,
    }

    const { ciphertext, ivHex } = await encrypt(JSON.stringify(payload), key)

    if (existing) {
      // Aggiorna
      const { error } = await supabase
        .from('community_barcodes')
        .update({ encrypted_data: ciphertext, iv_hex: ivHex, updated_at: new Date().toISOString() })
        .eq('barcode', barcode)
      if (error) throw new Error(error.message)
      return { ok: true, message: 'Prodotto aggiornato nel database condiviso.' }
    } else {
      // Inserisce
      const { error } = await supabase
        .from('community_barcodes')
        .insert({
          barcode,
          encrypted_data: ciphertext,
          iv_hex:         ivHex,
          contributed_by: userId,
        })
      if (error) throw new Error(error.message)
      return { ok: true, message: 'Prodotto contribuito al database condiviso. Grazie!' }
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
