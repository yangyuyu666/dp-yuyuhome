import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import confetti from 'canvas-confetti';
import {
  ArrowLeft,
  Cookie,
  Plus,
  RotateCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';

type RouletteItem = {
  id: string;
  text: string;
};

type RouletteCookieData = {
  title: string;
  items: RouletteItem[];
  lastPicked?: string;
};

const COOKIE_NAME = 'love_roulette_items';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
const DEFAULT_TITLE = '今天听转盘的';
const DEFAULT_ITEMS: RouletteItem[] = [
  { id: 'default-1', text: '一起去散步' },
  { id: 'default-2', text: '点一杯奶茶' },
  { id: 'default-3', text: '看一部电影' },
  { id: 'default-4', text: '吃一顿好吃的' },
  { id: 'default-5', text: '整理一张照片' },
  { id: 'default-6', text: '给对方一个抱抱' },
];

const WHEEL_COLORS = [
  '#FF6B6B',
  '#FFA502',
  '#FFD166',
  '#06D6A0',
  '#118AB2',
  '#8338EC',
  '#FF85A1',
  '#00C9A7',
  '#F77F00',
  '#7209B7',
];

const SVG_SIZE = 520;
const WHEEL_R = 240;
const CX = SVG_SIZE / 2;
const CY = SVG_SIZE / 2;

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function readCookie(name: string) {
  const encodedName = `${name}=`;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(encodedName));

  return match ? decodeURIComponent(match.slice(encodedName.length)) : null;
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function normalizeItems(items: RouletteItem[]) {
  return items
    .map((item) => ({ ...item, text: item.text.trim() }))
    .filter((item) => item.text.length > 0)
    .slice(0, 40);
}

function cookieByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function loadRouletteData(): RouletteCookieData {
  const raw = readCookie(COOKIE_NAME);

  if (!raw) {
    return {
      title: DEFAULT_TITLE,
      items: DEFAULT_ITEMS,
    };
  }

  try {
    const data = JSON.parse(raw) as Partial<RouletteCookieData>;
    const items = Array.isArray(data.items) ? normalizeItems(data.items) : DEFAULT_ITEMS;

    return {
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : DEFAULT_TITLE,
      items: items.length > 0 ? items : DEFAULT_ITEMS,
      lastPicked: typeof data.lastPicked === 'string' ? data.lastPicked : undefined,
    };
  } catch {
    return {
      title: DEFAULT_TITLE,
      items: DEFAULT_ITEMS,
    };
  }
}

function buildCookieData(title: string, items: RouletteItem[], lastPicked?: string) {
  return JSON.stringify({
    title: title.trim() || DEFAULT_TITLE,
    items: normalizeItems(items),
    lastPicked,
  });
}

function polarToXY(angleDeg: number, r: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function slicePath(startDeg: number, endDeg: number, r: number) {
  const s = polarToXY(startDeg, r);
  const e = polarToXY(endDeg, r);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${CX},${CY} L${s.x},${s.y} A${r},${r} 0 ${large} 1 ${e.x},${e.y} Z`;
}

function truncateText(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export default function RoulettePage() {
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [items, setItems] = useState<RouletteItem[]>(DEFAULT_ITEMS);
  const [newItem, setNewItem] = useState('');
  const [lastPicked, setLastPicked] = useState<string>();
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'too-large'>('idle');
  const spinTimer = useRef<number | null>(null);

  useEffect(() => {
    const data = loadRouletteData();
    setTitle(data.title);
    setItems(data.items);
    setLastPicked(data.lastPicked);
  }, []);

  useEffect(() => {
    return () => {
      if (spinTimer.current) {
        window.clearTimeout(spinTimer.current);
      }
    };
  }, []);

  const activeItems = useMemo(() => normalizeItems(items), [items]);
  const itemCount = activeItems.length;
  const sliceAngle = itemCount > 0 ? 360 / itemCount : 360;

  const saveToCookie = (nextLastPicked = lastPicked) => {
    const payload = buildCookieData(title, activeItems, nextLastPicked);

    if (cookieByteLength(`${COOKIE_NAME}=${encodeURIComponent(payload)}`) > 3800) {
      setSaveState('too-large');
      return false;
    }

    writeCookie(COOKIE_NAME, payload);
    setSaveState('saved');
    window.setTimeout(() => setSaveState('idle'), 1800);
    return true;
  };

  const handleAddItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextItems = newItem
      .split('\n')
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ id: makeId(), text }));

    if (nextItems.length === 0) {
      return;
    }

    setItems((current) => normalizeItems([...current, ...nextItems]));
    setNewItem('');
    setSaveState('idle');
  };

  const spin = () => {
    if (isSpinning || itemCount === 0) {
      return;
    }

    const selectedIndex = Math.floor(Math.random() * itemCount);
    const targetCenter = selectedIndex * sliceAngle + sliceAngle / 2;
    const extraTurns = 6 + Math.floor(Math.random() * 4);
    const nextRotation = rotation + extraTurns * 360 + (360 - targetCenter);
    const picked = activeItems[selectedIndex].text;

    setIsSpinning(true);
    setRotation(nextRotation);

    spinTimer.current = window.setTimeout(() => {
      setIsSpinning(false);
      setLastPicked(picked);
      saveToCookie(picked);

      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#FF6B6B', '#FFA502', '#FFD166', '#06D6A0', '#118AB2'],
      });
    }, 4500);
  };

  const resetAll = () => {
    deleteCookie(COOKIE_NAME);
    setTitle(DEFAULT_TITLE);
    setItems(DEFAULT_ITEMS);
    setLastPicked(undefined);
    setRotation(0);
    setSaveState('idle');
  };

  const maxTextLen = itemCount <= 6 ? 7 : itemCount <= 10 ? 5 : 4;

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 font-sans text-stone-900 selection:bg-rose-200 selection:text-rose-950">
      {/* Background blobs */}
      <div className="pointer-events-none absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-rose-300/30 to-pink-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-orange-200/40 to-amber-200/40 blur-3xl" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-fuchsia-200/20 to-purple-200/20 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-white/40 backdrop-blur-[50px]" />

      <header className="relative z-10 border-b border-white/40 bg-white/50 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600 transition hover:text-rose-600"
          >
            <ArrowLeft className="h-4 w-4" />
            回到小屋
          </a>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/60 bg-amber-50/80 px-3 py-1.5 text-xs font-medium text-amber-700 shadow-sm backdrop-blur-sm">
            <Cookie className="h-3.5 w-3.5" />
            本地 cookie 长期保存
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid max-w-6xl gap-10 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:py-12">
        <section className="flex flex-col items-center gap-8">
          <div className="w-full text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-200/50 bg-rose-100/50 px-4 py-1.5 text-sm font-semibold text-rose-700 shadow-sm backdrop-blur-md">
              <Sparkles className="h-4 w-4 text-rose-500" />
              转盘决定一下
            </div>
            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-stone-900 drop-shadow-sm md:text-5xl">
              {title || DEFAULT_TITLE}
            </h1>
            <p className="mt-4 text-sm leading-6 text-stone-500">
              手动填入选项，保存后会留在这个浏览器当前域名的 cookie 里。
            </p>
          </div>

          {/* ========== SVG Wheel ========== */}
          <div className="relative w-full max-w-[560px] aspect-square flex items-center justify-center">
            {/* Pointer - fixed, does NOT rotate */}
            <svg
              width="40"
              height="52"
              viewBox="0 0 40 52"
              fill="none"
              className="absolute -top-4 left-1/2 z-30 -translate-x-1/2 drop-shadow-lg"
            >
              <path d="M20 52 L4 24 C-1 14 4 0 20 0 C36 0 41 14 36 24 Z" fill="#e11d48" />
              <circle cx="20" cy="14" r="6" fill="white" />
            </svg>

            {/* Spinning container */}
            <div
              className="w-full h-full transition-transform duration-[4500ms] ease-[cubic-bezier(0.14,0.85,0.26,1)]"
              style={{ transform: `rotate(${rotation}deg)` }}
            >
              <svg
                viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
                className="w-full h-full drop-shadow-2xl"
              >
                <defs>
                  <filter id="wheelShadow">
                    <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="#00000020" />
                  </filter>
                </defs>
                {/* Outer ring */}
                <circle cx={CX} cy={CY} r={WHEEL_R + 12} fill="white" filter="url(#wheelShadow)" />
                <circle cx={CX} cy={CY} r={WHEEL_R + 4} fill="white" />

                {/* Pie slices */}
                {activeItems.map((item, index) => {
                  const start = index * sliceAngle;
                  const end = (index + 1) * sliceAngle;
                  const mid = start + sliceAngle / 2;
                  const textR = WHEEL_R * 0.62;
                  const tp = polarToXY(mid, textR);
                  const shouldFlip = mid > 90 && mid < 270;
                  const textRotation = shouldFlip ? mid + 180 : mid;

                  return (
                    <g key={item.id}>
                      <path
                        d={slicePath(start, end, WHEEL_R)}
                        fill={WHEEL_COLORS[index % WHEEL_COLORS.length]}
                        stroke="white"
                        strokeWidth="2"
                      />
                      <text
                        x={tp.x}
                        y={tp.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        transform={`rotate(${textRotation}, ${tp.x}, ${tp.y})`}
                        fill="white"
                        fontSize={itemCount <= 8 ? 16 : 13}
                        fontWeight="700"
                        fontFamily="Inter, system-ui, sans-serif"
                        style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))' }}
                      >
                        {truncateText(item.text, maxTextLen)}
                      </text>
                    </g>
                  );
                })}

                {/* Center hub */}
                <circle cx={CX} cy={CY} r={52} fill="white" />
                <circle cx={CX} cy={CY} r={46} fill="url(#hubGradient)" />
                <defs>
                  <linearGradient id="hubGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f43f5e" />
                    <stop offset="100%" stopColor="#ec4899" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            {/* GO button - on top, does NOT rotate */}
            <button
              type="button"
              onClick={spin}
              disabled={isSpinning || itemCount === 0}
              className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 grid h-[86px] w-[86px] place-items-center rounded-full text-lg font-black tracking-wider text-white transition-all hover:scale-110 disabled:cursor-not-allowed disabled:opacity-80 disabled:hover:scale-100"
            >
              <span className="drop-shadow-md">{isSpinning ? '...' : 'GO!'}</span>
            </button>
          </div>

          {/* Result card */}
          <div className="grid w-full max-w-[560px] gap-3 rounded-3xl border border-white/60 bg-white/60 p-6 text-center shadow-xl backdrop-blur-xl transition-all hover:bg-white/80">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-stone-400">Result</p>
            <p className="min-h-12 py-1 text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-rose-500 to-pink-600 drop-shadow-sm md:text-4xl">
              {lastPicked ? lastPicked : '还没转呢~'}
            </p>
            <div className="mt-3">
              <button
                type="button"
                onClick={spin}
                disabled={isSpinning || itemCount === 0}
                className="mx-auto inline-flex items-center justify-center gap-2 rounded-full bg-stone-900 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-stone-900/20 transition-all hover:scale-105 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              >
                <RotateCw className={`h-4 w-4 ${isSpinning ? 'animate-spin' : ''}`} />
                再转一次
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-white/60 bg-white/60 p-6 shadow-xl backdrop-blur-xl transition-all hover:bg-white/80">
            <label htmlFor="roulette-title" className="block text-sm font-bold text-stone-800">
              转盘标题
            </label>
            <input
              id="roulette-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaveState('idle');
              }}
              className="mt-2.5 w-full rounded-2xl border border-white/80 bg-white/50 px-4 py-3.5 text-sm font-medium text-stone-800 shadow-sm outline-none transition focus:border-rose-400 focus:bg-white focus:ring-4 focus:ring-rose-500/10"
            />

            <form onSubmit={handleAddItem} className="mt-6">
              <label htmlFor="roulette-new-item" className="block text-sm font-bold text-stone-800">
                添加选项
              </label>
              <textarea
                id="roulette-new-item"
                value={newItem}
                onChange={(event) => setNewItem(event.target.value)}
                rows={4}
                placeholder="每行一个选项"
                className="mt-2.5 w-full resize-none rounded-2xl border border-white/80 bg-white/50 px-4 py-3.5 text-sm font-medium leading-6 text-stone-800 shadow-sm outline-none transition focus:border-rose-400 focus:bg-white focus:ring-4 focus:ring-rose-500/10"
              />
              <button
                type="submit"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-900 px-4 py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-stone-800"
              >
                <Plus className="h-4 w-4" />
                加入转盘
              </button>
            </form>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => saveToCookie()}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-500 px-4 py-3.5 text-sm font-bold text-white shadow-md shadow-rose-500/20 transition hover:from-rose-600 hover:to-pink-600"
              >
                <Save className="h-4 w-4" />
                保存配置
              </button>
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center justify-center rounded-2xl border border-stone-200/80 bg-white/50 px-5 py-3.5 text-sm font-bold text-stone-600 shadow-sm transition hover:bg-white hover:text-stone-900"
              >
                重置
              </button>
            </div>

            {saveState === 'saved' && (
               <div className="mt-4 rounded-xl bg-emerald-50/80 p-3 text-center text-sm font-medium text-emerald-700 border border-emerald-100">
                已安全保存到本地 cookie ✨
              </div>
            )}
            {saveState === 'too-large' && (
              <div className="mt-4 rounded-xl bg-red-50/80 p-3 text-center text-sm font-medium text-red-600 border border-red-100">
                内容超过限制，请减少选项或缩短文字后再保存。
              </div>
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
                    <div
                      key={item.id}
                      className="group grid grid-cols-[2rem_minmax(0,1fr)_2.25rem] items-center gap-3 rounded-2xl border border-white/80 bg-white/50 px-3 py-2.5 shadow-sm transition-all hover:bg-white"
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-xl text-xs font-extrabold text-white shadow-sm" style={{ backgroundColor: WHEEL_COLORS[index % WHEEL_COLORS.length] }}>
                        {index + 1}
                      </span>
                      <input
                        value={item.text}
                        onChange={(event) => {
                          const nextText = event.target.value;
                          setItems((current) =>
                            current.map((currentItem) =>
                              currentItem.id === item.id ? { ...currentItem, text: nextText } : currentItem,
                            ),
                          );
                          setSaveState('idle');
                        }}
                        className="min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-bold text-stone-700 outline-none transition focus:bg-stone-50"
                      />
                      <button
                        type="button"
                        aria-label={`删除 ${item.text}`}
                        onClick={() => {
                          setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
                          setSaveState('idle');
                        }}
                        className="grid h-9 w-9 place-items-center rounded-xl text-stone-400 opacity-50 transition-all hover:bg-red-50 hover:text-red-500 hover:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-200/80 px-6 py-10 text-center text-sm font-medium text-stone-500 bg-white/30">
                  <div className="mb-2 rounded-full bg-stone-100 p-3">
                    <Sparkles className="h-5 w-5 text-stone-400" />
                  </div>
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
