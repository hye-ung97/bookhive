import { describe, expect, it } from "vitest";
import { parseSlackId, slackIdError } from "@/lib/slack-id";

describe("Slack 멤버 ID 입력", () => {
  it("ID를 그대로, 앞뒤 공백·소문자는 고쳐 받음", () => {
    expect(parseSlackId("U04AB12CD3E")).toBe("U04AB12CD3E");
    expect(parseSlackId("  u04ab12cd3e \n")).toBe("U04AB12CD3E");
    expect(parseSlackId("W012A3CDE")).toBe("W012A3CDE");
  });

  it("프로필 링크를 붙여 넣으면 ID만 골라냄", () => {
    expect(parseSlackId("https://bookclub.slack.com/team/U04AB12CD3E")).toBe("U04AB12CD3E");
    expect(parseSlackId("https://app.slack.com/client/T0123/C0456/user_profile/U04AB12CD3E")).toBe("U04AB12CD3E");
    expect(parseSlackId("https://bookclub.slack.com/team/U04AB12CD3E?x=1")).toBe("U04AB12CD3E");
  });

  it("표시 이름·채널 ID·빈 칸·이상한 글자는 못 받음", () => {
    for (const bad of ["", "   ", "@민지", "민지", "C0456ABCD", "T0123ABCD", "U04AB-12CD", "U12", "https://bookclub.slack.com/archives/C0456ABCD"]) {
      expect(parseSlackId(bad)).toBeNull();
    }
  });

  it("오류 문구: 비었을 때, 표시 이름을 넣었을 때, 그 밖", () => {
    expect(slackIdError("")).toBe("Slack 멤버 ID를 넣어 주세요.");
    expect(slackIdError("@민지")).toBe("Slack 멤버 ID는 U로 시작하는 영문·숫자예요. 표시 이름(@민지)은 넣을 수 없어요.");
    expect(slackIdError("C0456ABCD")).toBe("Slack 멤버 ID는 U로 시작하는 영문·숫자예요 (예: U04AB12CD3E).");
    expect(slackIdError("u04ab12cd3e")).toBeNull();
  });
});
