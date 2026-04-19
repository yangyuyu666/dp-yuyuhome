import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, RefreshCw, ShieldCheck, KeyRound, Image as ImageIcon, FileJson, Search, LayoutGrid, Terminal } from 'lucide-react';

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

const SIDEBAR_ITEMS = [
  { id: '2fa', name: '2FA 密钥计算器', icon: KeyRound },
  { id: 'image', name: '图片压缩 (待开发)', icon: ImageIcon },
  { id: 'json', name: 'JSON 格式化 (待开发)', icon: FileJson },
  { id: 'regex', name: '正则测试 (待开发)', icon: Terminal },
];

export default function ToolsPage() {
  const [activeTab, setActiveTab] = useState('2fa');

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
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Sidebar */}
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
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
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

      {/* Main Content */}
      <main className="ml-64 flex min-h-screen flex-1 flex-col bg-[#f8fafc]">
        {/* Top Header */}
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

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === '2fa' && (
            <div className="mx-auto flex max-w-5xl flex-col gap-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                    2FA 实时密钥计算器
                  </h1>
                  <p className="mt-2 text-slate-500">
                    在边缘服务器计算 TOTP 验证码，前端仅负责安全展示。
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-200/50 bg-violet-100 px-4 py-2 text-sm font-medium text-violet-700 shadow-sm">
                  <ShieldCheck className="h-4 w-4" />
                  边缘服务器计算
                </div>
              </div>

              <section className="mt-4 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
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
                        className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition hover:bg-violet-700"
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
                        className="rounded-xl border border-slate-200 bg-white px-6 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300"
                      >
                        清空
                      </button>
                    </div>
                  </form>
                </div>

                <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-8 text-white shadow-xl">
                  <div className="absolute -mr-16 -mt-16 right-0 top-0 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl"></div>

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
          {activeTab !== '2fa' && (
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
