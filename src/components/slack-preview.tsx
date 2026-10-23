import type { ReceiptView } from "@/lib/receipts";
import { Icon } from "./icon";

/** Slack 메시지 미리보기. "@이름"은 멘션처럼 강조 */
export function SlackPreview({ text, files = [] }: { text: string; files?: ReceiptView[] }) {
  const parts = text.split(/(@[가-힣A-Za-z]{2,10})/);
  return (
    <div className="slack" aria-label="Slack 메시지 미리보기">
      <span className="slack-av"><Icon name="bookmark" /></span>
      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
        <p className="slack-meta"><b>시끌북적 봇</b><span>지금</span></p>
        <p className="slack-text">
          {parts.map((p, i) => (p.startsWith("@") ? <span key={i} className="mention">{p}</span> : p))}
        </p>
        {files.length > 0 && (
          <div className="slack-files">
            {files.map((f) =>
              f.thumb_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL 미리보기
                <img key={f.id} src={f.thumb_url} alt={f.file_name} />
              ) : (
                <span key={f.id} className="slack-file"><Icon name="file" />{f.file_name}</span>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
