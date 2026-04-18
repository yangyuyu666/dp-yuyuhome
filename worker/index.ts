type AssetsBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type Env = {
  ASSETS: AssetsBinding;
};

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

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        name: 'dp-yuyuhome',
        timestamp: new Date().toISOString(),
      });
    }

    return env.ASSETS.fetch(request);
  },
};
