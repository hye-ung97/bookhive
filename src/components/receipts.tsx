"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { attachReceipt, deleteReceipt, prepareReceiptUpload, type ReceiptOwner } from "@/app/(app)/admin/receipt-actions";
import type { ReceiptView } from "@/lib/receipts";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Icon } from "./icon";

const MAX_BYTES = 10 * 1024 * 1024;
const fmtSize = (n: number) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1048576).toFixed(1)}MB`);

/** HEIC는 브라우저가 type을 비워 줄 때가 있어 확장자로 판정 */
function mimeOf(file: File): string | null {
  if (/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.type === "application/pdf") return file.type;
  if (/\.hei[cf]$/i.test(file.name)) return "image/heic";
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  return null;
}

/** 휴대폰 사진(3~5MB)을 긴 변 1600px·JPEG 0.8로 줄여 업로드 시간과 무료 저장 용량을 아낀다 */
async function compress(file: File, mime: string): Promise<{ blob: Blob; mime: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return { blob: file, mime };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.8));
    return blob && blob.size < file.size ? { blob, mime: "image/jpeg" } : { blob: file, mime };
  } catch {
    return { blob: file, mime };
  }
}

type Pending = { key: string; name: string; label: string };

export function Receipts({
  owner,
  receipts,
  label = "영수증",
  warnIfEmpty = false,
  lastDeleteWarning,
}: {
  owner: ReceiptOwner;
  receipts: ReceiptView[];
  label?: string;
  warnIfEmpty?: boolean;
  /** 마지막 영수증을 지울 때 보여줄 경고 */
  lastDeleteWarning?: string;
}) {
  const router = useRouter();
  const inputId = `rc-${owner.kind}-${owner.id}`;
  const [pending, setPending] = useState<Pending[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = useRef(false);

  const update = (key: string, label: string) => setPending((list) => list.map((p) => (p.key === key ? { ...p, label } : p)));

  async function upload(files: File[]) {
    if (busy.current) return;
    busy.current = true;
    setMessage(null);
    const supabase = createBrowserSupabase();
    let done = 0;
    for (const file of files) {
      const mime = mimeOf(file);
      if (!mime) { setMessage({ ok: false, text: `이미지·PDF만 올릴 수 있어요 · ${file.name}` }); continue; }
      if (file.size > MAX_BYTES) { setMessage({ ok: false, text: `10MB 이하만 올릴 수 있어요 · ${file.name}` }); continue; }
      const key = crypto.randomUUID();
      setPending((list) => [...list, { key, name: file.name, label: mime.startsWith("image/") ? "압축 중…" : "올리는 중…" }]);
      try {
        const out = await compress(file, mime);
        update(key, "올리는 중…");
        const prepared = await prepareReceiptUpload(owner, out.mime, out.blob.size);
        if (!prepared.ok) throw new Error(prepared.message);
        const { error } = await supabase.storage.from("receipts").uploadToSignedUrl(prepared.path, prepared.token, out.blob, { contentType: out.mime });
        if (error) throw new Error("업로드하지 못했어요. 다시 시도해 주세요.");
        const name = out.mime !== mime ? file.name.replace(/\.[^.]+$/, "") + ".jpg" : file.name;
        const saved = await attachReceipt(owner, prepared.path, name, out.mime, out.blob.size);
        if (!saved.ok) throw new Error(saved.message);
        done += 1;
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : "업로드하지 못했어요." });
      } finally {
        setPending((list) => list.filter((p) => p.key !== key));
      }
    }
    busy.current = false;
    if (done) {
      setMessage({ ok: true, text: `영수증 ${done}개를 올렸어요` });
      router.refresh();
    }
  }

  async function remove(id: string) {
    const result = await deleteReceipt(id);
    setConfirmId(null);
    setMessage({ ok: result.ok, text: result.message });
    router.refresh();
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]);
  };
  const confirming = receipts.find((r) => r.id === confirmId);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div
        className={`receipts${dragging ? " is-drag" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={onDrop}
      >
        <span className="t-cap">{label}</span>
        {warnIfEmpty && !receipts.length && !pending.length && <span className="badge b-warn">영수증 없음</span>}
        {receipts.map((r) => {
          const pdf = r.mime === "application/pdf";
          return (
            <div key={r.id} className="rcpt">
              <a className="rc-open" href={`/admin/receipts/${r.id}`} target="_blank" rel="noopener" aria-label={`영수증 ${r.file_name} 새 탭에서 보기`}>
                {r.thumb_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 1시간짜리 signed URL이라 next/image 최적화 대상이 아님
                  <img src={r.thumb_url} alt="" />
                ) : (
                  <span className={`rc-ic${pdf ? " pdf" : ""}`}>{pdf ? "PDF" : <Icon name="receipt" />}</span>
                )}
                <span className="rc-txt">
                  <span className="rc-name">{r.file_name}</span>
                  <span className="rc-meta">{r.size_bytes ? fmtSize(r.size_bytes) : "링크"}</span>
                </span>
              </a>
              <button className="rc-x" type="button" aria-label={`영수증 ${r.file_name} 삭제`} title="삭제" onClick={() => setConfirmId(r.id)}>
                <Icon name="x" />
              </button>
            </div>
          );
        })}
        {pending.map((p) => (
          <div key={p.key} className="rcpt is-busy" aria-busy="true">
            <span className="rc-ic"><Icon name="receipt" /></span>
            <span className="rc-txt">
              <span className="rc-name">{p.name}</span>
              <span className="rc-meta">{p.label}</span>
            </span>
          </div>
        ))}
        <label className="btn btn-sm rc-add" htmlFor={inputId}>
          <Icon name="plus" />이미지·PDF
        </label>
        <input
          className="sr-only-input"
          id={inputId}
          type="file"
          accept="image/*,application/pdf,.heic,.heif"
          multiple
          onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; if (files.length) upload(files); }}
        />
      </div>
      {confirming && (
        <div className="note note-warn" role="alertdialog" aria-label="영수증 삭제 확인">
          <Icon name="alert" />
          <span className="stack" style={{ gap: 6 }}>
            <span>
              &quot;{confirming.file_name}&quot;을 삭제할까요? 삭제한 파일은 되돌릴 수 없고, 누가 지웠는지는 변경 이력에 남아요.
              {receipts.length === 1 && lastDeleteWarning ? ` ${lastDeleteWarning}` : ""}
            </span>
            <span className="row-gap">
              <button className="btn btn-sm btn-danger" type="button" onClick={() => remove(confirming.id)}>삭제</button>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => setConfirmId(null)}>취소</button>
            </span>
          </span>
        </div>
      )}
      {message && (
        <p className={`msg ${message.ok ? "msg-ok" : "msg-err"}`} role="status">
          <Icon name={message.ok ? "checkc" : "alertc"} />
          {message.text}
        </p>
      )}
    </div>
  );
}
