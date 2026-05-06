import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Archive as LibArchive } from 'libarchive.js';
import {
  AlertTriangle,
  Archive as ArchiveIcon,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileArchive,
  FileJson,
  FolderOpen,
  Image as ImageIcon,
  KeyRound,
  LayoutGrid,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  UploadCloud,
} from 'lucide-react';

LibArchive.init({
  workerUrl: '/libarchive/worker-bundle.js',
});

type TotpResponse = {
  code: string;
  period: number;
  remaining: number;
  generatedAt: string;
};

type RequestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: TotpResponse }
  | { status: 'error'; message: string };

type ArchiveEntryPreview = {
  id: string;
  name: string;
  path: string;
  size: number;
  file?: File;
  status: 'waiting' | 'extracted';
};

type ArchiveState =
  | { status: 'idle'; message?: string }
  | { status: 'reading'; message: string }
  | { status: 'listed'; message: string; encrypted: boolean | null; entries: ArchiveEntryPreview[] }
  | { status: 'extracting'; message: string; encrypted: boolean | null; entries: ArchiveEntryPreview[] }
  | { status: 'ready'; message: string; encrypted: boolean | null; entries: ArchiveEntryPreview[] }
  | { status: 'error'; message: string; entries: ArchiveEntryPreview[] };

type WritableFileStreamLike = {
  write(data: File): Promise<void>;
  close(): Promise<void>;
};

type FileHandleLike = {
  createWritable(): Promise<WritableFileStreamLike>;
};

type DirectoryHandleLike = {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
};

type DirectoryPickerWindow = Window &
  typeof globalThis & {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>;
  };

async function fetchTotp(secret: string): Promise<TotpResponse> {
  const response = await fetch('/api/tools/totp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ secret }),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error ?? '验证码生成失败');
  }

  return (await response.json()) as TotpResponse;
}

const SIDEBAR_ITEMS = [
  { id: '2fa', name: '2FA 密钥计算器', icon: KeyRound },
  { id: 'extract', name: '解压缩工具', icon: FileArchive },
  { id: 'image', name: '图片压缩（待开发）', icon: ImageIcon },
  { id: 'json', name: 'JSON 格式化（待开发）', icon: FileJson },
  { id: 'regex', name: '正则测试（待开发）', icon: Terminal },
] as const;

const SUPPORTED_FORMATS = [
  'ZIP',
  '7z',
  'RAR v4/v5',
  'TAR',
  'GZIP',
  'BZIP2',
  'XZ',
  'LZMA',
  'DEFLATE',
];

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function buildEntryPath(path: string, name: string) {
  const normalizedPath = path.replaceAll('\\', '/').replace(/^\/+/, '');
  const normalizedName = name.replaceAll('\\', '/').replace(/^\/+/, '');

  if (!normalizedPath) {
    return normalizedName;
  }

  if (normalizedPath.endsWith(normalizedName)) {
    return normalizedPath;
  }

  return `${normalizedPath.replace(/\/+$/, '')}/${normalizedName}`;
}

function downloadFile(file: File, path: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = path.split('/').pop() || file.name || 'extracted-file';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function archiveFolderName(fileName: string) {
  return sanitizeFileSystemName(
    fileName
      .replace(/\.(tar\.(gz|bz2|xz|lzma)|t[gbx]z|zip|7z|rar|tar|gz|bz2|xz|lzma)$/i, '')
      .trim(),
    'extracted-files',
  );
}

function sanitizeFileSystemName(name: string, fallback = 'item') {
  const sanitized = name
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, '_')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/[. ]+$/g, '')
    .trim();
  const usableName = sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : fallback;
  const safeName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(usableName)
    ? `_${usableName}`
    : usableName;

  return safeName.slice(0, 120).replace(/[. ]+$/g, '') || fallback;
}

function safePathSegments(path: string) {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment, index) => sanitizeFileSystemName(segment, `item-${index + 1}`));
}

function fileExtension(name: string) {
  const safeName = sanitizeFileSystemName(name, '');
  const extensionMatch = safeName.match(/(\.[A-Za-z0-9]{1,12})$/);
  return extensionMatch?.[1] ?? '';
}

async function getSafeDirectoryHandle(
  directory: DirectoryHandleLike,
  name: string,
  fallback: string,
) {
  try {
    return await directory.getDirectoryHandle(name, { create: true });
  } catch (error) {
    return directory.getDirectoryHandle(sanitizeFileSystemName(fallback, 'folder'), { create: true });
  }
}

