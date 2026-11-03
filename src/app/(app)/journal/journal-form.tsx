"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import type { DraftResponse } from "@/lib/ai/types";
import { STORE_NAME, type Store } from "@/lib/books/parse-store-url";
import { countChars, JOURNAL_MAX } from "@/lib/text";
import { saveJournal, type ActionState } from "./actions";

type Book = { id: string; title: string; store: Store };
type AiState = "idle" | "loading" | "result" | "failed" | "quota" | "noprovider";

export function JournalForm({
  cycleId,
  round,
  books,
  initial,
  aiLeft: aiLeft0,
}: {
  cycleId: string;
  round: string;
  books: Book[];
  initial: { requestId: string | null; body: string } | null;
  aiLeft: number;
}) {
  const [bookId, setBookId] = useState(initial?.requestId ?? books[0]?.id ?? "");
  const [memo, setMemo] = useState("");
  const [body, setBody] = useState(initial?.body ?? "");
  const [ai, setAi] = useState<AiState>("idle");
  const [draft, setDraft] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aiLeft, setAiLeft] = useState(aiLeft0);
  const [aiUsed, setAiUsed] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);
  const inflight = useRef<AbortController>(undefined);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveJournal, null);

  const n = countChars(body);
  const counterClass = n > JOURNAL_MAX ? "j-count over" : n >= 450 ? "j-count near" : "j-count";

  async function makeDraft() {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setAi("loading");
    setCopied(null);
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: bookId, memo }),
        signal: controller.signal,
      });
      const data = (await res.json()) as DraftResponse;
      setAiLeft(data.left);
      if (data.ok) {
        setDraft(data.text);
        setAi("result");
      } else {
        setPrompt(data.prompt ?? "");
        setAi(data.reason === "QUOTA" ? "quota" : data.reason === "NO_PROVIDER" ? "noprovider" : "failed");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setAi("failed");
    }
  }

  function insertDraft() {
    setUndo(body);
    setBody(draft);
    setAiUsed(true);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("ok");
    } catch {
      setCopied("manual");
    }
  }

  return (
    <div className="split split-j">
      <form action={action} className="form" aria-label="일지 작성">
        <input type="hidden" name="cycleId" value={cycleId} />
        <input type="hidden" name="round" value={round} />
        <input type="hidden" name="aiAssisted" value={aiUsed ? "1" : "0"} />
        <div className="field">
          <label className="label" htmlFor="j-book">책</label>
          {books.length > 1 ? (
            <>
              <select className="select" id="j-book" name="requestId" value={bookId} onChange={(e) => setBookId(e.target.value)}>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>{b.title} · {STORE_NAME[b.store]}</option>
                ))}
              </select>
              <span className="hint">이 회차에 신청한 책 {books.length}권 중 1권을 골라요</span>
            </>
          ) : (
            <>
              <div className="fixed-val" id="j-book">{books[0]?.title}</div>
              <input type="hidden" name="requestId" value={bookId} />
            </>
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="j-memo">인상 깊었던 점 <small>선택 · AI 초안에 반영</small></label>
          <input className="input" id="j-memo" value={memo} maxLength={300} onChange={(e) => setMemo(e.target.value)} placeholder="한 줄이면 충분해요" />
          <span className="hint">AI로 보내는 내용이에요. 개인정보·회사 정보는 넣지 마세요.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="j-body">독후감</label>
          <textarea
            className={`textarea journal-body${n > JOURNAL_MAX ? " is-err" : ""}`}
            id="j-body"
            name="body"
            value={body}
            onChange={(e) => { setBody(e.target.value); setUndo(null); }}
            placeholder="읽고 나서 남은 생각을 자유롭게 적어 주세요."
            aria-describedby="j-count"
          />
        </div>
        <div className="j-foot">
          <span className={counterClass}>
            <span id="j-count" className="j-num" aria-live="polite">
              {n > JOURNAL_MAX ? `${n} / ${JOURNAL_MAX}자 · ${n - JOURNAL_MAX}자 줄여 주세요` : `${n} / ${JOURNAL_MAX}자`}
            </span>
            <span className="j-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (n / JOURNAL_MAX) * 100)}%` }} />
            </span>
          </span>
          <span className="row-gap">
            {initial && <Link className="btn btn-ghost" href={`/journal?round=${round}`}>취소</Link>}
            <button className="btn btn-primary" type="submit" disabled={pending || n === 0 || n > JOURNAL_MAX || !bookId}>
              {pending ? "저장하는 중…" : initial ? "수정 저장" : "제출하기"}
            </button>
          </span>
        </div>
        {undo !== null && (
          <p className="msg msg-info" role="status">
            <Icon name="info" />AI 초안을 본문에 넣었어요. 내 말로 다듬어 주세요.
            <button className="link" type="button" onClick={() => { setBody(undo); setUndo(null); }}>되돌리기</button>
          </p>
        )}
        {state && !state.ok && <p className="note note-danger" role="alert"><Icon name="alertc" /><span>{state.message}</span></p>}
      </form>

      <aside className="ai-panel" aria-label="AI 초안">
        <div className="ai-head">
          <h2><Icon name="spark" />AI 초안</h2>
          <span>오늘 남은 횟수 {aiLeft}/10</span>
        </div>
        <div className="ai-body">
          <p className="note note-warn"><Icon name="alert" /><span>무료 AI라 입력 내용이 학습에 쓰일 수 있어요. 개인정보·회사 정보는 넣지 마세요.</span></p>
          {ai === "idle" && (
            <>
              <p className="ai-txt">고른 책의 소개글과 메모를 바탕으로 350~450자 초안을 만들어요. 결과를 확인한 뒤 본문에 넣을 수 있어요.</p>
              <div className="row-gap">
                <button className="btn btn-sm btn-primary" type="button" onClick={makeDraft} disabled={!aiLeft || !bookId}><Icon name="spark" />초안 만들기</button>
              </div>
            </>
          )}
          {ai === "loading" && (
            <>
              <div className="ai-out" aria-busy="true"><div className="skel" style={{ width: "92%" }} /><div className="skel" /><div className="skel" style={{ width: "76%" }} /></div>
              <div className="row-gap"><button className="btn btn-sm btn-ghost" type="button" onClick={() => { inflight.current?.abort(); setAi("idle"); }}>취소</button></div>
            </>
          )}
          {ai === "result" && (
            <>
              <p className="hint">결과 · {countChars(draft)}자 · 책 소개와 내 메모를 바탕으로 만들었어요</p>
              <div className="ai-out">{draft}</div>
              <p className="hint">AI 초안이에요. 내 말로 다듬어 주세요.</p>
              <div className="row-gap">
                <button className="btn btn-sm" type="button" onClick={makeDraft} disabled={!aiLeft}>다시 만들기 · 1회 차감</button>
                <button className="btn btn-sm btn-primary" type="button" onClick={insertDraft}>본문에 넣기</button>
              </div>
            </>
          )}
          {(ai === "failed" || ai === "quota" || ai === "noprovider") && (
            <>
              <p className={`note${ai === "failed" ? " note-danger" : ""}`}>
                <Icon name={ai === "failed" ? "alertc" : "info"} />
                <span>
                  {ai === "failed" && "지금은 초안을 만들 수 없어요. 횟수는 차감하지 않았어요."}
                  {ai === "quota" && "오늘은 다 썼어요. 내일 다시 10회 쓸 수 있어요."}
                  {ai === "noprovider" && "AI 키가 아직 설정되지 않았어요."}{" "}
                  프롬프트를 복사해서 다른 AI 도구에 붙여넣을 수 있어요.
                </span>
              </p>
              <div className="row-gap">
                <button className="btn btn-sm" type="button" onClick={copyPrompt} disabled={!prompt}><Icon name="copy" />프롬프트 복사</button>
                {ai === "failed" && <button className="btn btn-sm btn-primary" type="button" onClick={makeDraft}>다시 시도</button>}
              </div>
              {copied === "ok" && <p className="msg msg-ok"><Icon name="checkc" />복사했어요. 다른 AI 도구에 붙여넣어 주세요.</p>}
              {copied === "manual" && <textarea className="textarea" readOnly value={prompt} aria-label="프롬프트" onFocus={(e) => e.currentTarget.select()} />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
