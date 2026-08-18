import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSession } from "../dist/core/sessionAnalyzer.js";

function dsh(text) {
  return { role: "assistant", host: "dsh", text };
}

test("SessionAnalyzer turns a dramatic DSH session into multiple distinct awards", () => {
  const messages = [
    dsh("现在问题已经非常明确了。"),
    dsh("现在问题已经非常明确了。"),
    dsh("重大进展！！！现在已经非常接近根因了！"),
    dsh("现在问题已经非常明确了。"),
    dsh("这次真的找到根因了！！！"),
    dsh("这次真的找到根因了！！！"),
    dsh("这次真的找到根因了！！！"),
    dsh("这次应该真的没问题了！"),
    { role: "user", text: "你再确认一下。" },
    dsh("等等，不对，我们刚才高兴早了；刚才的成功只证明读路径正常，写路径还是坏的。"),
    dsh("这也太诡异了！！！"),
    dsh("完美命中！！！"),
    dsh("重大发现！！！我们前面的路线完全错了！"),
  ];

  const result = analyzeSession(messages);

  assert.equal(result.byKind.quote?.text, "重大发现！！！我们前面的路线完全错了！");

  assert.equal(result.byKind.catchphrase?.text, "现在问题已经非常明确了。");
  assert.equal(result.byKind.catchphrase?.count, 3);
  assert.ok((result.byKind.catchphrase?.score ?? 0) >= 70);

  assert.ok(result.byKind["wolf-cry"], "repeated discovery declarations should create a wolf-cry award");
  assert.ok((result.byKind["wolf-cry"]?.count ?? 0) >= 3);

  assert.equal(result.byKind["premature-celebration"]?.text, "这次应该真的没问题了！");
  assert.equal(
    result.byKind["premature-celebration"]?.relatedText,
    "等等，不对，我们刚才高兴早了；刚才的成功只证明读路径正常，写路径还是坏的。",
  );

  assert.ok(result.byKind["plot-twist"]);
  assert.ok(result.byKind["emotional-peak"]);
  assert.equal(result.byKind["progress-announcement"]?.text, "重大进展！！！现在已经非常接近根因了！");
  assert.equal(result.byKind["victory-lap"]?.text, "完美命中！！！");

  assert.equal(result.metrics.assistantMessages, 12);
  assert.ok(result.metrics.discoveryDeclarations >= 4);
  assert.ok(result.metrics.repeatedPhraseGroups >= 2);
});

test("one discovery claim alone does not trigger the wolf-cry award", () => {
  const result = analyzeSession([
    dsh("我找到了真正的根因。"),
    dsh("接下来我会修改配置。"),
  ]);

  assert.equal(result.byKind["wolf-cry"], undefined);
  assert.equal(result.metrics.discoveryDeclarations, 1);
});

test("repetition can create a catchphrase even when the line is a weak gold quote", () => {
  const result = analyzeSession([
    dsh("现在问题已经非常明确了。"),
    dsh("现在问题已经非常明确了。"),
    dsh("现在问题已经非常明确了。"),
    dsh("等等，不对，我们前面一直把现象当成根因了。"),
  ]);

  assert.equal(result.byKind.catchphrase?.text, "现在问题已经非常明确了。");
  assert.equal(result.byKind.catchphrase?.count, 3);
  assert.notEqual(result.byKind.quote?.text, "现在问题已经非常明确了。");
});

test("premature celebration requires a later reversal inside the context window", () => {
  const noReversal = analyzeSession([
    dsh("这次应该真的没问题了！"),
    dsh("测试通过了。"),
    dsh("继续收尾。"),
  ]);
  assert.equal(noReversal.byKind["premature-celebration"], undefined);

  const withReversal = analyzeSession([
    dsh("这次应该真的没问题了！"),
    dsh("测试通过了。"),
    dsh("等等，不对，我刚才的判断错了；这个修复根本没有覆盖写路径。"),
  ]);
  assert.ok(withReversal.byKind["premature-celebration"]);
});

test("user and tool text do not create session awards", () => {
  const result = analyzeSession([
    { role: "user", text: "重大发现！！！我们前面的路线完全错了！" },
    { role: "tool", text: "这次真的找到根因了！！！" },
    dsh("我先检查一下配置文件。"),
  ]);

  assert.equal(result.metrics.assistantMessages, 1);
  assert.equal(result.metrics.discoveryDeclarations, 0);
  assert.equal(result.byKind["wolf-cry"], undefined);
});
