export type RouletteItem = { id: string; text: string };

export type RouletteConfig = {
  id: string;
  title: string;
  items: RouletteItem[];
  lastPicked?: string;
  createdAt: number;
};

export type RouletteStore = {
  activeId: string;
  configs: RouletteConfig[];
};

const STORAGE_KEY = 'love_roulette_store';
const COOKIE_NAME = 'love_roulette_items';

export const DEFAULT_TITLE = '今天听转盘的';
export const DEFAULT_ITEMS: RouletteItem[] = [
  { id: 'default-1', text: '一起去散步' },
  { id: 'default-2', text: '点一杯奶茶' },
  { id: 'default-3', text: '看一部电影' },
  { id: 'default-4', text: '吃一顿好吃的' },
  { id: 'default-5', text: '整理一张照片' },
  { id: 'default-6', text: '给对方一个抱抱' },
];

export function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeItems(items: RouletteItem[]) {
  return items
    .map((item) => ({ ...item, text: item.text.trim() }))
    .filter((item) => item.text.length > 0)
    .slice(0, 40);
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  const match = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function migrateFromCookie(): RouletteConfig | null {
  const raw = readCookie(COOKIE_NAME);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { title?: string; items?: RouletteItem[]; lastPicked?: string };
    const items = Array.isArray(data.items) ? normalizeItems(data.items) : DEFAULT_ITEMS;
    const config: RouletteConfig = {
      id: makeId(),
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : DEFAULT_TITLE,
      items: items.length > 0 ? items : DEFAULT_ITEMS,
      lastPicked: typeof data.lastPicked === 'string' ? data.lastPicked : undefined,
      createdAt: Date.now(),
    };
    deleteCookie(COOKIE_NAME);
    return config;
  } catch {
    return null;
  }
}

export function loadStore(): RouletteStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const store = JSON.parse(raw) as RouletteStore;
      if (Array.isArray(store.configs) && store.configs.length > 0) return store;
    }
  } catch { /* ignore */ }

  const migrated = migrateFromCookie();
  if (migrated) {
    const store: RouletteStore = { activeId: migrated.id, configs: [migrated] };
    saveStore(store);
    return store;
  }

  const defaultConfig: RouletteConfig = {
    id: makeId(), title: DEFAULT_TITLE, items: DEFAULT_ITEMS, createdAt: Date.now(),
  };
  return { activeId: defaultConfig.id, configs: [defaultConfig] };
}

export function saveStore(store: RouletteStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function createConfig(title?: string): RouletteConfig {
  return {
    id: makeId(),
    title: title?.trim() || '新转盘',
    items: [],
    createdAt: Date.now(),
  };
}

/* ───── import / export ───── */

export type ExportPayload = {
  version: 1;
  exportedAt: string;
  configs: RouletteConfig[];
};

export function exportConfigs(configs: RouletteConfig[]): string {
  const payload: ExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    configs: configs.map((c) => ({
      ...c,
      items: normalizeItems(c.items),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadJson(json: string, filename: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseImportFile(json: string): RouletteConfig[] {
  const data = JSON.parse(json) as Partial<ExportPayload>;
  if (!data || !Array.isArray(data.configs)) {
    throw new Error('无效的转盘文件格式');
  }
  return data.configs
    .filter((c): c is RouletteConfig => !!c && typeof c.title === 'string' && Array.isArray(c.items))
    .map((c) => ({
      id: makeId(),
      title: c.title.trim() || '导入的转盘',
      items: normalizeItems(c.items),
      lastPicked: typeof c.lastPicked === 'string' ? c.lastPicked : undefined,
      createdAt: Date.now(),
    }));
}
