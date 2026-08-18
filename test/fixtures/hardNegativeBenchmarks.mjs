// Hard negatives here are negative only for the "quote of the session" ranking.
// A line may still be funny or valuable for another award such as catchphrase,
// wolf-cried-again, celebration, or emotional peak.
export const hardNegativeBenchmarks = [
  {
    id: "zh-punctuation-bait",
    language: "zh",
    gold: "等等，不对，我们一直在修错的模块。真正的问题根本不在这里。",
    negatives: [
      "太棒了！！！！！！",
      "终于搞定了！！！",
      "这也太离谱了！！！",
      "重大发现！！！",
      "好消息！！！问题解决了！！！",
    ],
    note: "Pure excitement, punctuation, and a bare discovery lead-in should not beat an explicit reversal with a concrete change of direction in the quote-of-session ranking. These lines may still be interesting in other categories.",
  },
  {
    id: "en-confidence-bait",
    language: "en",
    gold: "Wait — no, I was wrong; we have been fixing the wrong layer this whole time.",
    negatives: [
      "Absolutely! This is definitely the root cause!!!",
      "Found it!!!",
      "Great news — everything is fixed!",
      "This is clearly the exact issue.",
      "Perfect! We finally found the bug!",
    ],
    note: "Confidence escalation and celebratory wording should not outrank an explicit self-correction plus reversal as the single best quote.",
  },
  {
    id: "zh-generic-resolution-bait",
    language: "zh",
    gold: "我收回刚才的结论：不是缓存失效，而是我们从一开始就读错了配置源。",
    negatives: [
      "问题已经彻底解决了！",
      "现在可以确定根因了！",
      "终于修好了！！！",
      "这次应该真的没问题了。",
      "我已经确认了真正的问题。",
    ],
    note: "Generic completion/root-cause declarations should stay below a line that actually retracts and replaces an earlier explanation in quote ranking.",
  },
  {
    id: "en-apology-bait",
    language: "en",
    gold: "You're right — I was wrong about the parser; the failure is actually caused before parsing even starts.",
    negatives: [
      "You're absolutely right. My mistake.",
      "Sorry about that!",
      "I apologize — I got that wrong.",
      "Thanks for catching that!",
      "Good catch!!!",
    ],
    note: "A bare apology is not automatically the best quote; the correction should carry an actual reversal or payoff.",
  },
  {
    id: "zh-keyword-stuffing-bait",
    language: "zh",
    gold: "重大发现！！！我们前面的路线完全错了！",
    negatives: [
      "根因、真正的问题、重大突破、完全确定！！！",
      "重大发现！根因就是这个问题！",
      "现在已经可以完全确定真正的根因了。",
      "重大突破！！！问题非常明确！！！",
    ],
    note: "A pile of high-value trigger words should still lose to a line where discovery, reversal, confidence, and dramatic expression reinforce each other.",
  },
  {
    id: "en-keyword-stuffing-bait",
    language: "en",
    gold: "Wait — no, I was wrong; our whole approach was wrong.",
    negatives: [
      "Major breakthrough — exact root cause, definitely found it!!!",
      "Root cause confirmed — exact issue identified.",
      "Wait — found it, root cause!!!",
      "This is definitely, clearly, exactly the real issue!",
    ],
    note: "Keyword density by itself should not beat a compact self-correction plus explicit reversal. Subtle semantic plot twists are reserved for the later context layer.",
  },
];
