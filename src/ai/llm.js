// Local AI of Brumoth, the Dollaroni assistant: a small language model that runs inside the browser
// (llama.cpp compiled to WebAssembly, the wllama library in vendor/). No server, no account, no costs.
//
// - The model is downloaded ONCE from Hugging Face and stays in this PC's browser storage (OPFS):
//   on later openings it loads from disk, even offline.
// - It works with the CPU alone (all PCs); if the browser has WebGPU it also uses the graphics card.
// - It uses several cores only if the page is "cross-origin isolated" (COOP/COEP headers, set by
//   tools/devserver.py locally and sw.js on the published site); otherwise it runs on one core, more slowly.
// - It calculates nothing: it receives the facts from the engine (src/engine/assistant.js) and puts them in words.

import { Wllama, ModelManager } from '../../vendor/wllama-3.8.1/index.js';

const WASM_URL = new URL('../../vendor/wllama-3.8.1/wllama.wasm', import.meta.url).href;
const SETTINGS_KEY = 'dollaroni.ai.v1';

// Brumoth has two modes, chosen from the chat drop-down menu:
// - Instant: the Dollaroni engine answers with the calculated data (immediately, exact numbers, no AI);
// - Complete: the same answer is rewritten in words by the local AI, taking as long as it needs.
//
// Models (Apache 2.0). Candidates are tried in order: the first repository that exists
// and has the Q4_K_M file is used and remembered. Measurements on a 9th-generation Intel laptop (Oct 2026):
// Qwen3 0.6B with the graphics card ~25 s per answer, CPU only ~80 s; Qwen3.5 2B CPU only 2-4 minutes.
// The 2B and Qwen3 1.7B hang with WebGPU on integrated Intel graphics: for them the graphics card
// stays off, unless it is turned on from the settings.
export const MODES = {
  instant: { id: 'instant', label: 'Instant', icon: 'bolt', desc: 'Immediate answers, calculated from the app data. Numbers always exact.' },
  full: { id: 'full', label: 'Complete', icon: 'sparkle', desc: "Brumoth reasons with the local AI and answers in its own words. Slower: from half a minute to a few minutes." },
};

export const MODELS = {
  leggero: {
    id: 'leggero', label: 'Light', name: 'Qwen3 0,6B',
    desc: 'faster (especially with a graphics card), but wrong more often: check the numbers',
    approxGB: 0.4, gpu: true,
    candidates: [
      { repo: 'unsloth/Qwen3-0.6B-GGUF', quant: 'Q4_K_M' },
      { repo: 'bartowski/Qwen_Qwen3-0.6B-GGUF', quant: 'Q4_K_M' },
    ],
  },
  standard: {
    id: 'standard', label: 'Standard', name: 'Qwen3.5 2B',
    desc: 'better written and more reliable answers, but slow: even a few minutes on laptops',
    approxGB: 1.3, gpu: false,
    candidates: [
      { repo: 'unsloth/Qwen3.5-2B-GGUF', quant: 'Q4_K_M' },
      { repo: 'bartowski/Qwen_Qwen3.5-2B-GGUF', quant: 'Q4_K_M' },
      { repo: 'unsloth/Qwen3-1.7B-GGUF', quant: 'Q4_K_M' },
    ],
  },
};

/** Recommended model for Complete mode (deviceMemory in browsers reaches at most 8). */
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
  // files found for models no longer among the candidates (e.g. the old Qwen3.5 0.8B): searched for again
  const resolved = {};
  for (const [id, r] of Object.entries(s.resolved || {})) {
    if (MODELS[id]?.candidates.some((c) => c.repo === r?.repo)) resolved[id] = r;
  }
  s.resolved = resolved;
  delete s.enabled;
  // graphics card that gave an error, per model (it used to be a single yes/no: starting over)
  if (!s.gpuFailed || typeof s.gpuFailed !== 'object') s.gpuFailed = {};
  return s;
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage not available */ }
}

/** Browser info useful for understanding the speed. */
export function environment() {
  return {
    isolated: Boolean(globalThis.crossOriginIsolated),
    webgpu: Boolean(navigator.gpu),
    cores: navigator.hardwareConcurrency || 1,
    memoryGB: navigator.deviceMemory || null,
    saveData: Boolean(navigator.connection?.saveData),
  };
}

/** Laptop battery: {charging, level} or null if the browser does not say. */
export async function batteryInfo() {
  try {
    const b = await navigator.getBattery?.();
    return b ? { charging: b.charging, level: b.level } : null;
  } catch {
    return null;
  }
}

/** Finds the GGUF file on Hugging Face: {url, size, repo, file}. */
async function resolveModel(model, signal) {
  const errors = [];
  for (const c of model.candidates) {
    try {
      const r = await fetch(`https://huggingface.co/api/models/${c.repo}/tree/main?recursive=true`, { signal, headers: { Accept: 'application/json' } });
      if (!r.ok) { errors.push(`${c.repo}: ${r.status}`); continue; }
      const files = await r.json();
      const ggufs = files.filter((f) => f.type === 'file' && /\.gguf$/i.test(f.path) && !/mmproj/i.test(f.path));
      const hit = ggufs.find((f) => f.path.toUpperCase().includes(c.quant));
      if (!hit) { errors.push(`${c.repo}: missing ${c.quant}`); continue; }
      return { url: `https://huggingface.co/${c.repo}/resolve/main/${hit.path}`, size: hit.lfs?.size || hit.size || 0, repo: c.repo, file: hit.path };
    } catch (e) {
      if (signal?.aborted) throw e;
      errors.push(`${c.repo}: ${e.message}`);
    }
  }
  throw new Error(`Cannot find the model on Hugging Face (${errors.join('; ')}). Internet is needed for the first download.`);
}

