import "server-only";
import { createAdminClient } from "./supabase/admin";

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

export type ReceiptView = {
  id: string;
  bundle_id: string | null;
  coffee_plan_id: string | null;
  file_name: string;
  mime: string | null;
  size_bytes: number | null;
  external_ref: string | null;
  created_at: string;
  /** 이미지 썸네일용 1시간짜리 signed URL */
  thumb_url: string | null;
};

type ReceiptRow = Omit<ReceiptView, "thumb_url"> & { storage_path: string | null };

/** 영수증 목록 + 이미지 썸네일 signed URL (비공개 버킷이라 매번 짧은 링크를 만든다) */
export async function withThumbs(rows: ReceiptRow[]): Promise<ReceiptView[]> {
  const images = rows.filter((r) => r.storage_path && r.mime?.startsWith("image/") && !r.mime.includes("hei"));
  const urls = new Map<string, string>();
  if (images.length) {
    const { data } = await createAdminClient()
      .storage.from("receipts")
      .createSignedUrls(images.map((r) => r.storage_path!), 3600);
    data?.forEach((d) => d.path && d.signedUrl && urls.set(d.path, d.signedUrl));
  }
  return rows.map(({ storage_path, ...r }) => ({ ...r, thumb_url: storage_path ? (urls.get(storage_path) ?? null) : null }));
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf",
};

/** 업로드용 signed URL. 경로: {회차}/{묶음|커피}/{uuid}.{확장자} */
export async function createReceiptUpload(cycleKey: string, ownerId: string, mime: string) {
  const path = `${cycleKey}/${ownerId}/${crypto.randomUUID()}.${EXT[mime] ?? "bin"}`;
  const { data, error } = await createAdminClient().storage.from("receipts").createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("upload_url_failed");
  return { path: data.path, token: data.token };
}

export async function removeReceiptFiles(paths: string[]) {
  const list = paths.filter(Boolean);
  if (list.length) await createAdminClient().storage.from("receipts").remove(list);
}

export async function signedViewUrl(path: string): Promise<string | null> {
  const { data } = await createAdminClient().storage.from("receipts").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
