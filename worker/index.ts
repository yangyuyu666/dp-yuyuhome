import { generateTotp } from './totp';

type AssetsBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type Env = {
  ASSETS: AssetsBinding;
};

// Keep JSON responses consistent for Worker-side API endpoints.
function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    headers: {
      'cache-control': 'no-store',
    },
    ...init,
  });
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
    return env.ASSETS.fetch(request);
  },
};
