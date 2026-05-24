/**
 * StockSafe – Barcode Scanner v8 (redesign completo cross-platform)
 *
 * Architettura:
 *  - Il <video> viene iniettato VISIBILE nel container passato dal componente
 *    (non più nascosto a -9999px → fix iOS PWA black screen definitivo)
 *  - BarcodeDetector nativo (Chrome/Edge/Android) → detect() direttamente sul video
 *  - ZXing fallback → canvas OFFSCREEN (mai nel DOM), draw del frame video, decode
 *  - iOS Safari: video visibile + canvas offscreen. Il video è il viewfinder.
 *  - Nessun "copia frame su canvas visibile": il video stesso è il preview
 *
 * Lookup cascade: OFF world/IT → Beauty → PetFood → Products → UPC → Community
 */

// ── Rilevamento piattaforma ───────────────────────────────────────────────────

function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

// ── Stream caching ────────────────────────────────────────────────────────────

let cachedStream: MediaStream | null = null

async function getStream(): Promise<MediaStream> {
  if (cachedStream?.active) return cachedStream

  // Cascade di constraints: da più specifico a più generico
  const attempts: MediaStreamConstraints['video'][] = [
    { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    { facingMode: 'environment' },
    { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
    true,
  ]

  let lastErr: unknown
  for (const video of attempts) {
    try {
      cachedStream = await navigator.mediaDevices.getUserMedia({ video, audio: false })
      return cachedStream
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

export function releaseStream() {
  cachedStream?.getTracks().forEach(t => t.stop())
  cachedStream = null
}

// ── Crea e avvia video nel container ─────────────────────────────────────────
//
// Il video è VISIBILE (è il viewfinder), non nascosto.
// Su iOS questo è il fix definitivo: WebKit decodifica solo i frame di video
// che sono nel render tree con dimensioni non-zero.

function createVideoInContainer(container: HTMLElement): HTMLVideoElement {
  const video = document.createElement('video')
  video.muted        = true
  video.playsInline  = true
  video.setAttribute('playsinline',        '')
  video.setAttribute('webkit-playsinline', '')
  video.setAttribute('autoplay',           '')
  video.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    'object-fit:cover',
    'border-radius:inherit',
    // Su iOS, display:block + dimensioni reali = pipeline video attiva
    'display:block',
  ].join(';')
  container.appendChild(video)
  return video
}

async function startVideo(
  video: HTMLVideoElement,
  stream: MediaStream
): Promise<void> {
  video.srcObject = stream

  // Primo tentativo di play (necessario su iOS dopo assegnazione srcObject)
  try { await video.play() } catch { /* riprova dopo eventi */ }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(
        'Fotocamera non disponibile.\n' +
        'Su iPhone/iPad: Impostazioni → Privacy e Sicurezza → Fotocamera\n' +
        '→ Safari (o StockSafe) → Consenti'
      ))
    }, 15000)

    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup(); resolve()
      }
    }

    const poll = setInterval(check, 80)

    const onEvent = () => {
      if (video.paused) video.play().catch(() => {})
      check()
    }

    video.addEventListener('loadedmetadata', onEvent)
    video.addEventListener('loadeddata',     onEvent)
    video.addEventListener('canplay',        onEvent)
    video.addEventListener('playing',        onEvent)
    video.addEventListener('error', () => {
      cleanup()
      reject(new Error('Errore stream video. Riprova.'))
    }, { once: true })

    const cleanup = () => {
      clearTimeout(timeout)
      clearInterval(poll)
      video.removeEventListener('loadedmetadata', onEvent)
      video.removeEventListener('loadeddata',     onEvent)
      video.removeEventListener('canplay',        onEvent)
      video.removeEventListener('playing',        onEvent)
    }

    check()
  })

  if (video.paused) {
    try { await video.play() } catch {
      throw new Error('Impossibile avviare la fotocamera. Controlla i permessi.')
    }
  }
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
    const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'code_128', 'code_39', 'itf', 'codabar']
    const formats = want.filter(f => supported.includes(f))
    if (formats.length === 0) return null
    return new BD({ formats })
  } catch {
    return null
  }
}

// ── ZXing decode su canvas OFFSCREEN ─────────────────────────────────────────
//
// Il canvas NON è mai nel DOM. Viene creato, usato per decode, e basta.
// Nessun problema di iOS qui: la sorgente è il video visibile nel DOM.

type ZXingReader = { decode(bmp: unknown): { getText(): string } }

let zxingReaderInstance: ZXingReader | null = null

async function getZxingReader(): Promise<ZXingReader | null> {
  if (zxingReaderInstance) return zxingReaderInstance
  try {
    const zx = await import('@zxing/library')
    zxingReaderInstance = new (zx.MultiFormatReader as new () => ZXingReader)()
    return zxingReaderInstance
  } catch {
    return null
  }
}

