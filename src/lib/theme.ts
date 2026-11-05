// 화면 모드. system이면 <html>에 data-theme을 달지 않아 CSS가 기기 설정(prefers-color-scheme)을 따른다.
// 쿠키에 남겨 두면 루트 레이아웃이 첫 HTML부터 같은 값으로 그려 깜빡이지 않는다
export type Theme = "system" | "light" | "dark";

export const THEME_COOKIE = "theme";

export const THEME_LABEL: Record<Theme, string> = { system: "기기 설정", light: "밝은 화면", dark: "어두운 화면" };

export const parseTheme = (value: string | undefined): Theme => (value === "light" || value === "dark" ? value : "system");

/** 화면 모드 버튼을 한 번 누르면 넘어갈 다음 모드. 기기 설정 → 밝은 화면 → 어두운 화면 → 기기 설정으로 돈다 */
export function nextTheme(current: Theme): Theme {
  switch (current) {
    case "system":
      return "light";
    case "light":
      return "dark";
    case "dark":
      return "system";
  }
}

/** <html data-theme>을 바로 바꾸고 1년짜리 쿠키에 남긴다. system은 둘 다 지운다 (브라우저에서만 부른다) */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
    document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`;
  } else {
    root.dataset.theme = theme;
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  }
}
