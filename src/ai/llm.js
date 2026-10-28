// IA locale di Brumoth, l'assistente di Dollaroni: un piccolo modello linguistico che gira dentro il browser
// (llama.cpp compilato in WebAssembly, libreria wllama in vendor/). Niente server, niente account, niente costi.
//
// - Il modello si scarica UNA volta da Hugging Face e resta nella memoria del browser (OPFS) di questo PC:
//   alle aperture successive si carica dal disco, anche senza internet.
// - Funziona con la sola CPU (tutti i PC); se il browser ha WebGPU usa anche la scheda video.
// - Usa più core solo se la pagina è "cross-origin isolated" (header COOP/COEP: li mettono
//   tools/devserver.py in locale e sw.js sul sito pubblicato); altrimenti va con un core solo, più lenta.
// - Non calcola niente: riceve i fatti dal motore (src/engine/assistant.js) e li mette in parole.

import { Wllama, ModelManager } from '../../vendor/wllama-3.8.1/index.js';

const WASM_URL = new URL('../../vendor/wllama-3.8.1/wllama.wasm', import.meta.url).href;
const SETTINGS_KEY = 'dollaroni.ai.v1';

// Brumoth ha due modalità, scelte dal menu a tendina della chat:
// - Istantaneo: risponde il motore di Dollaroni con i dati calcolati (subito, numeri esatti, niente IA);
// - Completo: la stessa risposta viene riscritta a parole dall'IA locale, che ci mette il tempo che serve.
//
// Modelli (Apache 2.0, buon italiano). I candidati si provano in ordine: il primo repository che esiste
// e ha il file Q4_K_M viene usato e ricordato. Misure su un portatile Intel di 9ª generazione (ott. 2026):
// Qwen3 0,6B con la scheda video ~25 s a risposta, solo CPU ~80 s; Qwen3.5 2B solo CPU 2-4 minuti.
// Il 2B e il Qwen3 1,7B con WebGPU su schede video integrate Intel si bloccano: per loro la scheda video
// resta spenta, salvo che la si accenda dalle impostazioni.
export const MODES = {
  instant: { id: 'instant', label: 'Istantaneo', icon: 'bolt', desc: 'Risposte subito, calcolate dai dati dell\'app. Numeri sempre esatti.' },
  full: { id: 'full', label: 'Completo', icon: 'sparkle', desc: "Brumoth ragiona con l'IA locale e risponde a parole sue. Più lento: da mezzo minuto a qualche minuto." },
};

export const MODELS = {
  leggero: {
    id: 'leggero', label: 'Leggera', name: 'Qwen3 0,6B',
    desc: 'più veloce (soprattutto con la scheda video), ma sbaglia più spesso: controlla i numeri',
    approxGB: 0.4, gpu: true,
    candidates: [
      { repo: 'unsloth/Qwen3-0.6B-GGUF', quant: 'Q4_K_M' },
      { repo: 'bartowski/Qwen_Qwen3-0.6B-GGUF', quant: 'Q4_K_M' },
    ],
  },
  standard: {
    id: 'standard', label: 'Standard', name: 'Qwen3.5 2B',
    desc: 'risposte scritte meglio e più affidabili, ma lenta: anche qualche minuto sui portatili',
    approxGB: 1.3, gpu: false,
    candidates: [
      { repo: 'unsloth/Qwen3.5-2B-GGUF', quant: 'Q4_K_M' },
      { repo: 'bartowski/Qwen_Qwen3.5-2B-GGUF', quant: 'Q4_K_M' },
      { repo: 'unsloth/Qwen3-1.7B-GGUF', quant: 'Q4_K_M' },
    ],
  },
};

/** Modello consigliato per la modalità Completa (deviceMemory nei browser arriva al massimo a 8). */
export function recommendedModel() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 2;
  return mem >= 8 && cores >= 4 ? 'standard' : 'leggero';
}

const DEFAULTS = { mode: 'instant', model: null, gpu: 'auto', autoDownload: true, resolved: {}, gpuFailed: {}, tps: null, threads: null };

