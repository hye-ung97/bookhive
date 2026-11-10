"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import type { AdminMember } from "@/lib/data";
import { parseSlackId, slackIdError } from "@/lib/slack-id";
import { findSlackByEmail, linkSlack } from "./actions";

type Props = {
  member: AdminMember;
  /** 데스크톱 표(d)와 모바일 목록(m)에 같은 칸을 두 번 그리므로 창 id를 나눈다 */
  scope: "d" | "m";
  /** Slack 봇이 설정돼 있어 ID를 확인할 수 있는지 (아니면 형식만 보고 "확인 전"으로 저장) */
  slackReady: boolean;
};

/**
 * 멤버 표의 Slack 칸(데스크톱) · 줄의 Slack 글자(모바일). 누르면 연결 창이 뜬다.
 * 연결: Slack 이름 / 확인 전: ID만 / 미연결: 빨간 표시 + [연결하기] / 탈퇴: 비움
 */
export function SlackCell({ member, scope, slackReady }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // 열 때마다 창 안을 새로 그려 지난 입력·오류를 지운다
  const [round, setRound] = useState(0);
  const open = () => {
    setRound((n) => n + 1);
    dialog.current?.showModal();
  };

  if (member.status === "left") {
    return scope === "d" ? <span className="slk-dash" aria-label="탈퇴 멤버라 Slack 연결 없음">—</span> : <>Slack —</>;
  }

  const linked = Boolean(member.slack_user_id);
  const state = member.slack_checked ? "연결" : "확인 전";
  // 이름이 아직 없으면(예전에 이메일로 자동 연결된 ID) ID를 보여 준다
  const shown = member.slack_name ?? member.slack_user_id;
  const trigger =
    scope === "d" ? (
      linked ? (
        <button className="slk" type="button" onClick={open} aria-label={`${member.name} 님 Slack ${state} ${shown} · 바꾸기`}>
          <span className={`mark ${member.slack_checked ? "ok" : "off"}`}>{state}</span>
          <span className="nm">{shown}</span>
          <Icon name="pen" />
        </button>
      ) : (
        <span className="slk-no">
          <span className="mark no">미연결</span>
          <button className="btn btn-sm" type="button" onClick={open} aria-label={`${member.name} 님 Slack 연결하기`}>연결하기</button>
        </span>
      )
    ) : (
      <button className={linked ? "slk-m" : "slk-m no"} type="button" onClick={open}>
        {linked ? `Slack ${member.slack_checked ? shown : "확인 전"}` : "Slack 연결하기"}
      </button>
    );

  return (
    <>
      {trigger}
      <dialog ref={dialog} className="dlg" aria-labelledby={`slk-${scope}-${member.id}`}>
        <SlackForm key={round} member={member} scope={scope} slackReady={slackReady} close={() => dialog.current?.close()} />
      </dialog>
    </>
  );
}