const quietLogger = { debug() {}, log() {}, info() {}, warn: (...a) => console.warn('[AI]', ...a), error: (...a) => console.error('[AI]', ...a) };

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
    this.loaded = null; // id of the model loaded in memory
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
  /** Graphics card: 'on'/'off' chosen by the user, otherwise depends on the model (see MODELS). */
  gpuWanted(id = this.modelId) {
    if (this.settings.gpuFailed?.[id]) return false;
    if (this.settings.gpu === 'on') return true;
    if (this.settings.gpu === 'off') return false;
    return Boolean(MODELS[id]?.gpu);
  }

  /** Is the chosen model already on disk (browser cache)? */
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

  /** Checks the state at start-up, and possibly starts the automatic download. */
  async init({ autoStart = true } = {}) {
    if (['downloading', 'loading', 'ready', 'busy'].includes(this.state.status)) return;
    const done = await this.isDownloaded();
    this.set({ status: done ? 'downloaded' : 'idle' });
    // the automatic download starts only if Complete mode is in use
    if (!done && autoStart && this.settings.mode === 'full' && this.settings.autoDownload && !environment().saveData) this.download().catch(() => {});
  }

  /** Downloads the model (without loading it into memory). Only one tab at a time downloads (Web Locks). */
  download() {
    if (this.downloadPromise) return this.downloadPromise; // already running in this tab
    if (['downloading', 'loading', 'ready', 'busy'].includes(this.state.status)) return Promise.resolve();
    const run = () => this.downloadNow();
    const locks = navigator.locks;
    this.downloadPromise = locks
      ? locks.request('dollaroni-ai-download', { ifAvailable: true }, (lock) => {
        if (!lock) {
          this.set({ status: 'error', error: "The model is already being downloaded in another Dollaroni tab: let it finish there or close that tab and try again." });
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
          // a piece of an earlier download still open locks the file: wait a moment and try again once
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

  /** Stops the current download; the promise ends when the download has really stopped. */
  cancelDownload() {
    this.downloadCtl?.abort();
    return (this.downloadPromise || Promise.resolve()).catch(() => {});
  }

  /** Downloads (if needed) and loads the model into memory. */
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
      if (this.settings.threads) params.n_threads = this.settings.threads; // usually left to wllama to decide (half of the logical cores)
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
        console.warn('[AI] WebGPU does not work, switching to the CPU:', e);
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
    if (w) { try { await w.exit(); } catch { /* already closed */ } }
  }

  /** Deletes the chosen model from disk. */
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
   * Prepares Brumoth for Complete mode: downloads (if needed), loads the model and reads the
   * instructions once (systemPrompt). The engine keeps that already-read part in memory, so for each question
   * it reads only the data and the question.
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
   * Streaming answer. onText(textSoFar) for each piece. Requests go through one at a time.
   * Returns {text, tokens, seconds}.
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
        if (signal?.aborted || e?.name === 'WllamaAbortError' || e?.name === 'AbortError') { /* stopped by the user */ } else throw e;
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
        // the engine has hung (memory, lost graphics card…): reload, without the graphics card if it was using it, and try again once
        if (!isCrash(e) || signal?.aborted) {
          this.set({ status: this.wllama ? 'ready' : 'downloaded', error: friendlyError(e) });
          throw e;
        }
        console.warn('[AI] the engine has hung, restarting it:', e);
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

  /** Short non-streaming answer (e.g. choosing the topic of a question with one word). */
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

/** Removes any <think>…</think> reasoning and excess spaces. */
export function cleanReply(text) {
  return String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');
}

/** The WebAssembly engine has stopped and must be reloaded. */
const isCrash = (e) => e?.name === 'WllamaRuntimeError' || /crashed|reload the module|RuntimeError|unreachable|out of bounds|device (was )?lost|gpu|webgpu|out of memory/i.test(String(e?.message || e));

const isLocked = (e) => e?.name === 'NoModificationAllowedError' || /modifications are not allowed|NoModificationAllowed/i.test(String(e?.message));

function friendlyError(e) {
  const m = String(e?.message || e);
  if (isLocked(e)) return "The model file is locked by a half-finished download or by another Dollaroni tab. Close the other Dollaroni tabs, reload this page (F5) and press «Download now» again.";
  if (/quota|QuotaExceeded/i.test(m)) return 'Not enough browser disk space for the model.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Download failed: check the connection and try again.';
  if (/memory|OOM|allocate/i.test(m)) return 'Not enough memory: in the settings try the Light model.';
  if (/crashed|reload the module/i.test(m)) return "The AI engine hung even after restarting: reload the page (F5); if it happens again, in the settings try the Light model or use Instant mode.";
  return m.length > 220 ? `${m.slice(0, 220)}…` : m;
}

export const localAI = new LocalAI();
