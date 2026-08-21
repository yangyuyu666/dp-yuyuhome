import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileImage,
  Image as ImageIcon,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UnlockKeyhole,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  MAX_ENCRYPTED_PNG_BYTES,
  MAX_SOURCE_IMAGE_BYTES,
  convertImage,
  convertedImageName,
  decryptNoisePng,
  encryptImageToNoisePng,
  encryptedImageName,
  imageExtension,
  imageMimeFromFile,
  validatePassphrase,
  type ConvertibleImageMime,
} from './imageTools';

type ImageMode = 'convert' | 'encrypt' | 'decrypt';

type OperationState =
  | { status: 'idle' }
  | { status: 'working'; message: string }
  | { status: 'ready'; message: string; file: File }
  | { status: 'error'; message: string };

const MODES: Array<{
  id: ImageMode;
  label: string;
  description: string;
  icon: typeof ImageIcon;
}> = [
  { id: 'convert', label: '格式转换', description: 'JPEG、PNG、WebP', icon: RefreshCw },
  { id: 'encrypt', label: '图片加密', description: '生成噪点 PNG', icon: LockKeyhole },
  { id: 'decrypt', label: '图片解密', description: '恢复原始图片', icon: UnlockKeyhole },
];

const OUTPUT_FORMATS: Array<{ mime: ConvertibleImageMime; label: string; detail: string }> = [
  { mime: 'image/jpeg', label: 'JPEG', detail: '体积较小，透明区域变为白色' },
  { mime: 'image/png', label: 'PNG', detail: '无损画质，支持透明背景' },
  { mime: 'image/webp', label: 'WebP', detail: '现代格式，兼顾画质和体积' },
];

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function useFileUrl(file: File | null) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!file) {
      setUrl('');
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  return url;
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function defaultTargetFor(file: File): ConvertibleImageMime {
  const source = imageMimeFromFile(file);
  return source === 'image/webp' ? 'image/png' : 'image/webp';
}

export default function ImageToolsPage() {
  const [mode, setMode] = useState<ImageMode>('convert');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetMime, setTargetMime] = useState<ConvertibleImageMime>('image/webp');
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [state, setState] = useState<OperationState>({ status: 'idle' });
  const [sourceDimensions, setSourceDimensions] = useState('');
  const [resultDimensions, setResultDimensions] = useState('');

  const resultFile = state.status === 'ready' ? state.file : null;
  const sourceUrl = useFileUrl(sourceFile);
  const resultUrl = useFileUrl(resultFile);
  const sourceMime = sourceFile ? imageMimeFromFile(sourceFile) : null;
  const sourceCanPreview = Boolean(sourceFile && sourceUrl && sourceMime);
  const resultCanPreview = Boolean(resultFile && resultUrl && imageMimeFromFile(resultFile));

  const expectedOutputName = useMemo(() => {
    if (!sourceFile) return '';
    if (mode === 'convert') return convertedImageName(sourceFile.name, targetMime);
    if (mode === 'encrypt') return encryptedImageName(sourceFile.name);
    return '成功解密后恢复原始文件名';
  }, [mode, sourceFile, targetMime]);

  const resetOperation = () => {
    setSourceFile(null);
    setPassphrase('');
    setConfirmation('');
    setShowPassphrase(false);
    setState({ status: 'idle' });
    setSourceDimensions('');
    setResultDimensions('');
    setDragActive(false);
  };

  const selectMode = (nextMode: ImageMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    resetOperation();
  };

  const selectFile = (file: File | null) => {
    setState({ status: 'idle' });
    setSourceDimensions('');
    setResultDimensions('');

    if (!file) {
      setSourceFile(null);
      return;
    }

    if (mode === 'decrypt') {
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      if (!isPng) {
        setSourceFile(null);
        setState({ status: 'error', message: '解密功能仅接受本站生成的 PNG 文件' });
        return;
      }
      if (file.size > MAX_ENCRYPTED_PNG_BYTES) {
        setSourceFile(null);
        setState({ status: 'error', message: '加密 PNG 不能超过 128 MiB' });
        return;
      }
    } else {
      if (!imageMimeFromFile(file)) {
        setSourceFile(null);
        setState({ status: 'error', message: '仅支持 JPEG、PNG 和 WebP 图片' });
        return;
      }
      if (file.size > MAX_SOURCE_IMAGE_BYTES) {
        setSourceFile(null);
        setState({ status: 'error', message: '原图不能超过 100 MiB' });
        return;
      }
    }

    setSourceFile(file);
    if (mode === 'convert') {
      setTargetMime(defaultTargetFor(file));
    }
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragActive(false);
    selectFile(event.dataTransfer.files[0] ?? null);
  };

  const runOperation = async () => {
    if (!sourceFile) {
      setState({ status: 'error', message: '请先选择一张图片' });
      return;
    }

    try {
      if (mode === 'convert') {
        setState({ status: 'working', message: '正在浏览器中转换图片格式...' });
        const file = await convertImage(sourceFile, targetMime);
        setState({ status: 'ready', message: `格式转换完成：${formatFileSize(file.size)}`, file });
        return;
      }

      validatePassphrase(passphrase);
      if (mode === 'encrypt' && passphrase !== confirmation) {
        throw new Error('两次输入的密钥不一致');
      }

      if (mode === 'encrypt') {
        setState({ status: 'working', message: '正在派生密钥并生成加密噪点 PNG...' });
        const file = await encryptImageToNoisePng(sourceFile, passphrase);
        setState({ status: 'ready', message: `图片加密完成：${formatFileSize(file.size)}`, file });
        return;
      }

      setState({ status: 'working', message: '正在验证密钥并恢复原始图片...' });
      const file = await decryptNoisePng(sourceFile, passphrase);
      setState({ status: 'ready', message: `图片解密完成：${formatFileSize(file.size)}`, file });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : '图片处理失败，请稍后重试',
      });
    }
  };

  const actionLabel = mode === 'convert' ? '开始转换' : mode === 'encrypt' ? '加密图片' : '解密图片';
  const accept = mode === 'decrypt' ? '.png,image/png' : '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">图片工具</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            转换常见图片格式，或使用自定义密钥生成可逆的加密噪点 PNG。
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
          <ShieldCheck className="h-4 w-4" />
          仅在浏览器本地处理
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-3">
        {MODES.map((item) => {
          const Icon = item.icon;
          const active = mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => selectMode(item.id)}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left transition ${
                active
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${active ? 'bg-white/15' : 'bg-violet-50 text-violet-600'}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className={`mt-0.5 block text-xs ${active ? 'text-violet-100' : 'text-slate-400'}`}>
                  {item.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Step 1</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                {mode === 'decrypt' ? '选择加密 PNG' : '选择原始图片'}
              </h2>
            </div>
            {sourceFile && (
              <button
                type="button"
                onClick={() => selectFile(null)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
                清除
              </button>
            )}
          </div>

          <label
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
            }}
            onDrop={handleDrop}
            className={`mt-5 flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-8 text-center transition ${
              dragActive
                ? 'border-violet-400 bg-violet-50'
                : 'border-slate-200 bg-slate-50 hover:border-violet-300 hover:bg-violet-50/50'
            }`}
          >
            <input
              type="file"
              accept={accept}
              className="hidden"
              onChange={(event) => {
                selectFile(event.target.files?.[0] ?? null);
                event.currentTarget.value = '';
              }}
            />
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-violet-600 shadow-sm ring-1 ring-slate-200">
              <UploadCloud className="h-7 w-7" />
            </span>
            <p className="mt-4 text-sm font-semibold text-slate-800">
              {mode === 'decrypt' ? '拖入加密噪点 PNG' : '拖入 JPEG、PNG 或 WebP'}
            </p>
            <p className="mt-1 text-xs text-slate-400">或点击选择单个文件</p>
          </label>

          {sourceFile && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600">
                <FileImage className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{sourceFile.name}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {formatFileSize(sourceFile.size)}{sourceDimensions ? ` · ${sourceDimensions}` : ''}
                </p>
              </div>
            </div>
          )}

          {mode === 'convert' && (
            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Step 2</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">选择目标格式</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {OUTPUT_FORMATS.map((format) => {
                  const selected = targetMime === format.mime;
                  const disabled = sourceMime === format.mime;
                  return (
                    <button
                      key={format.mime}
                      type="button"
                      disabled={disabled}
                      onClick={() => setTargetMime(format.mime)}
                      className={`rounded-xl border p-3 text-left transition ${
                        disabled
                          ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300'
                          : selected
                            ? 'border-violet-400 bg-violet-50 text-violet-800 ring-2 ring-violet-100'
                            : 'border-slate-200 hover:border-violet-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{format.label}</span>
                        {selected && !disabled && <CheckCircle2 className="h-4 w-4 text-violet-600" />}
                      </span>
                      <span className="mt-2 block text-xs leading-5 opacity-70">
                        {disabled ? '当前格式' : format.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                转换后保持原尺寸并移除 EXIF 等元数据，文件名仅替换为 .{imageExtension(targetMime)} 后缀。
              </p>
            </div>
          )}

          {mode !== 'convert' && (
            <div className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Step 2</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">
                    {mode === 'encrypt' ? '设置加密密钥' : '输入解密密钥'}
                  </h2>
                </div>
                <KeyRound className="h-5 w-5 text-violet-500" />
              </div>
              <div className="relative mt-4">
                <input
                  type={showPassphrase ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  autoComplete="off"
                  placeholder="密钥不能为空，支持任意长度"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase((value) => !value)}
                  aria-label={showPassphrase ? '隐藏密钥' : '显示密钥'}
                  className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {mode === 'encrypt' && (
                <input
                  type={showPassphrase ? 'text' : 'password'}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  placeholder="再次输入密钥"
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              )}

              <p className="mt-3 text-xs leading-5 text-slate-400">
                输入内容会原样用于派生密钥，不会自动补零或空格。密钥只保留在当前页面内存中，刷新或关闭页面后即消失，也无法找回。
              </p>
            </div>
          )}

          {sourceFile && (
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
              <span className="font-medium text-slate-700">输出文件：</span> {expectedOutputName}
            </div>
          )}

          <button
            type="button"
            disabled={!sourceFile || state.status === 'working'}
            onClick={() => void runOperation()}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {state.status === 'working' ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : mode === 'encrypt' ? (
              <LockKeyhole className="h-4 w-4" />
            ) : mode === 'decrypt' ? (
              <UnlockKeyhole className="h-4 w-4" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {state.status === 'working' ? '正在处理...' : actionLabel}
          </button>

          {state.status === 'working' && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              {state.message}
            </div>
          )}
          {state.status === 'error' && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
              {state.message}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Preview</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">图片预览</h2>
              </div>
              <ImageIcon className="h-5 w-5 text-violet-500" />
            </div>

            <div className="mt-4 grid min-h-72 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-[linear-gradient(45deg,#f1f5f9_25%,transparent_25%),linear-gradient(-45deg,#f1f5f9_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f1f5f9_75%),linear-gradient(-45deg,transparent_75%,#f1f5f9_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]">
              {sourceCanPreview ? (
                <img
                  src={sourceUrl}
                  alt="待处理图片预览"
                  onLoad={(event) => setSourceDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
                  className="max-h-[28rem] w-full object-contain"
                />
              ) : (
                <div className="px-6 text-center text-slate-400">
                  <ImageIcon className="mx-auto h-12 w-12 opacity-25" />
                  <p className="mt-3 text-sm">选择图片后在这里预览</p>
                </div>
              )}
            </div>
          </section>

          {state.status === 'ready' && resultFile && (
            <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900">处理完成</h2>
                  <p className="mt-1 text-sm text-slate-500">{state.message}</p>
                </div>
              </div>

              {resultCanPreview && (
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <img
                    src={resultUrl}
                    alt="处理结果预览"
                    onLoad={(event) => setResultDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
                    className="max-h-80 w-full object-contain"
                  />
                </div>
              )}

              <div className="mt-4 rounded-xl bg-slate-50 p-3">
                <p className="truncate text-sm font-medium text-slate-800">{resultFile.name}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {formatFileSize(resultFile.size)}{resultDimensions ? ` · ${resultDimensions}` : ''}
                </p>
              </div>

              <button
                type="button"
                onClick={() => downloadFile(resultFile)}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                <Download className="h-4 w-4" />
                下载 {resultFile.name}
              </button>
            </section>
          )}

          {mode !== 'convert' && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4" />
                加密文件使用提示
              </div>
              <p className="mt-2 text-amber-800">
                加密 PNG 请保留原文件，或在聊天软件中选择“发送文件”。若作为普通图片发送并被压缩、缩放或清理数据，可能无法再次解密。
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
