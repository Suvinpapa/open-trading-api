/**
 * API 클라이언트 공통 설정
 */

// Next.js 개발 서버의 30초 timeout 회피를 위해 8003 서버로 다이렉트 통신
const API_BASE = "http://127.0.0.1:8003";

export interface ApiResponse<T> {
  status: "success" | "error";
  data?: T;
  message?: string;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || `API Error: ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || `API Error: ${res.status}`);
  }
  return res.json();
}

export async function apiPostForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || `API Error: ${res.status}`);
  }
  return res.json();
}

export async function apiGetBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Download Error: ${res.status}`);
  }
  return res.blob();
}

export async function apiPostBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Download Error: ${res.status}`);
  }
  return res.blob();
}

export { API_BASE };
