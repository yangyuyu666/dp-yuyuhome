import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import confetti from 'canvas-confetti';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  Download,
  List,
  Plus,
  RotateCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  type RouletteConfig,
  type RouletteItem,
  type RouletteStore,
  DEFAULT_ITEMS,
  DEFAULT_TITLE,
  createConfig,
  downloadJson,
  exportConfigs,
  loadStore,
  makeId,
  normalizeItems,
  parseImportFile,
  saveStore,
} from './rouletteStore';

/* ───── constants ───── */

const WHEEL_COLORS = [
  '#FF6B6B', '#FFA502', '#FFD166', '#06D6A0', '#118AB2',
  '#8338EC', '#FF85A1', '#00C9A7', '#F77F00', '#7209B7',
];

const SVG_SIZE = 520;
const WHEEL_R = 240;
const CX = SVG_SIZE / 2;
const CY = SVG_SIZE / 2;

/* ───── SVG helpers ───── */

function polarToXY(deg: number, r: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function slicePath(s: number, e: number, r: number) {
  const a = polarToXY(s, r), b = polarToXY(e, r);
  return `M${CX},${CY} L${a.x},${a.y} A${r},${r} 0 ${e - s > 180 ? 1 : 0} 1 ${b.x},${b.y} Z`;
}

function truncText(t: string, max: number) {
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function normalizeDegrees(deg: number) {
  return ((deg % 360) + 360) % 360;
}

function rotationDeltaToPointer(currentRotation: number, targetAngle: number) {
  return normalizeDegrees(360 - normalizeDegrees(targetAngle) - normalizeDegrees(currentRotation));
}

function readableSliceTextRotation(sliceMidAngle: number, wheelRotation: number) {
  const visualMidAngle = normalizeDegrees(sliceMidAngle + wheelRotation);
  const readableScreenAngle =
    visualMidAngle > 90 && visualMidAngle < 270 ? visualMidAngle + 180 : visualMidAngle;

  return readableScreenAngle - wheelRotation;
}

/* ───── mini wheel for list cards ───── */

function MiniWheel({ items }: { items: RouletteItem[] }) {
  const active = normalizeItems(items);
  const n = active.length || 1;
  const angle = 360 / n;
  return (
    <svg viewBox="0 0 100 100" className="h-14 w-14 shrink-0 rounded-full shadow-sm border-2 border-white">
      {active.length > 0 ? active.map((_, i) => {
        const s = polarToXYMini(i * angle, 50), e = polarToXYMini((i + 1) * angle, 50);
        return (
          <path
            key={i}
            d={`M50,50 L${s.x},${s.y} A50,50 0 ${angle > 180 ? 1 : 0} 1 ${e.x},${e.y} Z`}
            fill={WHEEL_COLORS[i % WHEEL_COLORS.length]}
            stroke="white"
            strokeWidth="1"
          />
        );
      }) : <circle cx="50" cy="50" r="50" fill="#e2e8f0" />}
      <circle cx="50" cy="50" r="14" fill="white" />
    </svg>
  );
}

function polarToXYMini(deg: number, r: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) };
}

/* ───── main component ───── */