export function loadSettings() {
  let s;
  try {
    s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    s = { ...DEFAULTS };
  }
  if (!MODES[s.mode]) s.mode = 'instant';
  if (s.model && !MODELS[s.model]) s.model = null;
  // file trovati per modelli che non sono più tra i candidati (es. il vecchio Qwen3.5 0,8B): si cercano di nuovo
  const resolved = {};
  for (const [id, r] of Object.entries(s.resolved || {})) {
    if (MODELS[id]?.candidates.some((c) => c.repo === r?.repo)) resolved[id] = r;
  }
  s.resolved = resolved;
  delete s.enabled;
  // scheda video che ha dato errore, per modello (prima era un sì/no unico: si riparte da zero)
  if (!s.gpuFailed || typeof s.gpuFailed !== 'object') s.gpuFailed = {};
  return s;
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage non disponibile */ }
}

/** Info sul browser utili per capire la velocità. */
export function environment() {
  return {
    isolated: Boolean(globalThis.crossOriginIsolated),
    webgpu: Boolean(navigator.gpu),
    cores: navigator.hardwareConcurrency || 1,
    memoryGB: navigator.deviceMemory || null,
    saveData: Boolean(navigator.connection?.saveData),
  };
}

/** Batteria del portatile: {charging, level} oppure null se il browser non lo dice. */
export async function batteryInfo() {
  try {
    const b = await navigator.getBattery?.();
    return b ? { charging: b.charging, level: b.level } : null;
  } catch {
    return null;
  }
}

/** Trova il file GGUF su Hugging Face: {url, size, repo, file}. */
async function resolveModel(model, signal) {
  const errors = [];
  for (const c of model.candidates) {
    try {
      const r = await fetch(`https://huggingface.co/api/models/${c.repo}/tree/main?recursive=true`, { signal, headers: { Accept: 'application/json' } });
      if (!r.ok) { errors.push(`${c.repo}: ${r.status}`); continue; }
      const files = await r.json();
      const ggufs = files.filter((f) => f.type === 'file' && /\.gguf$/i.test(f.path) && !/mmproj/i.test(f.path));
      const hit = ggufs.find((f) => f.path.toUpperCase().includes(c.quant));
      if (!hit) { errors.push(`${c.repo}: manca ${c.quant}`); continue; }
      return { url: `https://huggingface.co/${c.repo}/resolve/main/${hit.path}`, size: hit.lfs?.size || hit.size || 0, repo: c.repo, file: hit.path };
    } catch (e) {
      if (signal?.aborted) throw e;
      errors.push(`${c.repo}: ${e.message}`);
    }
  }
  throw new Error(`Non trovo il modello su Hugging Face (${errors.join('; ')}). Serve internet per il primo download.`);
}

const quietLogger = { debug() {}, log() {}, info() {}, warn: (...a) => console.warn('[IA]', ...a), error: (...a) => console.error('[IA]', ...a) };

/**
 * Stato dell'IA, osservabile: subscribe(fn) riceve {status, progress, info, error}.
 * status: 'idle' (non scaricata) | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'busy' | 'error'
 */