async function getSafeFileHandle(
  directory: DirectoryHandleLike,
  name: string,
  fallback: string,
) {
  try {
    return await directory.getFileHandle(name, { create: true });
  } catch (error) {
    return directory.getFileHandle(sanitizeFileSystemName(fallback, 'file'), { create: true });
  }
}

async function saveEntriesToFolder(entries: ArchiveEntryPreview[], folderName: string) {
  const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;

  if (!directoryPicker) {
    throw new Error('当前浏览器不支持直接保存文件夹，请使用 Chrome 或 Edge 打开工具页');
  }

  const parentDirectory = await directoryPicker({ mode: 'readwrite' });
  const outputDirectory = await getSafeDirectoryHandle(
    parentDirectory,
    sanitizeFileSystemName(folderName, 'extracted-files'),
    'extracted-files',
  );

  for (const [entryIndex, entry] of entries.entries()) {
    if (!entry.file) {
      continue;
    }

    const segments = safePathSegments(entry.path);
    const fileName = sanitizeFileSystemName(
      segments.pop() || entry.file.name,
      `file-${entryIndex + 1}${fileExtension(entry.file.name)}`,
    );
    let targetDirectory = outputDirectory;

    for (const [segmentIndex, segment] of segments.entries()) {
      targetDirectory = await getSafeDirectoryHandle(
        targetDirectory,
        segment,
        `folder-${segmentIndex + 1}`,
      );
    }

    const fileHandle = await getSafeFileHandle(
      targetDirectory,
      fileName,
      `file-${entryIndex + 1}${fileExtension(fileName || entry.file.name)}`,
    );
    const writable = await fileHandle.createWritable();
    await writable.write(entry.file);
    await writable.close();
  }
}

function flattenExtractedFiles(tree: unknown, basePath = '', files = new Map<string, File>()) {
  if (tree instanceof File) {
    const path = buildEntryPath(basePath, tree.name);
    files.set(path, tree);
    files.set(tree.name, tree);
    return files;
  }

  if (!tree || typeof tree !== 'object') {
    return files;
  }

  Object.entries(tree as Record<string, unknown>).forEach(([name, value]) => {
    if (value instanceof File) {
      const path = buildEntryPath(basePath, value.name || name);
      files.set(path, value);
      files.set(value.name || name, value);
      return;
    }

    flattenExtractedFiles(value, buildEntryPath(basePath, name), files);
  });

  return files;
}

