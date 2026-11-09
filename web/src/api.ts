export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      'x-requested-with': 'dicesheet',
      ...(body !== undefined && !isForm && { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  let data: any = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T = any>(p: string, b: unknown) => request<T>('PATCH', p, b),
  put: <T = any>(p: string, b: unknown) => request<T>('PUT', p, b),
  del: <T = any>(p: string) => request<T>('DELETE', p),
};
