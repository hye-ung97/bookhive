// 같이 읽는 중 캐릭터: 독서 스티커 시트와 같은 그림의 책장 넘기기 GIF 25마리 (둘이 붙은 19번 쌍둥이는 한 사람이 두 마리로 보여서 뺐다)
// 파일은 GIF 8장을 가로로 이은 띠. 한 장은 화면에 앉는 크기(키 58 안팎)의 2배에 옆 장이 번지지 않게 좌우 투명 2px씩.
// glow는 다크 모드에서 테두리가 배경에 묻히지 않게 번지는 몸 색
import r01 from "./01-mint-angel.webp";
import r02 from "./02-white-bunny.webp";
import r03 from "./03-yellow-lion.webp";
import r04 from "./04-red-crab.webp";
import r05 from "./05-lime-bear.webp";
import r06 from "./06-blue-bunny.webp";
import r07 from "./07-purple-dog.webp";
import r08 from "./08-brown-mouse.webp";
import r09 from "./09-pink-snail.webp";
import r10 from "./10-hotpink-bear.webp";
import r11 from "./11-peach-bear.webp";
import r12 from "./12-black-cat.webp";
import r13 from "./13-orange-cat.webp";
import r14 from "./14-grey-mouse.webp";
import r15 from "./15-green-bunny.webp";
import r16 from "./16-magenta-lion.webp";
import r17 from "./17-yellow-dog.webp";
import r18 from "./18-cyan-bunny.webp";
import r20 from "./20-green-croc.webp";
import r21 from "./21-sky-bunny.webp";
import r22 from "./22-pink-cat.webp";
import r23 from "./23-lavender-dog.webp";
import r24 from "./24-yellow-duck.webp";
import r25 from "./25-peach-dog.webp";
import r26 from "./26-mini-bunny.webp";

/** 띠 한 줄의 장 수. globals.css의 rr-turn steps(8)과 같은 값 */
export const FRAMES = 8;

export const READERS = [
  { img: r01, glow: "#78b8a8" },
  { img: r02, glow: "#f8f8f8" },
  { img: r03, glow: "#f8f808" },
  { img: r04, glow: "#f83808" },
  { img: r05, glow: "#e8e808" },
  { img: r06, glow: "#4898e8" },
  { img: r07, glow: "#8848c8" },
  { img: r08, glow: "#c87848" },
  { img: r09, glow: "#f8a8d8" },
  { img: r10, glow: "#f83898" },
  { img: r11, glow: "#f8d898" },
  { img: r12, glow: "#b0b0b0" },
  { img: r13, glow: "#f8b808" },
  { img: r14, glow: "#c8c8c8" },
  { img: r15, glow: "#98d878" },
  { img: r16, glow: "#e838a8" },
  { img: r17, glow: "#f8d878" },
  { img: r18, glow: "#58b8c8" },
  { img: r20, glow: "#a8d818" },
  { img: r21, glow: "#d8e8f8" },
  { img: r22, glow: "#f8b8d8" },
  { img: r23, glow: "#c888c8" },
  { img: r24, glow: "#f8f828" },
  { img: r25, glow: "#f8c8a8" },
  { img: r26, glow: "#888888" },
];
