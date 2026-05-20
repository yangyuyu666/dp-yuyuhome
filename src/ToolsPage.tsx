import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  Archive as LibArchive,
  ArchiveCompression,
  ArchiveFormat,
} from 'libarchive.js';
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';
import {
  AlertTriangle,
  Archive as ArchiveIcon,
  ArrowLeft,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileArchive,
  FileJson,
  Files,
  FolderOpen,
  Globe2,
  Image as ImageIcon,
  KeyRound,
  LayoutGrid,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
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

type CompressionSourceFile = {
  id: string;
  file: File;
  path: string;
};

type CompressionPresetId = 'zip' | 'tar' | 'tar-gz' | 'tar-bz2' | 'tar-xz' | 'tar-lzma';

type CompressionState =
  | { status: 'idle'; message?: string }
  | { status: 'compressing'; message: string }
  | { status: 'ready'; message: string; file: File }
  | { status: 'error'; message: string };

type LegacyFileSystemEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

type LegacyFileSystemFileEntry = LegacyFileSystemEntry & {
  file(callback: (file: File) => void, errorCallback?: (error: DOMException) => void): void;
};

type LegacyFileSystemDirectoryEntry = LegacyFileSystemEntry & {
  createReader(): {
    readEntries(
      callback: (entries: LegacyFileSystemEntry[]) => void,
      errorCallback?: (error: DOMException) => void,
    ): void;
  };
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => LegacyFileSystemEntry | null;
};

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
  { id: 'compress', name: '压缩工具', icon: Files },
  { id: 'sites', name: '推荐网站', icon: Globe2 },
  { id: 'chatgpt-plus', name: 'ChatGPT 提取长链接', icon: CreditCard },
  { id: 'image', name: '图片压缩（待开发）', icon: ImageIcon },
  { id: 'json', name: 'JSON 格式化（待开发）', icon: FileJson },
  { id: 'regex', name: '正则测试（待开发）', icon: Terminal },
] as const;

const RECOMMENDED_WEBSITES = [
  {
    name: '随机信用卡生成',
    url: 'https://www.suijidaquan.com/credit-card-generator',
    description: '生成随机信用卡号数据，适合测试表单和校验逻辑，不用于真实支付。',
    category: '测试数据',
    icon: CreditCard,
  },
  {
    name: 'IP 纯净度查询',
    url: 'https://ippure.com/',
    description: '查询 IP 风险、归属与纯净度信息，适合检查代理、服务器或网络出口状态。',
    category: '网络检测',
    icon: ShieldCheck,
  },
] as const;

const CHATGPT_PLUS_LINKS = [
  {
    name: 'ChatGPT Plus 官方页面',
    url: 'https://chatgpt.com/plans/plus',
    description: '登录 ChatGPT 后从官方页面继续升级流程。',
  },
  {
    name: 'OpenAI ChatGPT 价格页',
    url: 'https://openai.com/chatgpt/pricing/',
    description: '查看 Plus、Pro、Business 等官方套餐说明。',
  },
  {
    name: 'Plus 帮助中心',
    url: 'https://help.openai.com/en/articles/6950777-chatgpt-plus',
    description: '查看 Plus 订阅、账单和升级说明。',
  },
] as const;

const CHATGPT_CHECKOUT_SCRIPT = `fetch('/api/auth/session').then(r=>r.json()).then(s=>fetch('/backend-api/payments/checkout',{method:'POST',headers:{'Authorization':'Bearer '+s.accessToken,'Content-Type':'application/json'},body:'{}'}).then(r=>r.json())).then(d=>{copy(d.url);prompt('\u2705 长链接已复制到剪贴板：',d.url)}).catch(e=>alert('\u274c 失败：'+e.message))`;

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

const COMPRESSION_PRESETS: Record<
  CompressionPresetId,
  {
    label: string;
    extension: string;
    format: ArchiveFormat;
    compression: ArchiveCompression;
    description: string;
  }
