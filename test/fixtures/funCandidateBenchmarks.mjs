// These are not hard negatives. They are intentionally fun DSH/DeepSeek-style
// lines that may lose the single "quote of the session" slot while still being
// excellent candidates for other awards.
export const funCandidateBenchmarks = [
  {
    id: "dsh-clarity-catchphrase",
    text: "好，现在问题已经非常清楚了！",
    repetitionCount: 6,
    expect: { catchphrase: 70 },
    note: "Repeated clarity announcements should become a catchphrase signal rather than being discarded as boring.",
  },
  {
    id: "dsh-progress-announcement",
    text: "重大进展！！！现在已经非常接近根因了！",
    repetitionCount: 1,
    expect: { progress: 60, drama: 45 },
    note: "Progress announcements are part of the entertainment texture even when they are not the final gold quote.",
  },
  {
    id: "dsh-root-cause-wolf-cry",
    text: "这次真的找到根因了！！！",
    repetitionCount: 5,
    expect: { discovery: 55, wolfCry: 65, catchphrase: 60 },
    note: "Repeated root-cause declarations are prime wolf-cried-again material.",
  },
  {
    id: "dsh-emotional-peak",
    text: "这也太诡异了！！！",
    repetitionCount: 1,
    expect: { drama: 45 },
    note: "A short emotional reaction can be an emotional-peak candidate even without a reversal.",
  },
  {
    id: "dsh-premature-victory",
    text: "这次应该真的没问题了！",
    repetitionCount: 1,
    expect: { celebration: 55 },
    note: "Victory-lap language is useful for a premature-celebration award, especially when later context disproves it.",
  },
  {
    id: "dsh-self-congratulation",
    text: "完美命中！！！",
    repetitionCount: 1,
    expect: { celebration: 60, drama: 35 },
    note: "Self-congratulation should survive as a fun category candidate rather than being treated as noise.",
  },
  {
    id: "dsh-full-plot-twist",
    text: "重大发现！！！我们前面的路线完全错了！",
    repetitionCount: 1,
    expect: { quote: 80, discovery: 50, reversal: 60, drama: 55 },
    note: "A true plot-twist line can be strong across several dimensions at once.",
  },
];