export default function ToolsPage() {
  const [activeTab, setActiveTab] = useState<(typeof SIDEBAR_ITEMS)[number]['id']>('2fa');

  const [draftSecret, setDraftSecret] = useState('');
  const [activeSecret, setActiveSecret] = useState('');
  const [requestState, setRequestState] = useState<RequestState>({ status: 'idle' });
  const requestInFlight = useRef(false);

  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [archivePassword, setArchivePassword] = useState('');
  const [archiveState, setArchiveState] = useState<ArchiveState>({ status: 'idle' });
  const [isArchiveDragActive, setIsArchiveDragActive] = useState(false);
  const [folderSaveState, setFolderSaveState] = useState<
    { status: 'idle' } | { status: 'saving' } | { status: 'saved'; message: string } | { status: 'error'; message: string }
  >({ status: 'idle' });
  const archiveBusy = archiveState.status === 'reading' || archiveState.status === 'extracting';

  useEffect(() => {
    if (!activeSecret) {
      return;
    }

    let cancelled = false;

    const refresh = async (showLoading: boolean) => {
      if (requestInFlight.current) {
        return;
      }

      requestInFlight.current = true;

      if (showLoading) {
        setRequestState({ status: 'loading' });
      }

      try {
        const data = await fetchTotp(activeSecret);
        if (!cancelled) {
          setRequestState({ status: 'ready', data });
        }
      } catch (error) {
        if (!cancelled) {
          setRequestState({
            status: 'error',
            message: error instanceof Error ? error.message : '验证码生成失败',
          });
        }
      } finally {
        requestInFlight.current = false;
      }
    };

    void refresh(true);

    const timer = window.setInterval(() => {
      void refresh(false);
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSecret]);

  const extractedEntries = useMemo(
    () =>
      'entries' in archiveState
        ? archiveState.entries.filter((entry) => entry.status === 'extracted' && entry.file)
        : [],
    [archiveState],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = draftSecret.trim();

    if (!normalized) {
      setRequestState({ status: 'error', message: '请输入 2FA 密钥' });
      return;
    }

    setActiveSecret(normalized);
  };

  const selectArchiveFile = (file: File | null) => {
    setArchiveFile(file);
    setFolderSaveState({ status: 'idle' });
    setArchiveState(
      file
        ? { status: 'idle', message: `已选择：${file.name}` }
        : { status: 'idle' },
    );
  };

  const readArchive = async (file: File) => {
    setFolderSaveState({ status: 'idle' });
    setArchiveState({
      status: 'reading',
      message: '正在读取目录并准备解压...',
    });

    let archive: Awaited<ReturnType<typeof LibArchive.open>> | null = null;

    try {
      archive = await LibArchive.open(file);
      if (archivePassword.trim()) {
        await archive.usePassword(archivePassword.trim());
      }

      const encrypted = await archive.hasEncryptedData().catch(() => null);
      const listedFiles = (await archive.getFilesArray()) as {
        file?: { name?: string; size?: number };
        path?: string;
      }[];

      const entries = listedFiles
        .filter((entry) => entry.file?.name)
        .map((entry, index) => {
          const name = entry.file?.name ?? `file-${index + 1}`;
          const path = buildEntryPath(entry.path ?? '', name);
          return {
            id: `${path}-${index}`,
            name,
            path,
            size: entry.file?.size ?? 0,
            status: 'waiting' as const,
          };
        });

      if (encrypted && !archivePassword.trim()) {
        setArchiveState({
          status: 'listed',
          message: '这个压缩包可能已加密，请输入密码后再解压',
          encrypted,
          entries,
        });
        await archive.close();
        return;
      }

      setArchiveState({
        status: 'extracting',
        message: '正在浏览器中解压文件...',
        encrypted,
        entries,
      });

      const extracted = flattenExtractedFiles(await archive.extractFiles());

      const readyEntries = entries.map((entry) => ({
        ...entry,
        file: extracted.get(entry.path) ?? extracted.get(entry.name),
        status: extracted.has(entry.path) || extracted.has(entry.name) ? ('extracted' as const) : entry.status,
      }));

      setArchiveState({
        status: 'ready',
        message: `已在前端解压 ${readyEntries.filter((entry) => entry.file).length} 个文件`,
        encrypted,
        entries: readyEntries,
      });
    } catch (error) {
      setArchiveState((current) => ({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : '解压失败，请确认格式是否受支持，或为加密压缩包输入正确密码',
        entries: 'entries' in current ? current.entries : [],
      }));
    } finally {
      await archive?.close().catch(() => undefined);
    }
  };

  const readyData = requestState.status === 'ready' ? requestState.data : null;

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      <aside className="fixed left-0 top-0 z-20 flex h-screen w-64 flex-col border-r border-slate-200 bg-white shadow-sm">
        <div className="flex h-16 items-center border-b border-slate-100 px-6">
          <div className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-xl font-bold text-transparent">
            <LayoutGrid className="h-5 w-5 text-violet-600" />
            D&Y 工具箱
          </div>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-violet-50 text-violet-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-violet-600' : 'text-slate-400'}`} />
                {item.name}
              </button>
            );
          })}
        </div>
        <div className="border-t border-slate-100 p-4">
          <a
            href="/"
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500 transition-colors hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            返回小屋主页
          </a>
        </div>
      </aside>

      <main className="ml-64 flex min-h-screen flex-1 flex-col bg-[#f8fafc]">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8">
          <div className="flex items-center gap-6 text-sm font-medium text-slate-600">
            <span className="cursor-pointer border-b-2 border-violet-600 py-5 text-slate-900">
              常用工具
            </span>
            <span className="cursor-pointer transition-colors hover:text-slate-900">最新上架</span>
            <span className="cursor-pointer transition-colors hover:text-slate-900">我的收藏</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索站内工具..."
              className="w-64 rounded-full border-transparent bg-slate-100 py-2 pl-9 pr-4 text-sm outline-none transition-all focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100"
            />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === '2fa' && (
            <div className="mx-auto flex max-w-5xl flex-col gap-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                    2FA 实时密钥计算器
                  </h1>
                  <p className="mt-2 text-slate-500">
                    在边缘服务器计算 TOTP 验证码，前端负责安全展示。
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-200/50 bg-violet-100 px-4 py-2 text-sm font-medium text-violet-700 shadow-sm">
                  <ShieldCheck className="h-4 w-4" />
                  边缘服务器计算
                </div>
              </div>

              <section className="mt-4 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                  <form className="space-y-4" onSubmit={handleSubmit}>
                    <label
                      className="block text-sm font-medium text-slate-700"
                      htmlFor="totp-secret"
                    >
                      Base32 密钥
                    </label>
                    <textarea
                      id="totp-secret"
                      value={draftSecret}
                      onChange={(event) => setDraftSecret(event.target.value)}
                      placeholder="例如：JBSWY3DPEHPK3PXP"
                      className="min-h-36 w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 font-mono text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                      spellCheck={false}
                    />
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        type="submit"
                        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition hover:bg-violet-700"
                      >
                        <RefreshCw className="h-4 w-4" />
                        开始计算
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDraftSecret('');
                          setActiveSecret('');
                          setRequestState({ status: 'idle' });
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-6 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                      >
                        清空
                      </button>
                    </div>
                  </form>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-8 text-white shadow-xl">
                  <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl"></div>

                  <p className="relative z-10 text-sm font-semibold uppercase tracking-[0.2em] text-violet-400">
                    Current Code
                  </p>
                  <div className="relative z-10 mt-8">
                    {requestState.status === 'idle' && (
                      <p className="text-sm leading-relaxed text-slate-400">
                        输入密钥并点击“开始计算”后，这里会显示边缘服务器返回的 6 位验证码。
                      </p>
                    )}
                    {requestState.status === 'loading' && (
                      <p className="flex items-center gap-2 text-sm leading-relaxed text-slate-400">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        正在请求当前验证码...
                      </p>
                    )}
                    {requestState.status === 'error' && (
                      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm leading-6 text-red-200">
                        {requestState.message}
                      </div>
                    )}
                    {readyData && (
                      <div className="space-y-6">
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-8 backdrop-blur-sm">
                          <div className="font-mono text-5xl font-bold tracking-[0.3em] text-white">
                            {readyData.code}
                          </div>
                          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-violet-400 transition-[width] duration-500 ease-linear"
                              style={{
                                width: `${(readyData.remaining / readyData.period) * 100}%`,
                              }}
                            />
                          </div>
                          <p className="mt-3 flex justify-between text-sm text-slate-400">
                            <span>刷新倒计时</span>
                            <span className="font-medium text-violet-300">
                              {readyData.remaining}s
                            </span>
                          </p>
                        </div>
                        <dl className="grid gap-4 text-sm text-slate-300 sm:grid-cols-2">
                          <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
                            <dt className="text-xs uppercase tracking-wider text-slate-400">
                              时间窗口
                            </dt>
                            <dd className="mt-1.5 text-lg font-medium text-white">
                              {readyData.period} 秒
                            </dd>
                          </div>
                          <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
                            <dt className="text-xs uppercase tracking-wider text-slate-400">
                              服务端时间
                            </dt>
                            <dd className="mt-1.5 text-lg font-medium text-white">
                              {new Date(readyData.generatedAt).toLocaleTimeString('zh-CN', {
                                hour12: false,
                              })}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'extract' && (
            <div className="mx-auto flex max-w-6xl flex-col gap-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900">前端解压缩</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                    文件只在浏览器中处理，不上传服务器。支持自动识别多种归档和压缩格式。
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                  <ArchiveIcon className="h-4 w-4" />
                  Browser + WebAssembly
                </div>
              </div>

              <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="space-y-6">
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <label
                      htmlFor="archive-file"
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setIsArchiveDragActive(true);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                        setIsArchiveDragActive(true);
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault();
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setIsArchiveDragActive(false);
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        setIsArchiveDragActive(false);
                        selectArchiveFile(event.dataTransfer.files?.[0] ?? null);
                      }}
                      className={`flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition ${
                        isArchiveDragActive
                          ? 'border-violet-500 bg-violet-50 ring-4 ring-violet-100'
                          : 'border-slate-300 bg-slate-50 hover:border-violet-300 hover:bg-violet-50/50'
                      }`}
                    >
                      <UploadCloud className="h-10 w-10 text-violet-500" />
                      <span className="mt-4 text-base font-semibold text-slate-900">
                        拖入压缩包，或点击选择文件
                      </span>
                      <span className="mt-2 text-sm leading-6 text-slate-500">
                        zip、7z、rar、tar、tar.gz、tgz、gz、bz2、xz、lzma 等格式会在本机浏览器里解压
                      </span>
                      <input
                        id="archive-file"
                        type="file"
                        className="sr-only"
                        onChange={(event) => {
                          selectArchiveFile(event.target.files?.[0] ?? null);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>

                    {archiveFile && (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {archiveFile.name}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatFileSize(archiveFile.size)}
                            </p>
                          </div>
                          <button
                            type="button"
                            aria-label="移除文件"
                            onClick={() => {
                              selectArchiveFile(null);
                            }}
                            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="mt-5 space-y-2">
                      <label
                        htmlFor="archive-password"
                        className="flex items-center gap-2 text-sm font-medium text-slate-700"
                      >
                        <LockKeyhole className="h-4 w-4 text-slate-400" />
                        解压密码
                      </label>
                      <input
                        id="archive-password"
                        value={archivePassword}
                        onChange={(event) => setArchivePassword(event.target.value)}
                        type="password"
                        placeholder="加密压缩包才需要填写"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                      />
                    </div>

                    <div className="mt-6 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={!archiveFile || archiveBusy}
                        onClick={() => archiveFile && void readArchive(archiveFile)}
                        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {archiveBusy ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArchiveIcon className="h-4 w-4" />
                        )}
                        查看并解压
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-sm font-semibold text-slate-900">支持的解压方法</h2>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {SUPPORTED_FORMATS.map((format) => (
                        <span
                          key={format}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600"
                        >
                          {format}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">解压结果</h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {archiveState.message ?? '选择或拖入压缩包后，点击“查看并解压”。'}
                      </p>
                    </div>
                    {archiveState.status === 'ready' && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        完成
                      </span>
                    )}
                    {archiveState.status === 'error' && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        失败
                      </span>
                    )}
                  </div>

                  {archiveState.status === 'reading' || archiveState.status === 'extracting' ? (
                    <div className="flex min-h-96 flex-col items-center justify-center gap-3 text-slate-500">
                      <RefreshCw className="h-8 w-8 animate-spin text-violet-500" />
                      <p className="text-sm">{archiveState.message}</p>
                    </div>
                  ) : 'entries' in archiveState && archiveState.entries.length > 0 ? (
                    <div className="max-h-[34rem] overflow-y-auto">
                      <div className="divide-y divide-slate-100">
                        {archiveState.entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="grid grid-cols-[1fr_auto] items-center gap-4 px-6 py-4"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <FileArchive className="h-4 w-4 shrink-0 text-slate-400" />
                                <p className="truncate text-sm font-medium text-slate-900">
                                  {entry.name}
                                </p>
                              </div>
                              <p className="mt-1 truncate pl-6 text-xs text-slate-500">
                                {entry.path} · {formatFileSize(entry.size)}
                              </p>
                            </div>
                            {entry.file ? (
                              <button
                                type="button"
                                onClick={() => entry.file && downloadFile(entry.file, entry.path)}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                <Download className="h-3.5 w-3.5" />
                                下载
                              </button>
                            ) : (
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
                                待解压
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-96 flex-col items-center justify-center gap-3 px-8 text-center text-slate-400">
                      <FileArchive className="h-12 w-12 opacity-30" />
                      <p className="text-sm leading-6">
                        还没有解压结果。选择或拖入一个压缩包后，点击“查看并解压”。
                      </p>
                    </div>
                  )}

                  {extractedEntries.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
                      <div>
                        <p className="text-xs text-slate-500">
                          已解压 {extractedEntries.length} 个文件。推荐保存为文件夹，会保留压缩包内的目录结构。
                        </p>
                        {folderSaveState.status === 'saved' && (
                          <p className="mt-1 text-xs font-medium text-emerald-700">
                            {folderSaveState.message}
                          </p>
                        )}
                        {folderSaveState.status === 'error' && (
                          <p className="mt-1 text-xs font-medium text-red-600">
                            {folderSaveState.message}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={folderSaveState.status === 'saving'}
                        onClick={async () => {
                          if (!archiveFile) {
                            return;
                          }

                          setFolderSaveState({ status: 'saving' });

                          try {
                            const folderName = archiveFolderName(archiveFile.name);
                            await saveEntriesToFolder(extractedEntries, folderName);
                            setFolderSaveState({
                              status: 'saved',
                              message: `已保存到文件夹：${folderName}`,
                            });
                          } catch (error) {
                            if (error instanceof DOMException && error.name === 'AbortError') {
                              setFolderSaveState({ status: 'idle' });
                              return;
                            }

                            setFolderSaveState({
                              status: 'error',
                              message:
                                error instanceof Error
                                  ? error.message
                                  : '保存文件夹失败，请检查浏览器权限后重试',
                            });
                          }
                        }}
                        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {folderSaveState.status === 'saving' ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <FolderOpen className="h-4 w-4" />
                        )}
                        保存为文件夹
                      </button>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {activeTab !== '2fa' && activeTab !== 'extract' && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-400">
              <LayoutGrid className="h-12 w-12 opacity-20" />
              <p>该工具正在开发中，敬请期待...</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