// Canvas offscreen riutilizzato (evita allocazioni ripetute)
let offscreenCanvas: HTMLCanvasElement | null = null
let offscreenCtx: CanvasRenderingContext2D | null = null

function getOffscreenCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas')
    offscreenCtx    = offscreenCanvas.getContext('2d')!
  }
  if (offscreenCanvas.width !== w)  offscreenCanvas.width  = w
  if (offscreenCanvas.height !== h) offscreenCanvas.height = h
  return { canvas: offscreenCanvas, ctx: offscreenCtx! }
}

async function decodeWithZxing(
  video: HTMLVideoElement,
  reader: ZXingReader
): Promise<string | null> {
  const w = video.videoWidth, h = video.videoHeight
  if (!w || !h) return null
  try {
    const { canvas, ctx } = getOffscreenCanvas(w, h)
    ctx.drawImage(video, 0, 0, w, h)
    const zx     = await import('@zxing/library')
    const source = new zx.HTMLCanvasElementLuminanceSource(canvas)
    const bmp    = new zx.BinaryBitmap(new zx.HybridBinarizer(source))
    return reader.decode(bmp)?.getText() ?? null
  } catch {
    // NotFoundException è normale su ogni frame senza barcode → silenzio
    return null
  }
}

// ── Scanner principale ────────────────────────────────────────────────────────
//
// container: div visibile nel DOM (passato da AddItemPage).
// Il video viene iniettato dentro di esso; alla chiusura viene rimosso.

export async function startScanner(
  container: HTMLDivElement,
  onDetect: (code: string) => void,
  onError?: (err: Error) => void
): Promise<() => void> {
  let stopped  = false
  let rafId: number | null = null
  let videoEl: HTMLVideoElement | null = null

  const stop = () => {
    stopped = true
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
    if (videoEl) {
      videoEl.srcObject = null
      videoEl.pause()
      videoEl.remove()
      videoEl = null
    }
    // NON rilasciamo lo stream globale qui: viene gestito da stopScanner()
  }

  try {
    const stream = await getStream()

    videoEl = createVideoInContainer(container)
    await startVideo(videoEl, stream)

    const native   = await getNativeDetector()
    const zxReader = native ? null : await getZxingReader()

    if (!native && !zxReader) {
      onError?.(new Error('Libreria barcode non disponibile su questo browser.'))
      stop()
      return stop
    }

    // Su iOS senza BarcodeDetector, aspetta un frame in più per sicurezza
    if (isIOS() && !native) {
      await new Promise(r => setTimeout(r, 200))
    }

    let lastDecodeTime = 0
    // Intervallo di decodifica: 200ms su iOS (più conservativo), 120ms altrove
    const DECODE_INTERVAL = isIOS() ? 200 : 120

    const tick = async (now: number) => {
      if (stopped) return
      rafId = requestAnimationFrame(tick)

      if (now - lastDecodeTime < DECODE_INTERVAL) return
      lastDecodeTime = now

      if (!videoEl || videoEl.videoWidth === 0) return

      try {
        let code: string | null = null
        if (native) {
          const hits = await native.detect(videoEl)
          code = hits[0]?.rawValue ?? null
        } else if (zxReader) {
          code = await decodeWithZxing(videoEl, zxReader)
        }
        if (code && !stopped) {
          stop()
          onDetect(code)
        }
      } catch { /* frame non decodificabile */ }
    }

    rafId = requestAnimationFrame(tick)

  } catch (e) {
    stop()
    onError?.(e as Error)
  }

  return stop
}

export function stopScanner() {
  releaseStream()
  offscreenCanvas = null
  offscreenCtx    = null
}

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
  name: '', brand: '', category: '', imageUrl: '', barcode, found: false,
  weightValue: null, weightUnit: null,
})

type OFFHost = 'world.openfoodfacts' | 'world.openbeautyfacts' | 'world.openpetfoodfacts' | 'world.openproductsfacts'

async function fetchOpenFacts(barcode: string, host: OFFHost, sourceName: string): Promise<ProductInfo | null> {
  try {
    const res = await fetch(
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
      name,
      brand:       (p.brands || '').split(',')[0].trim(),
      category:    catTag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' '),
      imageUrl:    p.image_front_small_url || '',
      barcode,
      found:       true,
      weightValue,
      weightUnit,
      source:      sourceName,
    }
  } catch { return null }
}

async function fetchUpcItemDb(barcode: string): Promise<ProductInfo | null> {
  try {
    const res = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`,
      { signal: AbortSignal.timeout(7000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const item = data?.items?.[0]
    if (!item) return null
    const wm = (item.title ?? '').toLowerCase().match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl|mg)\b/)
    return {
      name:        item.title  || '',
      brand:       item.brand  || '',
      category:    item.category || '',
      imageUrl:    item.images?.[0] || '',
      barcode,
      found:       true,
      weightValue: wm ? parseFloat(wm[1]) : null,
      weightUnit:  wm ? wm[2] : null,
      source:      'upc',
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
