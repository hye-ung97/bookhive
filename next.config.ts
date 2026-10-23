import type { NextConfig } from "next";

// 모든 화면이 로그인 사용자별이라 Cache Components(정적 셸 + Suspense)를 쓰지 않고 요청마다 렌더링한다
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
