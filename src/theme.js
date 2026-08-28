// ---------- design tokens (YOMU) ----------
export const T = {
  bg: "transparent",

  // 面
  card: "#FFFFFF", surface2: "#FBFBF9", paper: "#F7F7F4",

  // 文字
  ink: "#14202F", sub: "#41526A", faint: "#6B7B91",

  // 罫線
  line: "#E4E4DE", line2: "#D2D6DC",

  // 藍（ブランド主色）
  navy: "#12233F", blue: "#1E3E6B", blue2: "#2F5488", teal: "#4A74AB",
  grad: "linear-gradient(180deg,#2a548c 0%,#1E3E6B 100%)",

  // シナリオ2色（グラフとKPIの対比に使う）
  scenario: "#1E3E6B",              // 現実シナリオ = 藍・実線
  scenarioSoft: "rgba(30,62,107,.20)",
  opt: "#DBA53F",                   // 楽観シナリオ = 山吹・破線
  optSoft: "rgba(219,165,63,.16)",

  // 危険・警告・良好
  real: "#C0392B",                  // 危険（キー名は互換のため据え置き。§2参照）
  realSoft: "rgba(192,57,43,.09)",
  danger: "#C0392B", dangerSoft: "rgba(192,57,43,.09)",
  warnBg: "#FDF5E3", warnInk: "#8A5A12", warnLine: "#EBD5A4",
  good: "#12795A", goodSoft: "#E6F4EF", goodLine: "#B6E0D0",

  // 山吹（ラベル・アクセント）
  gold: "#B8821F", gold2: "#DBA53F", goldSoft: "#FBF3E2",
  gradGold: "linear-gradient(180deg,#D09A2E 0%,#B8821F 100%)",

  // AI関連（青緑をやめて山吹系へ）
  aiBg: "rgba(184,130,31,.08)", aiInk: "#93671A", aiLine: "rgba(184,130,31,.35)",

  // 書体
  serif: '"Noto Serif JP",serif',
  sans: '"Zen Kaku Gothic New","Hiragino Sans","Yu Gothic",sans-serif',
  mono: '"JetBrains Mono",ui-monospace,Menlo,monospace',

  // 角丸
  r: 16, rS: 10, rXs: 8, pill: 999,

  // 影（この3つ以外の影を新規に作らない）
  sh1: "0 1px 2px rgba(18,35,63,.05), 0 6px 18px -10px rgba(18,35,63,.22)",
  sh2: "0 2px 4px rgba(18,35,63,.05), 0 18px 40px -20px rgba(18,35,63,.35)",
  sh3: "0 30px 70px -30px rgba(18,35,63,.45)",
};
