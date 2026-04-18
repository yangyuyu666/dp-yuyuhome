import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react';

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

export default function ToolsPage() {
  const [draftSecret, setDraftSecret] = useState('');
  const [activeSecret, setActiveSecret] = useState('');
  const [requestState, setRequestState] = useState<RequestState>({ status: 'idle' });
  const requestInFlight = useRef(false);

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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = draftSecret.trim();

    if (!normalized) {
      setRequestState({ status: 'error', message: '请输入 2FA 密钥' });
      return;
    }

    setActiveSecret(normalized);
  };

  const readyData = requestState.status === 'ready' ? requestState.data : null;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fff1f2_0%,#fff7ed_38%,#fafaf9_100%)] px-4 py-10 text-stone-900">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="flex items-center justify-between gap-4">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/80 px-4 py-2 text-sm font-medium text-stone-600 shadow-sm transition hover:border-rose-200 hover:text-rose-500"
          >
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </a>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
            边缘服务器计算
          </div>
        </div>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[2rem] border border-rose-100 bg-white/90 p-8 shadow-xl shadow-rose-100/40">
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-rose-400">Tools</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-stone-900">2FA 实时密钥计算器</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-stone-600">
              输入 TOTP 密钥后，浏览器会向 Cloudflare Worker 请求当前验证码。验证码本身在边缘服务器里计算，前端只负责展示结果。
            </p>

            <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
              <label className="block text-sm font-medium text-stone-700" htmlFor="totp-secret">
                Base32 密钥
              </label>
              <textarea
                id="totp-secret"
                value={draftSecret}
                onChange={(event) => setDraftSecret(event.target.value)}
                placeholder="例如：JBSWY3DPEHPK3PXP"
                className="min-h-36 w-full rounded-3xl border border-stone-200 bg-stone-50 px-5 py-4 font-mono text-sm text-stone-800 shadow-inner outline-none transition focus:border-rose-300 focus:bg-white"
                spellCheck={false}
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-full bg-rose-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-600"
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
                  className="rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-medium text-stone-600 transition hover:border-stone-300 hover:text-stone-900"
                >
                  清空
                </button>
              </div>
            </form>
          </div>

          <div className="rounded-[2rem] border border-stone-200 bg-stone-950 p-8 text-white shadow-2xl shadow-stone-300/40">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-rose-300">Current Code</p>
            <div className="mt-8">
              {requestState.status === 'idle' && (
                <p className="text-sm leading-7 text-stone-300">输入密钥并点击“开始计算”后，这里会显示边缘服务器返回的 6 位验证码。</p>
              )}
              {requestState.status === 'loading' && (
                <p className="text-sm leading-7 text-stone-300">正在向 Cloudflare Worker 请求当前验证码...</p>
              )}
              {requestState.status === 'error' && (
                <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 p-5 text-sm leading-7 text-rose-100">
                  {requestState.message}
                </div>
              )}
              {readyData && (
                <div className="space-y-6">
                  <div className="rounded-[1.75rem] border border-white/10 bg-white/5 px-6 py-8">
                    <div className="font-mono text-5xl font-semibold tracking-[0.4em] text-white">
                      {readyData.code}
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-emerald-400 transition-[width] duration-500"
                        style={{ width: `${(readyData.remaining / readyData.period) * 100}%` }}
                      />
                    </div>
                    <p className="mt-3 text-sm text-stone-300">{readyData.remaining} 秒后刷新</p>
                  </div>
                  <dl className="grid gap-4 text-sm text-stone-300 sm:grid-cols-2">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                      <dt className="text-stone-400">时间窗口</dt>
                      <dd className="mt-2 text-lg font-semibold text-white">{readyData.period} 秒</dd>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                      <dt className="text-stone-400">服务端时间</dt>
                      <dd className="mt-2 text-lg font-semibold text-white">
                        {new Date(readyData.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
