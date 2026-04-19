import { generateTotp } from './totp';

type AssetsBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type Env = {
  ASSETS: AssetsBinding;
};

type HtmlRewriterLike = {
  on(
    selector: string,
    handlers: {
      element?(element: {
        setInnerContent(content: string): void;
        append(content: string, options?: { html?: boolean }): void;
      }): void;
    },
  ): HtmlRewriterLike;
  transform(response: Response): Response;
};

type PageMetadata = {
  title: string;
  description: string;
  canonical: string;
};

const HTMLRewriterCtor = (globalThis as unknown as {
  HTMLRewriter: new () => HtmlRewriterLike;
}).HTMLRewriter;

const ACCESS_COOKIE = 'love_cabin_access=verified';
const AUTH_PATH = '/__auth';
const ALLOWED_PASSWORD = 'dploveyuyu';

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    headers: {
      'cache-control': 'no-store',
    },
    ...init,
  });
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getPageMetadata(url: URL): PageMetadata {
  const isToolsPage = url.hostname === 'tools.dploveyuyu.site' || url.pathname === '/tools';

  if (isToolsPage) {
    return {
      title: '2FA 实时密钥计算器 | dploveyuyu.site',
      description: '在 Cloudflare Worker 边缘服务器中实时计算 TOTP/2FA 验证码，浏览器只负责展示结果。',
      canonical: 'https://tools.dploveyuyu.site/',
    };
  }

  return {
    title: '戴鹏和杨雯寓的小屋',
    description: '记录戴鹏和杨雯寓的生活相册，包含合照、日常故事，以及可独立访问的 2FA 实时密钥计算工具。',
    canonical: 'https://dploveyuyu.site/',
  };
}

function rewriteHtmlMetadata(response: Response, metadata: PageMetadata) {
  const canonical = escapeHtmlAttribute(metadata.canonical);
  const description = escapeHtmlAttribute(metadata.description);
  const title = escapeHtmlAttribute(metadata.title);

  return new HTMLRewriterCtor()
    .on('title', {
      element(element) {
        element.setInnerContent(metadata.title);
      },
    })
    .on('head', {
      element(element) {
        element.append(
          `<meta name="description" content="${description}">` +
            `<link rel="canonical" href="${canonical}">` +
            `<meta property="og:title" content="${title}">` +
            `<meta property="og:description" content="${description}">`,
          { html: true },
        );
      },
    })
    .transform(response);
}

function normalizeBirthday(value: string) {
  return value.replaceAll(/\s+/g, '').replaceAll('月', '-').replaceAll('日', '').replaceAll('/', '-');
}

function isMatchingBirthday(value: string, expectedMonth: number, expectedDay: number) {
  const normalized = normalizeBirthday(value);
  const accepted = new Set([
    `${expectedMonth}-${expectedDay}`,
    `${String(expectedMonth).padStart(2, '0')}-${String(expectedDay).padStart(2, '0')}`,
    `${expectedMonth}.${expectedDay}`,
    `${String(expectedMonth).padStart(2, '0')}.${String(expectedDay).padStart(2, '0')}`,
    `${expectedMonth}${expectedDay}`,
    `${String(expectedMonth).padStart(2, '0')}${String(expectedDay).padStart(2, '0')}`,
  ]);

  return accepted.has(normalized);
}

function isAuthenticated(request: Request) {
  const cookie = request.headers.get('Cookie') ?? '';
  return cookie.includes(ACCESS_COOKIE);
}

function buildCookieHeader() {
  return `${ACCESS_COOKIE}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`;
}

