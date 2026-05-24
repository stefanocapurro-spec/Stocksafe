/**
 * StockSafe – Barcode Scanner v7 (canvas-based, iOS PWA fix definitivo)
 *
 * Strategia display: video NASCOSTO + canvas VISIBILE
 *  - Il video con srcObject non è mai visibile all'utente
 *  - Un loop copia i frame video sul canvas ogni 50ms
 *  - Il canvas è ciò che l'utente vede
 *  - La decodifica avviene sullo stesso canvas
 *
 * Questo bypassa completamente il bug di iOS PWA dove il <video> rimane nero.
 *
 * Lookup cascade: OFF world/IT → Beauty → PetFood → Products → UPC → Community
 */

// ── Stream caching ────────────────────────────────────────────────────────────

let cachedStream: MediaStream | null = null
// Video element nascosto riutilizzato tra sessioni
let hiddenVideo: HTMLVideoElement | null = null

async function getStream(): Promise<MediaStream> {
  if (cachedStream?.active) return cachedStream

  const attempts: MediaStreamConstraints['video'][] = [
    { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    { facingMode: 'environment' },
    true,
  ]

  let lastErr: unknown
  for (const video of attempts) {
    try {
      cachedStream = await navigator.mediaDevices.getUserMedia({ video, audio: false })
      return cachedStream
    } catch (e) { lastErr = e }
  }
  throw lastErr
}

export function releaseStream() {
  cachedStream?.getTracks().forEach(t => t.stop())
  cachedStream = null
  if (hiddenVideo) {
    hiddenVideo.srcObject = null
    hiddenVideo.remove()
    hiddenVideo = null
  }
}

// ── Video nascosto (singleton) ────────────────────────────────────────────────

function getHiddenVideo(): HTMLVideoElement {
  if (!hiddenVideo) {
    hiddenVideo = document.createElement('video')
    // Tutti gli attributi necessari per iOS
    hiddenVideo.muted       = true
    hiddenVideo.playsInline = true
    hiddenVideo.setAttribute('playsinline', '')
    hiddenVideo.setAttribute('webkit-playsinline', '')
    hiddenVideo.setAttribute('autoplay', '')
    hiddenVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;'
    document.body.appendChild(hiddenVideo)
  }
  return hiddenVideo
}

// ── Avvio stream sul video nascosto ───────────────────────────────────────────

async function startHiddenVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = getHiddenVideo()
  video.srcObject = stream

  // Tenta play subito
  try { await video.play() } catch { /* riprova dopo gli eventi */ }

  // Aspetta che il video abbia dimensioni (polling + eventi)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(
        'Fotocamera non disponibile. Su iPhone: Impostazioni → ' +
        'Privacy e Sicurezza → Fotocamera → Safari (o StockSafe) → Consenti'
      ))
    }, 12000)

    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup(); resolve()
      }
    }

    const poll = setInterval(check, 80)

    const onEvent = () => {
      if (video.paused) {
        video.play().catch(() => {})
      }
      check()
    }

    video.addEventListener('loadedmetadata', onEvent)
    video.addEventListener('loadeddata',     onEvent)
    video.addEventListener('canplay',        onEvent)
    video.addEventListener('playing',        onEvent)
    video.addEventListener('error', () => {
      cleanup()
      reject(new Error('Errore stream video'))
    }, { once: true })

    const cleanup = () => {
      clearTimeout(timeout)
      clearInterval(poll)
      video.removeEventListener('loadedmetadata', onEvent)
      video.removeEventListener('loadeddata',     onEvent)
      video.removeEventListener('canplay',        onEvent)
      video.removeEventListener('playing',        onEvent)
    }

    // Se già pronto
    check()
  })

  // Assicura che sia in play
  if (video.paused) {
    try { await video.play() } catch (e) {
      throw new Error('Impossibile avviare la fotocamera. Controlla i permessi.')
    }
  }

  return video
}

// ── BarcodeDetector nativo ────────────────────────────────────────────────────

type NativeDetector = {
  detect(src: HTMLVideoElement | HTMLCanvasElement): Promise<{ rawValue: string }[]>
}

async function getNativeDetector(): Promise<NativeDetector | null> {
  const BD = (window as unknown as Record<string, unknown>).BarcodeDetector as
    | { getSupportedFormats(): Promise<string[]>; new(opts: { formats: string[] }): NativeDetector }
    | undefined
  if (!BD) return null
  try {
    const supported = await BD.getSupportedFormats()
    const want = ['ean_13','ean_8','upc_a','upc_e','qr_code','code_128','code_39','itf','codabar']
    return new BD({ formats: want.filter(f => supported.includes(f)) })
  } catch { return null }
}

// ── ZXing decode su canvas ────────────────────────────────────────────────────

type ZXingReader = { decode(bmp: unknown): { getText(): string } }

async function makeZxingReader(): Promise<ZXingReader | null> {
  try {
    const zx = await import('@zxing/library')
    return new (zx.MultiFormatReader as new () => ZXingReader)()
  } catch { return null }
}

async function decodeCanvas(
  canvas: HTMLCanvasElement,
  reader: ZXingReader
): Promise<string | null> {
  try {
    const zx     = await import('@zxing/library')
    const source = new zx.HTMLCanvasElementLuminanceSource(canvas)
    const bmp    = new zx.BinaryBitmap(new zx.HybridBinarizer(source))
    return reader.decode(bmp)?.getText() ?? null
  } catch { return null }
}

// ── Scanner principale ────────────────────────────────────────────────────────
// canvasEl: il canvas VISIBILE passato da AddItemPage

