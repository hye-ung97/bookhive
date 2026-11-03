"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icon";
import type { CycleDoc } from "@/lib/rounds";
import { updateDocLinks, type ActionState } from "./actions";

const DOCS = [
  { key: "plan", field: "planUrl", label: "활동 계획서" },
  { key: "report", field: "reportUrl", label: "활동 보고서" },
] as const;

function sourceOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return /^(docs|drive)\.google\.com$/.test(host) ? "Google Drive" : host;
  } catch {
    return "링크";
  }
}

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p className={`msg ${state.ok ? "msg-ok" : "msg-err"}`} role="status">
      <Icon name={state.ok ? "checkc" : "alertc"} />
      {state.message}
    </p>
  );
}

/** 회사에 내는 활동 계획서·보고서 링크. 평소엔 바로 여는 링크만, [링크 수정]을 눌러야 입력칸 */
export function DocLinks({ cycleId, title, plan, report, overdue }: {
  cycleId: string; title: string; plan: string | null; report: string | null; overdue: CycleDoc[];
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await updateDocLinks(prev, fd);
    if (result?.ok) setEditing(false);
    return result;
  }, null);
  const urls = { plan, report };

  return (
    <section className="docs-sec" aria-labelledby="doc-h">
      <div className="block-head">
        <h2 className="t-heading" id="doc-h">{title}</h2>
        {!editing && (
          <button className="btn btn-sm" type="button" onClick={() => setEditing(true)}>
            <Icon name="pen" />{plan || report ? "링크 수정" : "링크 넣기"}
          </button>
        )}
      </div>

      {editing ? (
        <form action={action} className="form docs-form">
          <input type="hidden" name="cycleId" value={cycleId} />
          <div className="form-grid">
            {DOCS.map((d) => (
              <div key={d.key} className="field">
                <label className="label" htmlFor={`doc-${d.key}`}>{d.label}</label>
                <input className="input" id={`doc-${d.key}`} name={d.field} type="url" pattern="https://.+" title="https://로 시작하는 주소"
                  maxLength={2000} placeholder="https://docs.google.com/…" defaultValue={urls[d.key] ?? ""} />
              </div>
            ))}
          </div>
          <span className="hint">비워 두고 저장하면 그 링크를 지워요.</span>
          <div className="row-gap" style={{ justifyContent: "space-between" }}>
            {state && !state.ok ? <Result state={state} /> : <span />}
            <span className="row-gap">
              <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>취소</button>
              <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "저장하는 중…" : "저장"}</button>
            </span>
          </div>
        </form>
      ) : (
        <>
          <div className="docs">
            {DOCS.map((d) => {
              const url = urls[d.key];
              if (url) {
                return (
                  <a key={d.key} className="doc" href={url} target="_blank" rel="noopener noreferrer" aria-label={`${d.label} 새 탭에서 열기`}>
                    <span className="doc-txt"><b>{d.label}</b><span className="doc-sub">{sourceOf(url)}</span></span>
                    <Icon name="link" />
                  </a>
                );
              }
              const due = overdue.includes(d.key);
              return (
                <div key={d.key} className={`doc is-empty${due ? " is-due" : ""}`}>
                  <span className="doc-txt">
                    <b>{d.label}</b>
                    {due
                      ? <span className="mark warn">낼 때가 됐는데 링크가 비어 있어요</span>
                      : <span className="doc-sub">아직 링크가 없어요</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {state?.ok && <Result state={state} />}
        </>
      )}
    </section>
  );
}