function renderAuthPage(errorMessage?: string) {
  const errorHtml = errorMessage
    ? `<p style="margin:0 0 18px;color:#be123c;font-size:14px;">${escapeHtmlAttribute(errorMessage)}</p>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>进入小屋前请回答问题</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(251, 207, 232, 0.45), transparent 30%),
          linear-gradient(180deg, #fff7ed 0%, #fff1f2 45%, #fffafc 100%);
        color: #1c1917;
      }
      .card {
        width: min(92vw, 440px);
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(251, 113, 133, 0.18);
        border-radius: 28px;
        padding: 32px 28px;
        box-shadow: 0 22px 60px rgba(244, 114, 182, 0.18);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
      }
      p {
        margin: 0 0 22px;
        line-height: 1.7;
        color: #57534e;
      }
      label {
        display: block;
        margin: 14px 0 8px;
        font-size: 14px;
        font-weight: 600;
        color: #44403c;
      }
      input {
        box-sizing: border-box;
        width: 100%;
        border: 1px solid #e7e5e4;
        border-radius: 16px;
        padding: 14px 16px;
        font-size: 15px;
        background: #fafaf9;
      }
      input:focus {
        outline: none;
        border-color: #fb7185;
        background: #fff;
      }
      button {
        width: 100%;
        margin-top: 22px;
        border: 0;
        border-radius: 999px;
        padding: 14px 18px;
        font-size: 15px;
        font-weight: 700;
        color: white;
        background: linear-gradient(135deg, #f43f5e, #fb7185);
        cursor: pointer;
      }
      .hint {
        margin-top: 14px;
        font-size: 13px;
        color: #78716c;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>进入小屋前请回答问题</h1>
      <p>回答正确后即可进入。</p>
      ${errorHtml}
      <form method="post" action="${AUTH_PATH}">
        <label for="dpBirthday">戴鹏生日</label>
        <input id="dpBirthday" name="dpBirthday" placeholder="请输入答案" autocomplete="off" />

        <label for="ywBirthday">杨雯寓生日</label>
        <input id="ywBirthday" name="ywBirthday" placeholder="请输入答案" autocomplete="off" />

        <label for="password">密码</label>
        <input id="password" name="password" type="password" placeholder="请输入密码" autocomplete="current-password" />

        <button type="submit">进入小屋</button>
      </form>
    </main>
  </body>
</html>`;
}

function html(content: string, status = 200, headers?: HeadersInit) {
  return new Response(content, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

async function handleAuth(request: Request) {
  const formData = await request.formData();
  const dpBirthday = String(formData.get('dpBirthday') ?? '');
  const ywBirthday = String(formData.get('ywBirthday') ?? '');
  const password = String(formData.get('password') ?? '');

  const valid =
    isMatchingBirthday(dpBirthday, 1, 18) &&
    isMatchingBirthday(ywBirthday, 7, 5) &&
    password === ALLOWED_PASSWORD;

  if (!valid) {
    return html(renderAuthPage('答案不正确，请重新输入。'), 401);
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: '/',
      'set-cookie': buildCookieHeader(),
      'cache-control': 'no-store',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isToolsHost = url.hostname === 'tools.dploveyuyu.site';
    const isPublicPath =
      url.pathname === '/api/health' ||
      url.pathname === '/robots.txt' ||
      url.pathname === '/sitemap.xml';

    if (!isToolsHost && url.pathname === AUTH_PATH && request.method === 'POST') {
      return handleAuth(request);
    }

    if (!isToolsHost && !isPublicPath && !isAuthenticated(request)) {
      return html(renderAuthPage(), 401);
    }

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        name: 'dp-yuyuhome',
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === '/api/tools/totp' && request.method === 'POST') {
      try {
        const { secret } = (await request.json()) as { secret?: string };

        if (typeof secret !== 'string') {
          return json({ error: '请求体中缺少 secret' }, { status: 400 });
        }

        const result = await generateTotp(secret);
        return json(result);
      } catch (error) {
        return json(
          {
            error: error instanceof Error ? error.message : '验证码生成失败',
          },
          { status: 400 },
        );
      }
    }

    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('text/html')) {
      return rewriteHtmlMetadata(response, getPageMetadata(url));
    }

    return response;
  },
};
