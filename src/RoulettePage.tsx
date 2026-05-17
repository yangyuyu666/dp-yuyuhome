import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
  '#fb7185',
  '#f59e0b',
  '#10b981',
  '#38bdf8',
  '#8b5cf6',
  '#f472b6',
  '#84cc16',
  '#f97316',
];

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

  const wheelGradient = useMemo(() => {
    if (itemCount === 0) {
      return '#f8fafc';
    }

    return `conic-gradient(${activeItems
      .map((_, index) => {
        const start = index * sliceAngle;
        const end = (index + 1) * sliceAngle;
        return `${WHEEL_COLORS[index % WHEEL_COLORS.length]} ${start}deg ${end}deg`;
      })
      .join(', ')})`;
  }, [activeItems, itemCount, sliceAngle]);

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
    const pointerAngle = 270;
    const extraTurns = 5 + Math.floor(Math.random() * 3);
    const nextRotation = rotation + extraTurns * 360 + pointerAngle - targetCenter;
    const picked = activeItems[selectedIndex].text;

    setIsSpinning(true);
    setRotation(nextRotation);

    spinTimer.current = window.setTimeout(() => {
      setIsSpinning(false);
      setLastPicked(picked);
      saveToCookie(picked);
    }, 3800);
  };

  const resetAll = () => {
    deleteCookie(COOKIE_NAME);
    setTitle(DEFAULT_TITLE);
    setItems(DEFAULT_ITEMS);
    setLastPicked(undefined);
    setRotation(0);
    setSaveState('idle');
  };

  return (
    <div className="min-h-screen bg-[#fffaf7] font-sans text-stone-900 selection:bg-rose-200 selection:text-rose-950">
      <header className="border-b border-rose-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600 transition hover:text-rose-600"
          >
            <ArrowLeft className="h-4 w-4" />
            回到小屋
          </a>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
            <Cookie className="h-3.5 w-3.5" />
            本地 cookie 长期保存
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:py-12">
        <section className="flex flex-col items-center gap-7">
          <div className="w-full text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-4 py-1.5 text-sm font-semibold text-rose-700">
              <Sparkles className="h-4 w-4" />
              转盘决定一下
            </div>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-stone-950 md:text-5xl">
              {title || DEFAULT_TITLE}
            </h1>
            <p className="mt-3 text-sm leading-6 text-stone-500">
              手动填入选项，保存后会留在这个浏览器当前域名的 cookie 里。
            </p>
          </div>

          <div className="relative grid aspect-square w-full max-w-[560px] place-items-center">
            <div className="absolute -top-1 left-1/2 z-20 h-0 w-0 -translate-x-1/2 border-x-[16px] border-t-[30px] border-x-transparent border-t-stone-950 drop-shadow" />
            <div
              className="relative aspect-square w-[min(86vw,520px)] rounded-full border-[14px] border-white shadow-2xl shadow-rose-200/50 transition-transform duration-[3800ms] ease-out"
              style={{
                background: wheelGradient,
                transform: `rotate(${rotation}deg)`,
              }}
            >
              <div className="absolute inset-[9%] rounded-full border border-white/60" />
              {activeItems.map((item, index) => {
                const angle = index * sliceAngle + sliceAngle / 2;
                return (
                  <div
                    key={item.id}
                    className="absolute left-1/2 top-1/2 flex h-8 w-[42%] origin-left items-center justify-end pr-8 text-right text-xs font-bold text-white drop-shadow md:text-sm"
                    style={{ transform: `rotate(${angle}deg)` }}
                  >
                    <span className="max-w-[110px] truncate">{item.text}</span>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={spin}
                disabled={isSpinning || itemCount === 0}
                className="absolute left-1/2 top-1/2 grid h-28 w-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-8 border-white bg-stone-950 text-sm font-bold text-white shadow-xl transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSpinning ? '转动中' : '开始'}
              </button>
            </div>
          </div>

          <div className="grid w-full max-w-2xl gap-3 rounded-2xl border border-rose-100 bg-white p-5 text-center shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Result</p>
            <p className="min-h-10 text-2xl font-bold text-rose-600 md:text-3xl">
              {lastPicked ? lastPicked : '还没有结果'}
            </p>
            <button
              type="button"
              onClick={spin}
              disabled={isSpinning || itemCount === 0}
              className="mx-auto inline-flex items-center justify-center gap-2 rounded-full bg-rose-600 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-rose-600/20 transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCw className={`h-4 w-4 ${isSpinning ? 'animate-spin' : ''}`} />
              再转一次
            </button>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <label htmlFor="roulette-title" className="block text-sm font-semibold text-stone-700">
              转盘标题
            </label>
            <input
              id="roulette-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaveState('idle');
              }}
              className="mt-2 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm outline-none transition focus:border-rose-400 focus:bg-white focus:ring-4 focus:ring-rose-500/10"
            />

            <form onSubmit={handleAddItem} className="mt-5">
              <label htmlFor="roulette-new-item" className="block text-sm font-semibold text-stone-700">
                添加选项
              </label>
              <textarea
                id="roulette-new-item"
                value={newItem}
                onChange={(event) => setNewItem(event.target.value)}
                rows={4}
                placeholder="每行一个选项"
                className="mt-2 w-full resize-none rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 outline-none transition focus:border-rose-400 focus:bg-white focus:ring-4 focus:ring-rose-500/10"
              />
              <button
                type="submit"
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
              >
                <Plus className="h-4 w-4" />
                加入转盘
              </button>
            </form>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => saveToCookie()}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-700"
              >
                <Save className="h-4 w-4" />
                保存
              </button>
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center justify-center rounded-xl border border-stone-200 px-4 py-3 text-sm font-semibold text-stone-600 transition hover:bg-stone-50"
              >
                重置
              </button>
            </div>

            {saveState === 'saved' && (
              <p className="mt-3 text-sm font-medium text-emerald-700">已保存到本地 cookie。</p>
            )}
            {saveState === 'too-large' && (
              <p className="mt-3 text-sm font-medium text-red-600">
                当前内容超过 cookie 容量，请减少选项或缩短文字后再保存。
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-stone-900">选项列表</h2>
                <p className="mt-1 text-xs text-stone-500">{itemCount}/40 个选项</p>
              </div>
            </div>

            <div className="max-h-[420px] overflow-y-auto p-3">
              {activeItems.length > 0 ? (
                <div className="space-y-2">
                  {activeItems.map((item, index) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-[2rem_minmax(0,1fr)_2.25rem] items-center gap-3 rounded-xl border border-stone-100 bg-stone-50 px-3 py-2"
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: WHEEL_COLORS[index % WHEEL_COLORS.length] }}>
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
                        className="min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm font-medium text-stone-700 outline-none transition focus:border-rose-300 focus:bg-white"
                      />
                      <button
                        type="button"
                        aria-label={`删除 ${item.text}`}
                        onClick={() => {
                          setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
                          setSaveState('idle');
                        }}
                        className="grid h-9 w-9 place-items-center rounded-lg text-stone-400 transition hover:bg-white hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-500">
                  至少添加一个选项后才能转动。
                </div>
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
