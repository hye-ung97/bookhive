import type { ReactNode } from "react";
import type { ReceiptView } from "@/lib/receipts";
import { Icon } from "./icon";

/** Slack 서식 일부(*굵게*, _기울임_)와 "@이름" 멘션 강조 */
function rich(text: string): ReactNode[] {
  return text.split(/(@[가-힣A-Za-z]{2,10}|\*[^*\n]+\*|_[^_\n]+_)/).map((p, i) => {
    if (p.startsWith("@")) return <span key={i} className="mention">{p}</span>;
    if (/^\*[^*]+\*$/.test(p)) return <b key={i}>{p.slice(1, -1)}</b>;
    if (/^_[^_]+_$/.test(p)) return <i key={i}>{p.slice(1, -1)}</i>;
    return p;
  });
}

/** Slack 메시지 미리보기. thread가 있으면 스레드 답글(본문·버튼·첨부 이미지)까지 보여 준다 */
export function SlackPreview({ text, thread }: { text: string; thread?: { text: string; button?: string; files?: ReceiptView[] } }) {
  const files = thread?.files ?? [];
  return (
    <div className="slack" aria-label="Slack 메시지 미리보기">
      <span className="slack-av"><Icon name="bookmark" /></span>
      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
        <p className="slack-meta"><b>시끌북적 봇</b><span>지금</span></p>
        <p className="slack-text">{rich(text)}</p>
        {thread && (
          <div className="slack-thread" aria-label="스레드 답글">
            <p className="slack-meta"><b>시끌북적 봇</b><span>스레드 답글</span></p>
            <p className="slack-text">{rich(thread.text)}</p>
            {thread.button && <span className="slack-btn">{thread.button}</span>}
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
        )}
      </div>
    </div>
  );
}