function SlackForm({ member, scope, slackReady, close }: Props & { close: () => void }) {
  const router = useRouter();
  const titleId = `slk-${scope}-${member.id}`;
  const editing = Boolean(member.slack_user_id);
  const [value, setValue] = useState(member.slack_user_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ ok: true; name: string } | { ok: false; message: string } | null>(null);
  const [looking, startLookup] = useTransition();

  const [, action, pending] = useActionState<null, FormData>(async (_prev, fd) => {
    // 형식은 보내기 전에 화면에서 막는다
    const invalid = slackIdError(String(fd.get("slackId") ?? ""));
    if (invalid) {
      setError(invalid);
      return null;
    }
    const result = await linkSlack(null, fd);
    if (result?.ok) {
      close();
      // 표 위에 "연결했어요"와 그 줄 표시
      router.replace(`/admin/members?slack=${member.id}`, { scroll: false });
    } else {
      setError(result?.message ?? "처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    return null;
  }, null);

  const lookup = () =>
    startLookup(async () => {
      const r = await findSlackByEmail(member.id);
      if (r.ok) {
        setValue(r.slackId);
        setError(null);
        setFound({ ok: true, name: r.name });
      } else {
        setFound({ ok: false, message: r.message });
      }
    });

  // 연결된 ID 그대로면 저장할 게 없다 (확인 전 ID는 봇이 설정됐으면 그대로 다시 확인할 수 있게 둔다)
  const unchanged = editing && parseSlackId(value) === member.slack_user_id && (member.slack_checked || !slackReady);
  const submitLabel = pending ? (slackReady ? "확인하는 중…" : "저장하는 중…") : !slackReady ? "확인 없이 저장" : editing ? "저장" : "연결";

  return (
    <form action={action} className="dlg-body">
      <h2 id={titleId}>{member.name} 님 Slack 연결</h2>
      {!slackReady && (
        <p className="note note-warn">
          <Icon name="alert" />
          <span>Slack 봇이 아직 설정되지 않아 ID가 맞는지 확인할 수 없어요. 형식만 보고 저장하고, 봇을 설정한 뒤 첫 알림 때 확인해요.</span>
        </p>
      )}
      {editing ? (
        <div className="slk-cur">
          <span className={`mark ${member.slack_checked ? "ok" : "off"}`}>{member.slack_checked ? "연결됨" : "확인 전"}</span>
          {member.slack_name && <b>{member.slack_name}</b>}
          <span className="id">{member.slack_user_id}</span>
        </div>
      ) : (
        slackReady && <p className="muted">마감 알림에서 멘션하려면 {member.name} 님의 Slack 멤버 ID가 필요해요.</p>
      )}

      <input type="hidden" name="id" value={member.id} />
      <div className="field">
        <label className="label" htmlFor={`${titleId}-id`}>Slack 멤버 ID <small>U로 시작해요</small></label>
        <input
          className={error ? "input slk-id is-err" : "input slk-id"}
          id={`${titleId}-id`}
          name="slackId"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
            setFound(null);
          }}
          placeholder="U04AB12CD3E"
          autoComplete="off"
          spellCheck={false}
          readOnly={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${titleId}-msg`}
        />
        {error ? (
          <p className="msg msg-err" id={`${titleId}-msg`} role="alert"><Icon name="alertc" />{error}</p>
        ) : found?.ok ? (
          <p className="msg msg-ok" id={`${titleId}-msg`} role="status"><Icon name="checkc" /><span>Slack에서 찾았어요 · <b>{found.name}</b></span></p>
        ) : (
          <p className="hint" id={`${titleId}-msg`}>
            {editing
              ? "다른 ID로 바꾸면 저장할 때 Slack에서 다시 확인해요. 연결 끊기는 없어요: 비워 두면 다음 알림 때 이메일로 다시 찾아 붙어요."
              : "Slack 프로필 링크를 붙여 넣어도 ID만 골라 넣어요."}
          </p>
        )}
      </div>

      {!editing && value.trim() === "" && (
        <>
          <p className="slk-how-t">Slack에서 멤버 ID 찾기</p>
          <ol className="slk-how">
            <li><b>1</b><span>Slack에서 <em>{member.name}</em> 님 이름을 눌러 <em>프로필 보기</em></span></li>
            <li><b>2</b><span>프로필 오른쪽 위 <em>⋮ 더보기</em></span></li>
            <li><b>3</b><span><em>멤버 ID 복사</em> → 위 칸에 붙여 넣기</span></li>
          </ol>
        </>
      )}
      {!editing && (
        <>
          <p className="slk-or">또는</p>
          <div className="slk-mail">
            <button className="btn btn-sm" type="button" onClick={lookup} disabled={!slackReady || looking || pending}>
              {looking ? "찾는 중…" : "이메일로 찾기"}
            </button>
            <span className="hint">{slackReady ? `${member.email} · Slack 가입 이메일이 같아야 찾아져요` : "Slack 봇을 설정하면 쓸 수 있어요"}</span>
            {found && !found.ok && <p className="msg msg-err" role="alert"><Icon name="alertc" />{found.message}</p>}
          </div>
        </>
      )}

      <div className="dlg-acts">
        <button className="btn btn-ghost" type="button" onClick={close}>취소</button>
        <button className="btn btn-primary" type="submit" disabled={pending || unchanged}>{submitLabel}</button>
      </div>
    </form>
  );
}
