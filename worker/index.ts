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

// Keep JSON responses consistent for Worker-side API endpoints.
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Requests under /api/* are handled by the Worker itself.
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

    // Everything else falls back to the built frontend assets.
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('text/html')) {
      return rewriteHtmlMetadata(response, getPageMetadata(url));
    }

    return response;
  },
};
