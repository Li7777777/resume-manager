// 极简 API 客户端
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  let data: any
  try {
    data = await res.json()
  } catch {
    throw new Error('响应解析失败')
  }
  if (data && data.ok === false) throw new Error(data.error || '请求失败')
  return data as T
}

async function upload<T>(url: string, file: File): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      // 413 等中间件错误可能返回非 JSON，保留 HTTP 状态。
    }
    throw new Error(message)
  }
  const data = await res.json()
  if (data && data.ok === false) throw new Error(data.error || '上传失败')
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, file: File) => upload<T>(url, file),
}