export default function RoulettePage() {
  const [store, setStore] = useState<RouletteStore | null>(null);
  const [view, setView] = useState<'list' | 'wheel'>('list');

  // wheel state
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [items, setItems] = useState<RouletteItem[]>(DEFAULT_ITEMS);
  const [newItem, setNewItem] = useState('');
  const [lastPicked, setLastPicked] = useState<string>();
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const spinTimer = useRef<number | null>(null);
  const activeIdRef = useRef('');

  // import/export state
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { document.title = '转盘'; }, []);

  // load store on mount
  useEffect(() => {
    const s = loadStore();
    setStore(s);
    // if only one config, go straight to wheel
    if (s.configs.length === 1) {
      openConfig(s, s.configs[0].id);
    }
  }, []);

  useEffect(() => () => { if (spinTimer.current) window.clearTimeout(spinTimer.current); }, []);

  const activeItems = useMemo(() => normalizeItems(items), [items]);
  const itemCount = activeItems.length;
  const sliceAngle = itemCount > 0 ? 360 / itemCount : 360;
  const normalizedRotation = normalizeDegrees(rotation);
  const maxTextLen = itemCount <= 6 ? 7 : itemCount <= 10 ? 5 : 4;

  /* ───── storage helpers ───── */

  function persistCurrent(s: RouletteStore, extra?: Partial<RouletteConfig>) {
    const updated: RouletteStore = {
      ...s,
      configs: s.configs.map((c) =>
        c.id === activeIdRef.current
          ? { ...c, title, items: normalizeItems(items), lastPicked, ...extra }
          : c,
      ),
    };
    setStore(updated);
    saveStore(updated);
    return updated;
  }

  function openConfig(s: RouletteStore, id: string) {
    const cfg = s.configs.find((c) => c.id === id);
    if (!cfg) return;
    activeIdRef.current = id;
    setTitle(cfg.title);
    setItems(cfg.items.length > 0 ? cfg.items : DEFAULT_ITEMS);
    setLastPicked(cfg.lastPicked);
    setRotation(0);
    setIsSpinning(false);
    setSaveState('idle');
    setNewItem('');
    setView('wheel');
    setStore({ ...s, activeId: id });
    saveStore({ ...s, activeId: id });
  }

  function handleCreate() {
    if (!store) return;
    const cfg = createConfig();
    const next: RouletteStore = { ...store, activeId: cfg.id, configs: [...store.configs, cfg] };
    setStore(next);
    saveStore(next);
    openConfig(next, cfg.id);
  }

  function handleDelete(id: string) {
    if (!store) return;
    const next: RouletteStore = {
      ...store,
      configs: store.configs.filter((c) => c.id !== id),
      activeId: store.activeId === id ? '' : store.activeId,
    };
    if (next.configs.length === 0) {
      const cfg = createConfig(DEFAULT_TITLE);
      cfg.items = DEFAULT_ITEMS;
      next.configs = [cfg];
      next.activeId = cfg.id;
    }
    setStore(next);
    saveStore(next);
    if (activeIdRef.current === id) {
      setView('list');
      activeIdRef.current = '';
    }
  }

  function handleBackToList() {
    if (store) persistCurrent(store);
    setView('list');
  }

  function handleSave() {
    if (!store) return;
    persistCurrent(store);
    setSaveState('saved');
    window.setTimeout(() => setSaveState('idle'), 1500);
  }

  /* ───── import / export ───── */

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleExport() {
    if (!store) return;
    const toExport = selectMode && selected.size > 0
      ? store.configs.filter((c) => selected.has(c.id))
      : store.configs;
    const json = exportConfigs(toExport);
    const name = toExport.length === 1 ? `${toExport[0].title}.json` : `转盘导出_${toExport.length}个.json`;
    downloadJson(json, name);
    setSelectMode(false);
    setSelected(new Set());
  }

  function handleImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const configs = parseImportFile(reader.result as string);
        if (configs.length === 0) throw new Error('文件中没有有效的转盘数据');
        if (!store) return;
        const next: RouletteStore = { ...store, configs: [...store.configs, ...configs] };
        setStore(next);
        saveStore(next);
        setImportMsg({ type: 'ok', text: `成功导入 ${configs.length} 个转盘` });
        window.setTimeout(() => setImportMsg(null), 3000);
      } catch (e) {
        setImportMsg({ type: 'err', text: e instanceof Error ? e.message : '导入失败，请检查文件格式' });
        window.setTimeout(() => setImportMsg(null), 4000);
      }
    };
    reader.readAsText(file);
  }

  /* ───── wheel actions ───── */

  const handleAddItem = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next = newItem.split('\n').map((t) => t.trim()).filter(Boolean).map((t) => ({ id: makeId(), text: t }));
    if (next.length === 0) return;
    setItems((cur) => normalizeItems([...cur, ...next]));
    setNewItem('');
    setSaveState('idle');
  };

  const spin = () => {
    if (isSpinning || itemCount === 0) return;
    const idx = Math.floor(Math.random() * itemCount);
    const target = idx * sliceAngle + sliceAngle / 2;
    const turns = 6 + Math.floor(Math.random() * 4);
    setIsSpinning(true);
    setRotation((currentRotation) => (
      currentRotation + turns * 360 + rotationDeltaToPointer(currentRotation, target)
    ));
    const picked = activeItems[idx].text;
    spinTimer.current = window.setTimeout(() => {
      setIsSpinning(false);
      setLastPicked(picked);
      if (store) persistCurrent(store, { lastPicked: picked });
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: WHEEL_COLORS.slice(0, 5) });
    }, 4500);
  };

  /* ───── render ───── */

  if (!store) return null;

  // ═══════════ LIST VIEW ═══════════
  if (view === 'list') {
    return (
      <div className="relative min-h-screen overflow-hidden bg-slate-50 font-sans text-stone-900">
        <div className="pointer-events-none absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-rose-300/30 to-pink-300/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-40 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-orange-200/40 to-amber-200/40 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-white/40 backdrop-blur-[50px]" />

        <header className="relative z-10 border-b border-white/40 bg-white/50 shadow-sm backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
            <a href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600 transition hover:text-rose-600">
              <ArrowLeft className="h-4 w-4" /> 回到小屋
            </a>
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-200/50 bg-rose-100/50 px-3 py-1.5 text-xs font-semibold text-rose-700">
              <Sparkles className="h-3.5 w-3.5" /> 转盘集合
            </div>
          </div>
        </header>

        <main className="relative z-10 mx-auto max-w-4xl px-6 py-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-stone-900">我的转盘</h1>
              <p className="mt-2 text-sm text-stone-500">共 {store.configs.length} 个转盘，数据保存在本地浏览器中</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectMode ? (
                <>
                  <button type="button" onClick={handleExport} disabled={selected.size === 0} className="inline-flex items-center gap-2 rounded-2xl bg-stone-900 px-4 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed">
                    <Download className="h-4 w-4" /> 导出选中 ({selected.size})
                  </button>
                  <button type="button" onClick={() => { setSelectMode(false); setSelected(new Set()); }} className="inline-flex items-center gap-2 rounded-2xl border border-stone-200/80 bg-white/60 px-4 py-2.5 text-sm font-bold text-stone-600 transition hover:bg-white">
                    <X className="h-4 w-4" /> 取消
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={handleCreate} className="inline-flex items-center gap-2 rounded-2xl bg-stone-900 px-4 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-stone-800">
                    <Plus className="h-4 w-4" /> 新建
                  </button>
                  <button type="button" onClick={() => { if (store) { downloadJson(exportConfigs(store.configs), `转盘导出_全部${store.configs.length}个.json`); } }} className="inline-flex items-center gap-2 rounded-2xl border border-stone-200/80 bg-white/60 px-4 py-2.5 text-sm font-bold text-stone-600 shadow-sm transition hover:bg-white">
                    <Download className="h-4 w-4" /> 导出全部
                  </button>
                  <button type="button" onClick={() => setSelectMode(true)} className="inline-flex items-center gap-2 rounded-2xl border border-stone-200/80 bg-white/60 px-4 py-2.5 text-sm font-bold text-stone-600 shadow-sm transition hover:bg-white">
                    <Check className="h-4 w-4" /> 选择导出
                  </button>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-stone-200/80 bg-white/60 px-4 py-2.5 text-sm font-bold text-stone-600 shadow-sm transition hover:bg-white">
                    <Upload className="h-4 w-4" /> 导入
                    <input ref={fileInputRef} type="file" accept=".json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.currentTarget.value = ''; }} />
                  </label>
                </>
              )}
            </div>
          </div>

          {importMsg && (
            <div className={`mb-6 rounded-2xl border p-4 text-center text-sm font-medium ${importMsg.type === 'ok' ? 'border-emerald-100 bg-emerald-50/80 text-emerald-700' : 'border-red-100 bg-red-50/80 text-red-600'}`}>
              {importMsg.text}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {store.configs.map((cfg) => {
              const count = normalizeItems(cfg.items).length;
              const isSelected = selected.has(cfg.id);
              return (
                <div
                  key={cfg.id}
                  onClick={() => selectMode ? toggleSelect(cfg.id) : openConfig(store, cfg.id)}
                  className={`group relative cursor-pointer rounded-3xl border p-5 shadow-lg backdrop-blur-xl transition-all hover:shadow-xl hover:-translate-y-1 ${
                    selectMode && isSelected
                      ? 'border-rose-400 bg-rose-50/60 ring-2 ring-rose-200'
                      : 'border-white/60 bg-white/60 hover:bg-white/90'
                  }`}
                >
                  {selectMode && (
                    <div className={`absolute left-3 top-3 grid h-7 w-7 place-items-center rounded-lg border-2 transition ${
                      isSelected ? 'border-rose-500 bg-rose-500 text-white' : 'border-stone-300 bg-white text-transparent'
                    }`}>
                      <Check className="h-4 w-4" />
                    </div>
                  )}
                  {!selectMode && (
                    <button
                      type="button"
                      aria-label="删除转盘"
                      onClick={(e) => { e.stopPropagation(); handleDelete(cfg.id); }}
                      className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-xl text-stone-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}

                  <div className="flex items-center gap-4">
                    <MiniWheel items={cfg.items} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-bold text-stone-900">{cfg.title || '未命名'}</h3>
                      <p className="mt-1 text-xs font-medium text-stone-500">{count} 个选项</p>
                    </div>
                  </div>

                  {cfg.lastPicked && (
                    <div className="mt-4 rounded-xl bg-rose-50/80 px-3 py-2 text-center">
                      <p className="text-xs text-stone-400">上次结果</p>
                      <p className="mt-0.5 truncate text-sm font-bold text-rose-600">{cfg.lastPicked}</p>
                    </div>
                  )}

                  {!cfg.lastPicked && (
                    <div className="mt-4 rounded-xl bg-stone-50/80 px-3 py-2 text-center">
                      <p className="text-xs text-stone-400">还没转过</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </main>
      </div>
    );
  }

  // ═══════════ WHEEL VIEW ═══════════
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 font-sans text-stone-900 selection:bg-rose-200 selection:text-rose-950">
      <div className="pointer-events-none absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-rose-300/30 to-pink-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-orange-200/40 to-amber-200/40 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-white/40 backdrop-blur-[50px]" />

      <header className="relative z-10 border-b border-white/40 bg-white/50 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <button type="button" onClick={handleBackToList} className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600 transition hover:text-rose-600">
            <ChevronLeft className="h-4 w-4" /> 转盘列表
          </button>
          <button type="button" onClick={handleBackToList} className="inline-flex items-center gap-2 rounded-full border border-stone-200/60 bg-white/80 px-3 py-1.5 text-xs font-medium text-stone-600 shadow-sm transition hover:bg-white">
            <List className="h-3.5 w-3.5" /> 共 {store.configs.length} 个转盘
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid max-w-6xl gap-10 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:py-12">
        <section className="flex flex-col items-center gap-8">
          <div className="w-full text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-200/50 bg-rose-100/50 px-4 py-1.5 text-sm font-semibold text-rose-700 shadow-sm backdrop-blur-md">
              <Sparkles className="h-4 w-4 text-rose-500" /> 转盘决定一下
            </div>
            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-stone-900 drop-shadow-sm md:text-5xl">
              {title || DEFAULT_TITLE}
            </h1>
            <p className="mt-4 text-sm leading-6 text-stone-500">点击 GO 开始转动，结果自动保存。</p>
          </div>

          {/* SVG Wheel */}
          <div className="relative w-full max-w-[560px] aspect-square flex items-center justify-center">
            <svg
              width="54"
              height="54"
              viewBox="0 0 54 54"
              fill="none"
              className="pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2 -translate-y-2 drop-shadow-lg"
              aria-hidden="true"
            >
              <path d="M27 54 L9 20 C4 10 12 0 27 0 C42 0 50 10 45 20 Z" fill="#e11d48" />
              <circle cx="27" cy="15" r="6.5" fill="white" />
            </svg>
            <div className="w-full h-full transition-transform duration-[4500ms] ease-[cubic-bezier(0.14,0.85,0.26,1)]" style={{ transform: `rotate(${rotation}deg)` }}>
              <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} className="w-full h-full drop-shadow-2xl">
                <defs>
                  <filter id="ws"><feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="#00000020" /></filter>
                  <linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f43f5e" /><stop offset="100%" stopColor="#ec4899" /></linearGradient>
                </defs>
                <circle cx={CX} cy={CY} r={WHEEL_R + 12} fill="white" filter="url(#ws)" />
                <circle cx={CX} cy={CY} r={WHEEL_R + 4} fill="white" />
                {activeItems.map((item, i) => {
                  const s = i * sliceAngle, e = (i + 1) * sliceAngle, mid = s + sliceAngle / 2;
                  const tp = polarToXY(mid, WHEEL_R * 0.62);
                  const textRotation = readableSliceTextRotation(mid, normalizedRotation);
                  return (
                    <g key={item.id}>
                      <path d={slicePath(s, e, WHEEL_R)} fill={WHEEL_COLORS[i % WHEEL_COLORS.length]} stroke="white" strokeWidth="2" />
                      <text x={tp.x} y={tp.y} textAnchor="middle" dominantBaseline="central" transform={`rotate(${textRotation}, ${tp.x}, ${tp.y})`} fill="white" fontSize={itemCount <= 8 ? 16 : 13} fontWeight="700" fontFamily="Inter, system-ui, sans-serif" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))' }}>
                        {truncText(item.text, maxTextLen)}
                      </text>
                    </g>
                  );
                })}
                <circle cx={CX} cy={CY} r={52} fill="white" />
                <circle cx={CX} cy={CY} r={46} fill="url(#hg)" />
              </svg>
            </div>
            <button type="button" onClick={spin} disabled={isSpinning || itemCount === 0} className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 grid h-[86px] w-[86px] place-items-center rounded-full text-lg font-black tracking-wider text-white transition-all hover:scale-110 disabled:cursor-not-allowed disabled:opacity-80 disabled:hover:scale-100">
              <span className="drop-shadow-md">{isSpinning ? '...' : 'GO!'}</span>
            </button>
          </div>

          {/* Result */}
          <div className="grid w-full max-w-[560px] gap-3 rounded-3xl border border-white/60 bg-white/60 p-6 text-center shadow-xl backdrop-blur-xl transition-all hover:bg-white/80">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-stone-400">Result</p>
            <p className="min-h-12 py-1 text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-rose-500 to-pink-600 md:text-4xl">
              {lastPicked || '还没转呢~'}
            </p>
            <div className="mt-3">
              <button type="button" onClick={spin} disabled={isSpinning || itemCount === 0} className="mx-auto inline-flex items-center justify-center gap-2 rounded-full bg-stone-900 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-stone-900/20 transition-all hover:scale-105 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100">
                <RotateCw className={`h-4 w-4 ${isSpinning ? 'animate-spin' : ''}`} /> 再转一次
              </button>
            </div>
          </div>
        </section>

        {/* ── Right panel ── */}
        <aside className="space-y-6">
          <section className="rounded-3xl border border-white/60 bg-white/60 p-6 shadow-xl backdrop-blur-xl transition-all hover:bg-white/80">
            <label htmlFor="roulette-title" className="block text-sm font-bold text-stone-800">转盘标题</label>
            <input id="roulette-title" value={title} onChange={(e) => { setTitle(e.target.value); setSaveState('idle'); }} className="mt-2.5 w-full rounded-2xl border border-white/80 bg-white/50 px-4 py-3.5 text-sm font-medium text-stone-800 shadow-sm outline-none transition focus:border-rose-400 focus:bg-white focus:ring-4 focus:ring-rose-500/10" />

            <form onSubmit={handleAddItem} className="mt-6">
              <label htmlFor="roulette-new-item" className="block text-sm font-bold text-stone-800">添加选项</label>
              <textarea id="roulette-new-item" value={newItem} onChange={(e) => setNewItem(e.target.value)} rows={4} placeholder="每行一个选项" className="mt-2.5 w-full resize-none rounded-2xl border border-white/80 bg-white/50 px-4 py-3.5 text-sm font-medium leading-6 text-stone-800 shadow-sm outline-none transition focus:border-rose-400 focus:bg-white focus:ring-4 focus:ring-rose-500/10" />
              <button type="submit" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-900 px-4 py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-stone-800">
                <Plus className="h-4 w-4" /> 加入转盘
              </button>
            </form>

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={handleSave} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-500 px-4 py-3.5 text-sm font-bold text-white shadow-md shadow-rose-500/20 transition hover:from-rose-600 hover:to-pink-600">
                <Save className="h-4 w-4" /> 保存
              </button>
            </div>
            {saveState === 'saved' && (
              <div className="mt-4 rounded-xl bg-emerald-50/80 p-3 text-center text-sm font-medium text-emerald-700 border border-emerald-100">已保存 ✨</div>
            )}
          </section>

          <section className="flex flex-col h-[500px] rounded-3xl border border-white/60 bg-white/60 shadow-xl backdrop-blur-xl transition-all hover:bg-white/80">
            <div className="flex items-center justify-between gap-3 border-b border-stone-200/50 px-6 py-5">
              <div>
                <h2 className="text-base font-bold text-stone-900">选项列表</h2>
                <p className="mt-1 text-xs font-medium text-stone-500">{itemCount}/40 个选项</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {activeItems.length > 0 ? (
                <div className="space-y-2.5">
                  {activeItems.map((item, index) => (
                    <div key={item.id} className="group grid grid-cols-[2rem_minmax(0,1fr)_2.25rem] items-center gap-3 rounded-2xl border border-white/80 bg-white/50 px-3 py-2.5 shadow-sm transition-all hover:bg-white">
                      <span className="grid h-8 w-8 place-items-center rounded-xl text-xs font-extrabold text-white shadow-sm" style={{ backgroundColor: WHEEL_COLORS[index % WHEEL_COLORS.length] }}>{index + 1}</span>
                      <input value={item.text} onChange={(e) => { setItems((c) => c.map((ci) => ci.id === item.id ? { ...ci, text: e.target.value } : ci)); setSaveState('idle'); }} className="min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-bold text-stone-700 outline-none transition focus:bg-stone-50" />
                      <button type="button" aria-label={`删除 ${item.text}`} onClick={() => { setItems((c) => c.filter((ci) => ci.id !== item.id)); setSaveState('idle'); }} className="grid h-9 w-9 place-items-center rounded-xl text-stone-400 opacity-50 transition-all hover:bg-red-50 hover:text-red-500 hover:opacity-100 group-hover:opacity-100">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-200/80 px-6 py-10 text-center text-sm font-medium text-stone-500 bg-white/30">
                  <div className="mb-2 rounded-full bg-stone-100 p-3"><Sparkles className="h-5 w-5 text-stone-400" /></div>
                  至少添加一个选项后才能转动
                </div>
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
