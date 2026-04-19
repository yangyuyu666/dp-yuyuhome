import { generateTotp } from './totp';

// 定义 Cloudflare Workers Assets 绑定的类型
type AssetsBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

// 定义当前 Worker 的环境变量，包含绑定的静态资产
type Env = {
  ASSETS: AssetsBinding;
};

// 定义 HTMLRewriter 的类型结构，用于在边缘节点动态修改 HTML
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

// 页面元数据类型，包含标题、描述和规范链接
type PageMetadata = {
  title: string;
  description: string;
  canonical: string;
};

// 获取全局的 HTMLRewriter 构造函数。由于 TypeScript 默认环境可能不包含它，这里进行了类型转换
const HTMLRewriterCtor = (globalThis as unknown as {
  HTMLRewriter: new () => HtmlRewriterLike;
}).HTMLRewriter;

// 封装一个返回 JSON 格式的辅助函数，确保所有 API 端点不被缓存
function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    headers: {
      'cache-control': 'no-store',
    },
    ...init,
  });
}

// 简单的 HTML 属性转义函数，防止注入攻击并保证 HTML 格式正确
function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// 根据当前访问的 URL，返回对应的页面 SEO 元数据
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

// 核心 HTML 重写逻辑：拦截静态文件响应，动态注入正确的 Title 和 Meta 标签
function rewriteHtmlMetadata(response: Response, metadata: PageMetadata) {
  const canonical = escapeHtmlAttribute(metadata.canonical);
  const description = escapeHtmlAttribute(metadata.description);
  const title = escapeHtmlAttribute(metadata.title);

  return new HTMLRewriterCtor()
    .on('title', {
      element(element) {
        // 替换 <title> 标签的内容
        element.setInnerContent(metadata.title);
      },
    })
    .on('head', {
      element(element) {
        // 在 <head> 标签末尾追加描述、规范链接以及 OpenGraph 社交分享标签
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

// Cloudflare Worker 的入口模块
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isToolsPage = url.hostname === 'tools.dploveyuyu.site';

    // 1. Basic Auth 基础认证保护
    // 如果不是访问工具箱，且不是访问健康检查接口，就需要输入密码
    if (!isToolsPage && url.pathname !== '/api/health') {
      const authHeader = request.headers.get('Authorization');
      // 默认账号: admin, 默认密码: dploveyuyu
      // "admin:dploveyuyu" 的 Base64 编码是 "YWRtaW46ZHBsb3ZleXV5dQ=="
      if (authHeader !== 'Basic YWRtaW46ZHBsb3ZleXV5dQ==') {
        return new Response('需要密码才能访问我们的小屋哦', {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="Love Cabin"',
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
      }
    }

    // 2. 处理内部 API 请求
    // 健康检查接口
    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        name: 'dp-yuyuhome',
        timestamp: new Date().toISOString(),
      });
    }

    // 2FA 验证码生成接口
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

    // 3. 处理前端静态文件
    // 其他所有请求直接转发给 Cloudflare Assets 获取前端打包好的文件
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') ?? '';

    // 如果返回的是 HTML 页面（比如 index.html），则通过 HTMLRewriter 注入 SEO 标签
    if (contentType.includes('text/html')) {
      return rewriteHtmlMetadata(response, getPageMetadata(url));
    }

    // 如果是 JS、CSS、图片等静态资源，直接返回
    return response;
  },
};