> = {
  zip: {
    label: 'ZIP',
    extension: 'zip',
    format: ArchiveFormat.ZIP,
    compression: ArchiveCompression.NONE,
    description: '通用性最好，适合日常分享',
  },
  tar: {
    label: 'TAR',
    extension: 'tar',
    format: ArchiveFormat.USTAR,
    compression: ArchiveCompression.NONE,
    description: '只打包不额外压缩',
  },
  'tar-gz': {
    label: 'TAR.GZ',
    extension: 'tar.gz',
    format: ArchiveFormat.USTAR,
    compression: ArchiveCompression.GZIP,
    description: 'Linux/macOS 常用格式',
  },
  'tar-bz2': {
    label: 'TAR.BZ2',
    extension: 'tar.bz2',
    format: ArchiveFormat.USTAR,
    compression: ArchiveCompression.BZIP2,
    description: '体积更小，速度较慢',
  },
  'tar-xz': {
    label: 'TAR.XZ',
    extension: 'tar.xz',
    format: ArchiveFormat.USTAR,
    compression: ArchiveCompression.XZ,
    description: '压缩率高，适合较大文件',
  },
  'tar-lzma': {
    label: 'TAR.LZMA',
    extension: 'tar.lzma',
    format: ArchiveFormat.USTAR,
    compression: ArchiveCompression.LZMA,
    description: 'LZMA 压缩方式',
  },
};

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

async function saveEntriesToFolder(
  entries: ArchiveEntryPreview[],
  folderName: string,
  onProgress?: (current: number, total: number) => void,
) {
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

  const filesToSave = entries.filter((entry) => entry.file);
  let savedCount = 0;

  for (const [entryIndex, entry] of filesToSave.entries()) {
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
    savedCount += 1;
    onProgress?.(savedCount, filesToSave.length);
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

function sourcePathForFile(file: File, fallbackPrefix = '') {
  const relativePath = file.webkitRelativePath || file.name;
  const safeSegments = safePathSegments(buildEntryPath(fallbackPrefix, relativePath));
  return safeSegments.join('/') || sanitizeFileSystemName(file.name, 'file');
}

function sourceFilesFromFileList(files: FileList | File[], fallbackPrefix = '') {
  return Array.from(files)
    .filter((file) => file.size >= 0)
    .map((file, index) => {
      const path = sourcePathForFile(file, fallbackPrefix);
      return {
        id: `${path}-${file.size}-${file.lastModified}-${index}`,
        file,
        path,
      };
    });
}

function readFileEntry(entry: LegacyFileSystemFileEntry, pathPrefix: string) {
  return new Promise<CompressionSourceFile>((resolve, reject) => {
    entry.file(
      (file) => {
        const path = safePathSegments(buildEntryPath(pathPrefix, entry.name)).join('/');
        resolve({
          id: `${path}-${file.size}-${file.lastModified}`,
          file,
          path,
        });
      },
      (error) => reject(error),
    );
  });
}

function readDirectoryEntries(entry: LegacyFileSystemDirectoryEntry) {
  const reader = entry.createReader();
  const entries: LegacyFileSystemEntry[] = [];

  return new Promise<LegacyFileSystemEntry[]>((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries);
            return;
          }

          entries.push(...batch);
          readBatch();
        },
        (error) => reject(error),
      );
    };

    readBatch();
  });
}

async function readDroppedEntry(
  entry: LegacyFileSystemEntry,
  pathPrefix = '',
): Promise<CompressionSourceFile[]> {
  if (entry.isFile) {
    return [await readFileEntry(entry as LegacyFileSystemFileEntry, pathPrefix)];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const directory = entry as LegacyFileSystemDirectoryEntry;
  const nextPrefix = buildEntryPath(pathPrefix, directory.name);
  const children = await readDirectoryEntries(directory);
  const nested = await Promise.all(children.map((child) => readDroppedEntry(child, nextPrefix)));
  return nested.flat();
}

async function sourceFilesFromDrop(event: DragEvent<HTMLElement>) {
  const items = Array.from(event.dataTransfer.items ?? []) as DataTransferItemWithEntry[];
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean) as LegacyFileSystemEntry[];

  if (entries.length > 0) {
    const nested = await Promise.all(entries.map((entry) => readDroppedEntry(entry)));
    return nested.flat();
  }

  return sourceFilesFromFileList(event.dataTransfer.files ?? []);
}