class LocalAI {
  constructor() {
    this.settings = loadSettings();
    this.state = { status: 'idle', progress: null, info: null, error: null };
    this.listeners = new Set();
    this.wllama = null;
    this.loaded = null; // id del modello caricato in memoria
    this.queue = Promise.resolve();
    this.downloadCtl = null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
  set(patch) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }
  updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.set({});
  }
  get modelId() {
    return this.settings.model || recommendedModel();
  }
  get model() {
    return MODELS[this.modelId];
  }
  markGpuFailed(id = this.modelId) {
    this.updateSettings({ gpuFailed: { ...this.settings.gpuFailed, [id]: true } });
  }
  /** Scheda video: 'on'/'off' scelti dall'utente, altrimenti dipende dal modello (vedi MODELS). */
  gpuWanted(id = this.modelId) {
    if (this.settings.gpuFailed?.[id]) return false;
    if (this.settings.gpu === 'on') return true;
    if (this.settings.gpu === 'off') return false;
    return Boolean(MODELS[id]?.gpu);
  }

  /** Il modello scelto è già sul disco (cache del browser)? */
  async isDownloaded(id = this.modelId) {
    const url = this.settings.resolved?.[id]?.url;
    if (!url) return false;
    try {
      const models = await new ModelManager({ logger: quietLogger }).getModels();
      return models.some((m) => m.url === url);
    } catch {
      return false;
    }
  }

  /** Controlla lo stato all'avvio, ed eventualmente fa partire il download automatico. */
  async init({ autoStart = true } = {}) {
    if (['downloading', 'loading', 'ready', 'busy'].includes(this.state.status)) return;
    const done = await this.isDownloaded();
    this.set({ status: done ? 'downloaded' : 'idle' });
    // il download automatico parte solo se si usa la modalità Completa
    if (!done && autoStart && this.settings.mode === 'full' && this.settings.autoDownload && !environment().saveData) this.download().catch(() => {});
  }

  /** Scarica il modello (senza caricarlo in memoria). Una sola scheda alla volta scarica (Web Locks). */
  download() {
    if (this.downloadPromise) return this.downloadPromise; // già in corso in questa scheda
    if (['downloading', 'loading', 'ready', 'busy'].includes(this.state.status)) return Promise.resolve();
    const run = () => this.downloadNow();
    const locks = navigator.locks;
    this.downloadPromise = locks
      ? locks.request('dollaroni-ai-download', { ifAvailable: true }, (lock) => {
        if (!lock) {
          this.set({ status: 'error', error: "Il modello si sta già scaricando in un'altra scheda di Dollaroni: lascialo finire lì oppure chiudi quella scheda e riprova." });
          return undefined;
        }
        return run();
      })
      : run();
    this.downloadPromise = this.downloadPromise.finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }

  async downloadNow() {
    const model = this.model;
    this.downloadCtl = new AbortController();
    const signal = this.downloadCtl.signal;
    this.set({ status: 'downloading', progress: { loaded: 0, total: model.approxGB * 1e9 }, error: null });
    try {
      try { await navigator.storage?.persist?.(); } catch { /* facoltativo */ }
      let res = this.settings.resolved?.[model.id];
      if (!res) {
        res = await resolveModel(model, signal);
        this.updateSettings({ resolved: { ...this.settings.resolved, [model.id]: res } });
      }
      const mm = new ModelManager({ logger: quietLogger });
      const cached = (await mm.getModels()).find((m) => m.url === res.url);
      if (!cached) {
        const options = { signal, progressCallback: ({ loaded, total }) => this.set({ progress: { loaded, total: total || res.size } }) };
        try {
          await mm.downloadModel(res.url, options);
        } catch (e) {
          // un pezzo di download precedente ancora aperto blocca il file: si aspetta un attimo e si riprova una volta
          if (!isLocked(e) || signal.aborted) throw e;
          await new Promise((r) => setTimeout(r, 2500));
          await mm.downloadModel(res.url, options);
        }
      }
      this.set({ status: 'downloaded', progress: null });
    } catch (e) {
      const aborted = signal.aborted;
      this.set({ status: aborted ? 'idle' : 'error', progress: null, error: aborted ? null : friendlyError(e) });
      if (!aborted) throw e;
    } finally {
      this.downloadCtl = null;
    }
  }

  /** Ferma il download in corso; la promessa finisce quando il download si è davvero fermato. */
  cancelDownload() {
    this.downloadCtl?.abort();
    return (this.downloadPromise || Promise.resolve()).catch(() => {});
  }

  /** Scarica (se serve) e carica il modello in memoria. */
  async ensureReady() {
    if (this.wllama && this.loaded === this.modelId) return;
    if (this.state.status === 'downloading') await this.waitFor(['downloaded', 'error', 'idle']);
    if (!(await this.isDownloaded())) await this.download();
    if (this.state.status === 'error') throw new Error(this.state.error);
    await this.load();
  }

  waitFor(statuses) {
    return new Promise((resolve) => {
      const off = this.subscribe((s) => {
        if (statuses.includes(s.status)) { queueMicrotask(() => off()); resolve(s.status); }
      });
    });
  }

  async load() {
    await this.unload();
    const res = this.settings.resolved[this.modelId];
    const env = environment();
    const tryLoad = async (gpu) => {
      const w = new Wllama({ default: WASM_URL }, { allowOffline: true, logger: quietLogger, suppressNativeLog: true });
      const params = { n_ctx: 4096, n_parallel: 1, useCache: true };
      if (this.settings.threads) params.n_threads = this.settings.threads; // di solito si lascia decidere a wllama (metà dei core logici)
      if (!gpu) params.n_gpu_layers = 0;
      await w.loadModelFromUrl(res.url, params);
      return w;
    };
    this.set({ status: 'loading', error: null });
    const wantGpu = env.webgpu && this.gpuWanted();
    let gpu = wantGpu;
    try {
      try {
        this.wllama = await tryLoad(gpu);
      } catch (e) {
        if (!gpu) throw e;
        console.warn('[IA] WebGPU non va, passo alla CPU:', e);
        this.markGpuFailed();
        gpu = false;
        this.wllama = await tryLoad(false);
      }
      this.loaded = this.modelId;
      this.set({
        status: 'ready',
        info: { model: modelLabel(res.file) || this.model.name, file: res.file, gpu, threads: this.wllama.getNumThreads(), multithread: this.wllama.isMultithread(), isolated: env.isolated },
      });
    } catch (e) {
      this.wllama = null;
      this.loaded = null;
      this.set({ status: 'error', error: friendlyError(e) });
      throw e;
    }
  }

  async unload() {
    const w = this.wllama;
    this.wllama = null;
    this.loaded = null;
    this.warmed = null;
    if (w) { try { await w.exit(); } catch { /* già chiuso */ } }
  }

  /** Cancella il modello scelto dal disco. */
  async remove(id = this.modelId) {
    if (this.loaded === id) await this.unload();
    const url = this.settings.resolved?.[id]?.url;
    if (url) {
      const mm = new ModelManager({ logger: quietLogger });
      for (const m of await mm.getModels({ includeInvalid: true })) if (m.url === url) await m.remove();
    }
    this.set({ status: 'idle', info: null });
  }

  /**
   * Prepara Brumoth per la modalità Completa: scarica (se serve), carica il modello e legge una volta
   * le istruzioni (systemPrompt). Il motore tiene in memoria quel pezzo già letto, così a ogni domanda
   * legge solo i dati e la domanda.
   */
  prepare(systemPrompt) {
    if (this.preparing) return this.preparing;
    const run = async () => {
      await this.ensureReady();
      if (!systemPrompt || this.warmed === this.loaded) return;
      this.set({ status: 'loading' });
      try {
        await this.wllama.createChatCompletion({
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'ciao' }],
          max_tokens: 1, temperature: 0, chat_template_kwargs: { enable_thinking: false },
        });
        this.warmed = this.loaded;
      } finally {
        this.set({ status: this.wllama ? 'ready' : 'downloaded' });
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    this.preparing = p.finally(() => { this.preparing = null; });
    return this.preparing;
  }

  /**
   * Risposta in streaming. onText(testoFinora) a ogni pezzo. Le richieste passano una alla volta.
   * Ritorna {text, tokens, seconds}.
   */
  chat(messages, { onText, signal, maxTokens = 450 } = {}) {
    const attempt = async () => {
      await this.ensureReady();
      this.set({ status: 'busy' });
      const t0 = performance.now();
      let first = null;
      let text = '';
      let tokens = 0;
      try {
        const stream = await this.wllama.createChatCompletion({
          messages, stream: true, max_tokens: maxTokens,
          temperature: 0.2, top_p: 0.9, top_k: 40, penalty_repeat: 1.05,
          chat_template_kwargs: { enable_thinking: false },
          abortSignal: signal,
        });
        for await (const chunk of stream) {
          const d = chunk.choices?.[0]?.delta?.content;
          if (!d) continue;
          first ??= performance.now();
          tokens += 1;
          text += d;
          onText?.(cleanReply(text));
        }
      } catch (e) {
        if (signal?.aborted || e?.name === 'WllamaAbortError' || e?.name === 'AbortError') { /* fermata dall'utente */ } else throw e;
      }
      const gen = first ? (performance.now() - first) / 1000 : 0;
      const tps = gen > 0.2 ? tokens / gen : null;
      if (tps) this.updateSettings({ tps: Math.round(tps * 10) / 10 });
      this.set({ status: 'ready' });
      return { text: cleanReply(text), tokens, seconds: (performance.now() - t0) / 1000 };
    };
    const run = async () => {
      try {
        return await attempt();
      } catch (e) {
        // il motore si è bloccato (memoria, scheda video persa…): si ricarica, senza scheda video se la usava, e si riprova una volta
        if (!isCrash(e) || signal?.aborted) {
          this.set({ status: this.wllama ? 'ready' : 'downloaded', error: friendlyError(e) });
          throw e;
        }
        console.warn('[IA] il motore si è bloccato, lo riavvio:', e);
        if (this.state.info?.gpu) this.markGpuFailed();
        await this.unload();
        this.set({ status: 'downloaded' });
        try {
          return await attempt();
        } catch (e2) {
          await this.unload();
          this.set({ status: 'downloaded', error: friendlyError(e2) });
          throw e2;
        }
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Risposta breve non in streaming (es. scegliere l'argomento di una domanda con una parola). */
  complete(messages, { signal, maxTokens = 12 } = {}) {
    const run = async () => {
      await this.ensureReady();
      this.set({ status: 'busy' });
      try {
        const r = await this.wllama.createChatCompletion({
          messages, max_tokens: maxTokens, temperature: 0, top_k: 1,
          chat_template_kwargs: { enable_thinking: false },
          abortSignal: signal,
        });
        return cleanReply(r.choices?.[0]?.message?.content || '');
      } finally {
        this.set({ status: this.wllama ? 'ready' : 'downloaded' });
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}

/** "Qwen3.5-0.8B-Q4_K_M.gguf" -> "Qwen3.5-0.8B". */
const modelLabel = (file) => String(file || '').split('/').pop().replace(/\.gguf$/i, '').replace(/^[A-Za-z]+_(?=[A-Z])/, '').replace(/[-_.](Q\d|IQ\d|F16|BF16).*$/i, '');

/** Toglie eventuali ragionamenti <think>…</think> e spazi in eccesso. */
export function cleanReply(text) {
  return String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');
}

/** Il motore WebAssembly si è fermato e va ricaricato. */
const isCrash = (e) => e?.name === 'WllamaRuntimeError' || /crashed|reload the module|RuntimeError|unreachable|out of bounds|device (was )?lost|gpu|webgpu|out of memory/i.test(String(e?.message || e));

const isLocked = (e) => e?.name === 'NoModificationAllowedError' || /modifications are not allowed|NoModificationAllowed/i.test(String(e?.message));

function friendlyError(e) {
  const m = String(e?.message || e);
  if (isLocked(e)) return "Il file del modello è bloccato da un download rimasto a metà o da un'altra scheda di Dollaroni. Chiudi le altre schede di Dollaroni, ricarica questa pagina (F5) e premi di nuovo «Scarica ora».";
  if (/quota|QuotaExceeded/i.test(m)) return 'Spazio su disco del browser insufficiente per il modello.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Download non riuscito: controlla la connessione e riprova.';
  if (/memory|OOM|allocate/i.test(m)) return 'Memoria insufficiente: nelle impostazioni prova il modello Leggero.';
  if (/crashed|reload the module/i.test(m)) return "Il motore dell'IA si è bloccato anche dopo il riavvio: ricarica la pagina (F5); se succede ancora, nelle impostazioni prova il modello Leggero o usa la modalità Istantanea.";
  return m.length > 220 ? `${m.slice(0, 220)}…` : m;
}

export const localAI = new LocalAI();
