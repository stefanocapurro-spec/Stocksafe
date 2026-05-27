/**
 * StockSafe – Barcode Scanner v9
 *
 * Fix critico iOS: getUserMedia e video.play() DEVONO essere chiamati nella
 * stessa catena microtask del gesto utente (click). setTimeout() rompe questo
 * contesto su iOS → camera nera. La soluzione è:
 *   1. getStream() esportata e chiamata DAL COMPONENTE prima di setScanning(true)
 *   2. startScanner() riceve lo stream già pronto (nessuna chiamata getUserMedia interna)
 *   3. Nessun setTimeout() nel percorso critico
 *
 * Architettura display:
 *   - <video> iniettato VISIBILE nel container (fix iOS PWA black screen)
 *   - BarcodeDetector nativo (Chrome/Android/Edge) → detect() sul video
 *   - ZXing fallback → canvas offscreen (mai nel DOM)
 */

// ── Rilevamento piattaforma ───────────────────────────────────────────────────

export function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

// ── Stream ────────────────────────────────────────────────────────────────────
//
// Su iOS PWA (standalone), cachedStream.active rimane true anche dopo che
// WebKit ha smontato internamente la pipeline video → stream "zombie" → nero.
// Fix: su iOS non caching mai; su altri browser caching OK.

let cachedStream: MediaStream | null = null

function isIOSPWA(): boolean {
  return isIOS() && (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** Chiamata DIRETTAMENTE nell'handler onClick — mai dentro setTimeout. */
export async function getStream(): Promise<MediaStream> {
  // Su iOS PWA: release sempre prima di riacquisire (evita stream zombie)
  if (isIOSPWA()) {
    releaseStream()
  } else if (cachedStream?.active) {
    return cachedStream
  }

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

// ── Crea video VISIBILE nel container ────────────────────────────────────────
//
// Il video deve avere dimensioni > 0 nel render tree per iOS.
// Non usare display:none, visibility:hidden, o posizione fuori schermo.

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

  // play() su video muted + playsInline non richiede gesto utente su iOS
  try { await video.play() } catch { /* gestito sotto */ }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(
        'Fotocamera non disponibile.\n' +
        'Su iPhone/iPad: Impostazioni → Safari → Fotocamera → Consenti\n' +
        '(oppure Impostazioni → Privacy → Fotocamera se usi la PWA)'
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
      reject(new Error('Errore stream video. Riprova o ricarica la pagina.'))
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

// ── ZXing su canvas offscreen ─────────────────────────────────────────────────

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

let offscreenCanvas: HTMLCanvasElement | null = null
let offscreenCtx:    CanvasRenderingContext2D | null = null

function getOffscreen(w: number, h: number) {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas')
    offscreenCtx    = offscreenCanvas.getContext('2d')!
  }
  if (offscreenCanvas.width  !== w) offscreenCanvas.width  = w
  if (offscreenCanvas.height !== h) offscreenCanvas.height = h
  return { canvas: offscreenCanvas, ctx: offscreenCtx! }
}

async function decodeWithZxing(video: HTMLVideoElement, reader: ZXingReader): Promise<string | null> {
  const w = video.videoWidth, h = video.videoHeight
  if (!w || !h) return null
  try {
    const { canvas, ctx } = getOffscreen(w, h)
    ctx.drawImage(video, 0, 0, w, h)
    const zx     = await import('@zxing/library')
    const source = new zx.HTMLCanvasElementLuminanceSource(canvas)
    const bmp    = new zx.BinaryBitmap(new zx.HybridBinarizer(source))
    return reader.decode(bmp)?.getText() ?? null
  } catch {
    return null
  }
}

// ── Scanner principale ────────────────────────────────────────────────────────
//
// NOTA: lo stream viene passato già pronto dal componente.
// Questo garantisce che getUserMedia sia stato chiamato nel gesto utente.

export async function startScanner(
  container: HTMLDivElement,
  stream: MediaStream,
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
      videoEl.pause()
      videoEl.srcObject = null
      videoEl.remove()
      videoEl = null
    }
  }

  try {
    videoEl = createVideoInContainer(container)
    await startVideo(videoEl, stream)

    const native   = await getNativeDetector()
    const zxReader = native ? null : await getZxingReader()

    if (!native && !zxReader) {
      onError?.(new Error('Libreria barcode non disponibile su questo browser.'))
      stop()
      return stop
    }

    let lastDecodeTime = 0
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
      brand:    (p.brands || '').split(',')[0].trim(),
      category: catTag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' '),
      imageUrl: p.image_front_small_url || '',
      barcode, found: true, weightValue, weightUnit, source: sourceName,
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
      name:        item.title    || '',
      brand:       item.brand    || '',
      category:    item.category || '',
      imageUrl:    item.images?.[0] || '',
      barcode, found: true,
      weightValue: wm ? parseFloat(wm[1]) : null,
      weightUnit:  wm ? wm[2] : null,
      source: 'upc',
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