function defaultArchiveName(preset: CompressionPresetId) {
  return `archive.${COMPRESSION_PRESETS[preset].extension}`;
}

async function writeZipArchive(
  files: CompressionSourceFile[],
  outputFileName: string,
  password: string,
  onProgress?: (current: number, total: number) => void,
) {
  const zipWriter = new ZipWriter(new BlobWriter('application/zip'), {
    password: password || undefined,
    encryptionStrength: 3,
  });

  for (const [index, item] of files.entries()) {
    await zipWriter.add(item.path, new BlobReader(item.file), {
      password: password || undefined,
      encryptionStrength: 3,
    });
    onProgress?.(index + 1, files.length);
  }

  const blob = await zipWriter.close();
  return new File([blob], outputFileName, { type: 'application/zip' });
}

export default function ToolsPage() {
  const [activeTab, setActiveTab] = useState<(typeof SIDEBAR_ITEMS)[number]['id']>('2fa');

  useEffect(() => { document.title = 'D&Y 工具箱'; }, []);

  const [draftSecret, setDraftSecret] = useState('');
  const [activeSecret, setActiveSecret] = useState('');
  const [requestState, setRequestState] = useState<RequestState>({ status: 'idle' });
  const requestInFlight = useRef(false);

  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [archivePassword, setArchivePassword] = useState('');
  const [archiveState, setArchiveState] = useState<ArchiveState>({ status: 'idle' });
  const [isArchiveDragActive, setIsArchiveDragActive] = useState(false);
  const [folderSaveState, setFolderSaveState] = useState<
    | { status: 'idle' }
    | { status: 'saving'; current: number; total: number }
    | { status: 'saved'; message: string; current: number; total: number }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const archiveBusy = archiveState.status === 'reading' || archiveState.status === 'extracting';

  const [compressionFiles, setCompressionFiles] = useState<CompressionSourceFile[]>([]);
  const [compressionPreset, setCompressionPreset] = useState<CompressionPresetId>('zip');
  const [compressionPassword, setCompressionPassword] = useState('');
  const [compressionOutputName, setCompressionOutputName] = useState(defaultArchiveName('zip'));
  const [compressionState, setCompressionState] = useState<CompressionState>({ status: 'idle' });
  const [isCompressionDragActive, setIsCompressionDragActive] = useState(false);

  const [chatgptScriptCopied, setChatgptScriptCopied] = useState(false);

  const copyChatgptScript = async () => {
    try {
      await navigator.clipboard.writeText(CHATGPT_CHECKOUT_SCRIPT);
      setChatgptScriptCopied(true);
      window.setTimeout(() => setChatgptScriptCopied(false), 2500);
    } catch {
      /* clipboard may fail */
    }
  };

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

  const compressionTotalSize = useMemo(
    () => compressionFiles.reduce((total, item) => total + item.file.size, 0),
    [compressionFiles],
  );

  const setCompressionPresetAndName = (presetId: CompressionPresetId) => {
    setCompressionPreset(presetId);
    const extension = COMPRESSION_PRESETS[presetId].extension;
    const baseName = compressionOutputName
      .replace(/\.(tar\.(gz|bz2|xz|lzma)|t[gbx]z|zip|7z|rar|tar|gz|bz2|xz|lzma)$/i, '')
      .trim() || 'archive';
    setCompressionOutputName(`${baseName}.${extension}`);
    setCompressionState({ status: 'idle' });
  };

  const addCompressionFiles = (files: CompressionSourceFile[]) => {
    if (files.length === 0) {
      return;
    }

    setCompressionFiles((current) => {
      const next = new Map(current.map((item) => [item.path, item]));
      files.forEach((item) => next.set(item.path, item));
      return Array.from(next.values()).sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'));
    });
    setCompressionState({ status: 'idle', message: `已加入 ${files.length} 个文件` });
  };

  const createCompressedArchive = async () => {
    if (compressionFiles.length === 0) {
      setCompressionState({ status: 'error', message: '请先选择文件或文件夹' });
      return;
    }

    const preset = COMPRESSION_PRESETS[compressionPreset];
    const outputFileName = compressionOutputName.trim().endsWith(`.${preset.extension}`)
      ? sanitizeFileSystemName(compressionOutputName.trim(), defaultArchiveName(compressionPreset))
      : sanitizeFileSystemName(
          `${compressionOutputName.trim() || 'archive'}.${preset.extension}`,
          defaultArchiveName(compressionPreset),
        );
    const password = compressionPassword.trim();

    if (password && compressionPreset !== 'zip') {
      setCompressionState({ status: 'error', message: '当前只有 ZIP 压缩支持设置密码' });
      return;
    }

    setCompressionState({
      status: 'compressing',
      message: `正在前端压缩 ${compressionFiles.length} 个文件...`,
    });

    try {
      const archiveFile =
        compressionPreset === 'zip'
          ? await writeZipArchive(compressionFiles, outputFileName, password, (current, total) => {
              setCompressionState({
                status: 'compressing',
                message: `正在写入 ZIP：${current}/${total} 个文件...`,
              });
            })
          : await LibArchive.write({
              files: compressionFiles.map((item) => ({
                file: item.file,
                pathname: item.path,
              })) as never,
              outputFileName,
              compression: preset.compression,
              format: preset.format,
              passphrase: null,
            });

      if (archiveFile.size === 0) {
        throw new Error('压缩结果为空，请换一种压缩方式后重试');
      }

      setCompressionOutputName(outputFileName);
      setCompressionState({
        status: 'ready',
        message: `已生成 ${outputFileName}（${formatFileSize(archiveFile.size)}）`,
        file: archiveFile,
      });
    } catch (error) {
      setCompressionState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : '压缩失败，请换一种压缩方式或减少文件数量后重试',
      });
    }
  };

  const readyData = requestState.status === 'ready' ? requestState.data : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans text-slate-900 md:flex-row">
      <aside className="sticky top-0 z-20 flex w-full flex-col border-b border-slate-200 bg-white shadow-sm md:fixed md:left-0 md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-r">
        <div className="flex h-14 shrink-0 items-center border-b border-slate-100 px-4 md:h-16 md:px-6">
          <div className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-xl font-bold text-transparent">
            <LayoutGrid className="h-5 w-5 text-violet-600" />
            D&Y 工具箱
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto px-3 py-3 md:flex-1 md:flex-col md:gap-0 md:space-y-1 md:overflow-y-auto md:py-4">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 md:w-full md:gap-3 ${
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
          <a
            href="/roulette"
            className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 md:w-full md:gap-3"
          >
            <Sparkles className="h-4 w-4 text-slate-400" />
            转盘
          </a>
        </div>
        <div className="hidden border-t border-slate-100 p-4 md:block">
          <a
            href="/"
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500 transition-colors hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            返回小屋主页
          </a>
        </div>
      </aside>

      <main className="flex min-h-screen flex-1 flex-col bg-[#f8fafc] md:ml-64">
        <header className="z-10 flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:sticky md:top-0 md:h-16 md:px-8 md:py-0">
          <div className="flex gap-5 overflow-x-auto whitespace-nowrap text-sm font-medium text-slate-600 sm:gap-6">
            <span className="cursor-pointer border-b-2 border-violet-600 py-2 text-slate-900 md:py-5">
              常用工具
            </span>
            <span className="cursor-pointer py-2 transition-colors hover:text-slate-900 md:py-5">最新上架</span>
            <span className="cursor-pointer py-2 transition-colors hover:text-slate-900 md:py-5">我的收藏</span>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索站内工具..."
              className="w-full rounded-full border-transparent bg-slate-100 py-2 pl-9 pr-4 text-sm outline-none transition-all focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100"
            />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          {activeTab === '2fa' && (
            <div className="mx-auto flex max-w-5xl flex-col gap-6 md:gap-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
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

              <section className="grid gap-6 md:mt-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
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
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition hover:bg-violet-700 sm:flex-none"
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
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-6 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 sm:flex-none"
                      >
                        清空
                      </button>
                    </div>
                  </form>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-5 text-white shadow-xl sm:p-8">
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
                          <div className="font-mono text-4xl font-bold tracking-[0.2em] text-white sm:text-5xl sm:tracking-[0.3em]">
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
                        {(folderSaveState.status === 'saving' || folderSaveState.status === 'saved') && (
                          <div className="mt-2 w-64 max-w-full">
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                                style={{
                                  width: `${
                                    folderSaveState.total > 0
                                      ? (folderSaveState.current / folderSaveState.total) * 100
                                      : 0
                                  }%`,
                                }}
                              />
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {folderSaveState.current}/{folderSaveState.total} 个文件
                            </p>
                          </div>
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

                          setFolderSaveState({ status: 'saving', current: 0, total: extractedEntries.length });

                          try {
                            const folderName = archiveFolderName(archiveFile.name);
                            await saveEntriesToFolder(extractedEntries, folderName, (current, total) => {
                              setFolderSaveState({ status: 'saving', current, total });
                            });
                            setFolderSaveState({
                              status: 'saved',
                              message: `已保存到文件夹：${folderName}`,
                              current: extractedEntries.length,
                              total: extractedEntries.length,
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

          {activeTab === 'compress' && (
            <div className="mx-auto flex max-w-6xl flex-col gap-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900">前端压缩</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                    选择文件或整个文件夹，在浏览器中生成压缩包，不上传服务器。
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700">
                  <ArchiveIcon className="h-4 w-4" />
                  Browser + WebAssembly
                </div>
              </div>

              <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
                <div className="space-y-6">
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setIsCompressionDragActive(true);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                        setIsCompressionDragActive(true);
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault();
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setIsCompressionDragActive(false);
                        }
                      }}
                      onDrop={async (event) => {
                        event.preventDefault();
                        setIsCompressionDragActive(false);
                        addCompressionFiles(await sourceFilesFromDrop(event));
                      }}
                      className={`flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition ${
                        isCompressionDragActive
                          ? 'border-violet-500 bg-violet-50 ring-4 ring-violet-100'
                          : 'border-slate-300 bg-slate-50'
                      }`}
                    >
                      <UploadCloud className="h-10 w-10 text-violet-500" />
                      <span className="mt-4 text-base font-semibold text-slate-900">
                        拖入文件或文件夹
                      </span>
                      <span className="mt-2 text-sm leading-6 text-slate-500">
                        也可以点击下面按钮选择多个文件，或选择整个文件夹并保留目录结构
                      </span>
                      <div className="mt-5 flex flex-wrap justify-center gap-3">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition hover:bg-violet-700">
                          <Files className="h-4 w-4" />
                          选择文件
                          <input
                            type="file"
                            multiple
                            className="sr-only"
                            onChange={(event) => {
                              addCompressionFiles(sourceFilesFromFileList(event.target.files ?? []));
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                          <FolderOpen className="h-4 w-4" />
                          选择文件夹
                          <input
                            type="file"
                            multiple
                            className="sr-only"
                            {...{ webkitdirectory: '', directory: '' }}
                            onChange={(event) => {
                              addCompressionFiles(sourceFilesFromFileList(event.target.files ?? []));
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          已选择 {compressionFiles.length} 个文件
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          总大小 {formatFileSize(compressionTotalSize)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={compressionFiles.length === 0 || compressionState.status === 'compressing'}
                        onClick={() => {
                          setCompressionFiles([]);
                          setCompressionState({ status: 'idle' });
                        }}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        清空
                      </button>
                    </div>

                    {compressionFiles.length > 0 && (
                      <div className="mt-4 max-h-72 overflow-y-auto rounded-2xl border border-slate-200">
                        <div className="divide-y divide-slate-100">
                          {compressionFiles.map((item) => (
                            <div
                              key={item.id}
                              className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-900">
                                  {item.path}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {formatFileSize(item.file.size)}
                                </p>
                              </div>
                              <button
                                type="button"
                                aria-label="移除待压缩文件"
                                onClick={() => {
                                  setCompressionFiles((current) =>
                                    current.filter((file) => file.id !== item.id),
                                  );
                                }}
                                className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-base font-semibold text-slate-900">压缩设置</h2>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {(Object.entries(COMPRESSION_PRESETS) as [CompressionPresetId, (typeof COMPRESSION_PRESETS)[CompressionPresetId]][]).map(
                        ([presetId, preset]) => (
                          <button
                            key={presetId}
                            type="button"
                            onClick={() => setCompressionPresetAndName(presetId)}
                            className={`rounded-2xl border p-4 text-left transition ${
                              compressionPreset === presetId
                                ? 'border-violet-400 bg-violet-50 ring-4 ring-violet-100'
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <span className="text-sm font-semibold text-slate-900">{preset.label}</span>
                            <span className="mt-1 block text-xs leading-5 text-slate-500">
                              {preset.description}
                            </span>
                          </button>
                        ),
                      )}
                    </div>

                    <div className="mt-5 space-y-2">
                      <label
                        htmlFor="compression-output-name"
                        className="block text-sm font-medium text-slate-700"
                      >
                        输出文件名
                      </label>
                      <input
                        id="compression-output-name"
                        value={compressionOutputName}
                        onChange={(event) => {
                          setCompressionOutputName(event.target.value);
                          setCompressionState({ status: 'idle' });
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                      />
                    </div>

                    <div className="mt-5 space-y-2">
                      <label
                        htmlFor="compression-password"
                        className="flex items-center gap-2 text-sm font-medium text-slate-700"
                      >
                        <LockKeyhole className="h-4 w-4 text-slate-400" />
                        压缩密码
                      </label>
                      <input
                        id="compression-password"
                        value={compressionPassword}
                        onChange={(event) => {
                          setCompressionPassword(event.target.value);
                          setCompressionState({ status: 'idle' });
                        }}
                        type="password"
                        placeholder="仅 ZIP 支持密码；不需要可留空"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={compressionFiles.length === 0 || compressionState.status === 'compressing'}
                      onClick={() => void createCompressedArchive()}
                      className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {compressionState.status === 'compressing' ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArchiveIcon className="h-4 w-4" />
                      )}
                      开始压缩
                    </button>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">压缩结果</h2>
                        <p className="mt-1 text-xs text-slate-500">
                          {compressionState.message ?? '生成后可下载压缩包。'}
                        </p>
                      </div>
                      {compressionState.status === 'ready' && (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      )}
                      {compressionState.status === 'error' && (
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                      )}
                    </div>

                    {compressionState.status === 'compressing' && (
                      <div className="mt-5">
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full w-2/3 animate-pulse rounded-full bg-violet-500" />
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          大文件会占用较多内存，请保持页面打开。
                        </p>
                      </div>
                    )}

                    {compressionState.status === 'ready' && (
                      <button
                        type="button"
                        onClick={() => downloadFile(compressionState.file, compressionState.file.name)}
                        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                      >
                        <Download className="h-4 w-4" />
                        下载压缩包
                      </button>
                    )}

                    {compressionState.status === 'error' && (
                      <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
                        {compressionState.message}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'sites' && (
            <div className="mx-auto flex max-w-6xl flex-col gap-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900">推荐网站</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                    收纳常用外部网站，保持在工具箱内统一访问入口。
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700">
                  <Globe2 className="h-4 w-4" />
                  Web shortcuts
                </div>
              </div>

              <section className="grid gap-4 md:grid-cols-2">
                {RECOMMENDED_WEBSITES.map((site) => {
                  const Icon = site.icon;

                  return (
                    <article
                      key={site.url}
                      className="flex min-h-56 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <div className="grid h-11 w-11 place-items-center rounded-xl bg-violet-50 text-violet-600">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">
                                {site.category}
                              </p>
                              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                                {site.name}
                              </h2>
                            </div>
                          </div>
                          <a
                            href={site.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`打开 ${site.name}`}
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>

                        <p className="mt-5 text-sm leading-6 text-slate-500">{site.description}</p>
                      </div>

                      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                        <span className="break-all text-xs text-slate-400">{site.url}</span>
                        <a
                          href={site.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                        >
                          打开网站
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </article>
                  );
                })}
              </section>
            </div>
          )}

          {activeTab === 'chatgpt-plus' && (
            <div className="mx-auto flex max-w-5xl flex-col gap-6 md:gap-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                    ChatGPT 提取长链接
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                    一键复制脚本，在 chatgpt.com 控制台运行即可自动获取 Stripe 支付长链接并复制到剪贴板。
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                  <ShieldCheck className="h-4 w-4" />
                  纯浏览器端
                </div>
              </div>

              <section className="grid gap-6 md:mt-4 lg:grid-cols-[1.1fr_0.9fr]">
                {/* Left - Steps */}
                <div className="space-y-6">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
                    <h2 className="text-lg font-semibold text-slate-900">使用步骤</h2>
                    <ol className="mt-5 space-y-5">
                      <li className="flex gap-4">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">1</span>
                        <div>
                          <p className="font-medium text-slate-900">登录 ChatGPT</p>
                          <p className="mt-1 text-sm leading-6 text-slate-500">
                            在浏览器中打开并登录&nbsp;
                            <a href="https://chatgpt.com" target="_blank" rel="noreferrer" className="font-medium text-violet-600 underline decoration-violet-300 hover:decoration-violet-500">chatgpt.com</a>
                          </p>
                        </div>
                      </li>
                      <li className="flex gap-4">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">2</span>
                        <div>
                          <p className="font-medium text-slate-900">打开浏览器控制台</p>
                          <p className="mt-1 text-sm leading-6 text-slate-500">
                            在 chatgpt.com 页面按 <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs">F12</kbd> 打开开发者工具，切换到 <strong>Console</strong> 面板
                          </p>
                        </div>
                      </li>
                      <li className="flex gap-4">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">3</span>
                        <div>
                          <p className="font-medium text-slate-900">复制并粘贴脚本</p>
                          <p className="mt-1 text-sm leading-6 text-slate-500">
                            点击下方按钮复制脚本，粘贴到控制台中按回车运行
                          </p>
                        </div>
                      </li>
                      <li className="flex gap-4">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">✓</span>
                        <div>
                          <p className="font-medium text-slate-900">获得长链接</p>
                          <p className="mt-1 text-sm leading-6 text-slate-500">
                            脚本会自动获取你的登录态、请求支付链接，并将 Stripe URL 复制到剪贴板和弹窗中
                          </p>
                        </div>
                      </li>
                    </ol>
                  </div>

                  <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <p className="text-sm leading-6 text-amber-700">
                        脚本仅在 <strong>chatgpt.com</strong> 页面运行有效。它利用你当前的登录会话调用官方接口，不涉及任何第三方服务器。
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right - Script */}
                <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-5 text-white shadow-xl sm:p-8">
                  <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl"></div>

                  <p className="relative z-10 text-sm font-semibold uppercase tracking-[0.2em] text-violet-400">
                    Console Script
                  </p>

                  <div className="relative z-10 mt-6">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-sm leading-6 text-emerald-300">{CHATGPT_CHECKOUT_SCRIPT}</pre>
                    </div>

                    <button
                      type="button"
                      onClick={() => void copyChatgptScript()}
                      className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition hover:bg-violet-500"
                    >
                      {chatgptScriptCopied ? (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          已复制到剪贴板
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          一键复制脚本
                        </>
                      )}
                    </button>

                    <p className="mt-4 text-xs leading-5 text-slate-400">
                      复制后在 chatgpt.com 页面的控制台中粘贴并回车。成功后会弹窗显示 Stripe 链接并自动复制到剪贴板。
                    </p>
                  </div>
                </div>
              </section>

              {/* Bottom reference links */}
              <section className="grid gap-3 sm:grid-cols-3">
                {CHATGPT_PLUS_LINKS.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-violet-200 hover:shadow-md"
                  >
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{link.name}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500">{link.description}</p>
                    </div>
                    <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  </a>
                ))}
              </section>
            </div>
          )}

          {activeTab !== '2fa' && activeTab !== 'extract' && activeTab !== 'compress' && activeTab !== 'sites' && activeTab !== 'chatgpt-plus' && (
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