export async function startScanner(
  canvasEl: HTMLCanvasElement,
  onDetect: (code: string) => void,
  onError?: (err: Error) => void
): Promise<() => void> {
  let stopped = false
  let rafId: number | null = null
  const ctx = canvasEl.getContext('2d')!

  try {
    const stream = await getStream()
    const video  = await startHiddenVideo(stream)

    const nativeDetector = await getNativeDetector()
    const zxingReader    = nativeDetector ? null : await makeZxingReader()

    if (!nativeDetector && !zxingReader) {
      onError?.(new Error('Libreria barcode non disponibile.'))
      return () => { stopped = true }
    }

    let lastDecodeTime = 0
    const DECODE_INTERVAL = 150  // decodifica ogni 150ms

    const tick = async (now: number) => {
      if (stopped) return
      rafId = requestAnimationFrame(tick)

      // Copia frame dal video nascosto al canvas visibile
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        canvasEl.width  = video.videoWidth
        canvasEl.height = video.videoHeight
        ctx.drawImage(video, 0, 0)
      }

      // Decodifica a intervalli per non sovraccaricare
      if (now - lastDecodeTime < DECODE_INTERVAL) return
      lastDecodeTime = now

      if (canvasEl.width === 0) return

      try {
        if (nativeDetector) {
          const hits = await nativeDetector.detect(canvasEl)
          if (hits[0]?.rawValue && !stopped) { onDetect(hits[0].rawValue); return }
        } else if (zxingReader) {
          const code = await decodeCanvas(canvasEl, zxingReader)
          if (code && !stopped) { onDetect(code); return }
        }
      } catch { /* frame non decodificabile */ }
    }

    rafId = requestAnimationFrame(tick)

  } catch (e) {
    onError?.(e as Error)
  }

  return () => {
    stopped = true
    if (rafId !== null) cancelAnimationFrame(rafId)
    // Non rilasciamo lo stream — solo fermiamo il loop
  }
}

export function stopScanner() { releaseStream() }

// ── ProductInfo + lookup ──────────────────────────────────────────────────────

export interface ProductInfo {
  name:        string
  brand:       string
  category:    string
  imageUrl:    string
  barcode:     string
  found:       boolean
  weightValue: number | null
  weightUnit:  string | null
  source?:     string
}

function parseQuantityString(raw: string | null | undefined): { val: number | null; unit: string | null } {
  if (!raw) return { val: null, unit: null }
  const s = raw.toLowerCase().replace(',', '.').trim()
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl|mg|pz|oz|lb)\b/)
  if (m) {
    let val = parseFloat(m[1]); let unit = m[2]
    if (unit === 'oz') { val = parseFloat((val * 28.35).toFixed(1)); unit = 'g' }
    if (unit === 'lb') { val = parseFloat((val * 0.4536).toFixed(3)); unit = 'kg' }
    return { val, unit }
  }
  const multi = s.match(/^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl|mg)/)
  if (multi) return { val: parseInt(multi[1]), unit: 'pz' }
  return { val: null, unit: null }
}

const empty = (barcode: string): ProductInfo => ({
  name:'', brand:'', category:'', imageUrl:'', barcode, found:false,
  weightValue: null, weightUnit: null,
})

type OFFHost = 'world.openfoodfacts'|'world.openbeautyfacts'|'world.openpetfoodfacts'|'world.openproductsfacts'

async function fetchOpenFacts(barcode: string, host: OFFHost, sourceName: string): Promise<ProductInfo | null> {
  try {
    const res  = await fetch(
      `https://${host}.org/api/v2/product/${encodeURIComponent(barcode)}?fields=product_name,product_name_it,brands,categories_tags,image_front_small_url,quantity,product_quantity`,
      { signal: AbortSignal.timeout(7000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (data.status !== 1 || !data.product) return null
    const p    = data.product
    const name = (p.product_name_it || p.product_name || '').trim()
    if (!name) return null
    const catTag: string = (p.categories_tags as string[] ?? [])
      .find((t: string) => t.startsWith('it:')) ?? (p.categories_tags as string[])?.[0] ?? ''
    const { val: weightValue, unit: weightUnit } = parseQuantityString(p.quantity ?? p.product_quantity)
    return {
      name, brand: (p.brands || '').split(',')[0].trim(),
      category: catTag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' '),
      imageUrl: p.image_front_small_url || '',
      barcode, found: true, weightValue, weightUnit, source: sourceName,
    }
  } catch { return null }
}

async function fetchUpcItemDb(barcode: string): Promise<ProductInfo | null> {
  try {
    const res  = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`,
      { signal: AbortSignal.timeout(7000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const item = data?.items?.[0]
    if (!item) return null
    const wm = (item.title ?? '').toLowerCase().match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl|mg)\b/)
    return {
      name: item.title || '', brand: item.brand || '', category: item.category || '',
      imageUrl: item.images?.[0] || '', barcode, found: true,
      weightValue: wm ? parseFloat(wm[1]) : null, weightUnit: wm ? wm[2] : null, source: 'upc',
    }
  } catch { return null }
}

export async function lookupBarcode(barcode: string): Promise<ProductInfo> {
  const [offWorld, obf, opff, opf] = await Promise.all([
    fetchOpenFacts(barcode, 'world.openfoodfacts',    'off'),
    fetchOpenFacts(barcode, 'world.openbeautyfacts',  'obf'),
    fetchOpenFacts(barcode, 'world.openpetfoodfacts', 'opff'),
    fetchOpenFacts(barcode, 'world.openproductsfacts','opf'),
  ])
  const pub = offWorld ?? obf ?? opff ?? opf
  if (pub) return pub

  const upc = await fetchUpcItemDb(barcode)
  if (upc) return upc

  try {
    const { communityLookup } = await import('./communityDb')
    const c = await communityLookup(barcode)
    if (c) return { ...c, source: 'community' }
  } catch { /* non disponibile */ }

  return empty(barcode)
}
