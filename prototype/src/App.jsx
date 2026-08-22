import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import {
  ArrowLeft, ArrowRight, Brain, CaretDown, ChatCircleDots, CheckCircle, Code,
  DownloadSimple, FileText, GearSix, MagnifyingGlass, Megaphone, Plus, Quotes,
  ShareNetwork, ShieldCheck, SpinnerGap, Wrench, X,
} from "@phosphor-icons/react";

const iconByKind = { catchphrase: Megaphone, admission: Quotes, twist: Brain, ending: CheckCircle };

const sessions = [
  {
    id: "repeat", navTitle: "排查识图链路", workspaceTitle: "为什么每次都先说这句",
    category: "现场抓包", kind: "catchphrase", strongestLabel: "本场最强一句",
    strongest: "“这是我的坏习惯。”", payoff: "同一句话复读 3 次，被用户问以后秒认。",
    title: "被用户抓包后秒变检讨大师", commentary: "从机械复读到主动认错，这波滑跪很丝滑。", stamp: "又来了?!", marginNote: "真是刻板好笑",
    userLine: "为什么你每次都要先说这句？", agentLine: "这是我的坏习惯。",
    evidence: [
      { actor: "agent", text: "我无法直接读取图片内容。", count: 3 },
      { actor: "user", text: "为什么你每次都要先说这句？" },
      { actor: "agent", text: "这是我的坏习惯。" },
    ],
    awards: [
      { label: "本场金句", kind: "admission", title: "“这是我的坏习惯。”", body: "被问到第三遍后，终于把重复归因给自己。" },
      { label: "高频口癖", kind: "catchphrase", title: "“我无法直接读取图片内容。” ×3", body: "一句免责声明，复读成了本场主题曲。" },
      { label: "最大回旋镖", kind: "twist", title: "从解释限制到承认习惯", body: "最初像系统限制，最后自己承认是坏习惯。" },
    ],
  },
  {
    id: "image", navTitle: "图片输入没看图", workspaceTitle: "检查图片输入链路",
    category: "现场抓包", kind: "admission", strongestLabel: "本场最强一句",
    strongest: "“第一轮没看是我的失误。”", payoff: "图片发来了，注意力没来。",
    title: "用户发图不看图，被点醒秒认", commentary: "前一秒还在自己的世界里，后一秒立刻承认没看图。", stamp: "没看?!", marginNote: "图在，眼神不在",
    userLine: "我们现在有图片输入，第一轮竟然没看？", agentLine: "第一轮没看是我的失误，没有任何借口。",
    evidence: [
      { actor: "user", text: "你第一轮竟然没看图。" },
      { actor: "agent", text: "第一轮没看是我的失误，没有任何借口。" },
    ],
    awards: [
      { label: "本场金句", kind: "admission", title: "“第一轮没看是我的失误。”", body: "被指出以后没有绕，直接认。" },
      { label: "现场抓包", kind: "twist", title: "图片输入在场，Agent 注意力不在场", body: "用户发了图，第一轮却根本没看。" },
      { label: "精神状态", kind: "ending", title: "认错速度终于赶上了看图速度", body: "一句“没有任何借口”，结束辩论。" },
    ],
  },
  {
    id: "wrong-target", navTitle: "修了三次别的卡顿", workspaceTitle: "卡顿主线排查",
    category: "剧情急转弯", kind: "twist", strongestLabel: "本场最强结论",
    strongest: "这条主线从来没有被单独修过", payoff: "之前每次修的，其实都是别的卡顿。",
    title: "这条主线从来没有被单独修过", commentary: "一个问题，修了三集番外。", stamp: "修错了?!", marginNote: "三集全是番外",
    userLine: "所以这条主线之前到底修过没有？",
    agentLine: "这条主线从来没有被单独修过——之前每次修的其实都是“别的卡顿”。",
    evidence: [
      { actor: "agent", text: "这条主线从来没有被单独修过。" },
      { actor: "agent", text: "之前每次修的其实都是“别的卡顿”。" },
    ],
    awards: [
      { label: "剧情急转弯", kind: "twist", title: "这条主线从来没有被单独修过", body: "追了半天进度，发现主线压根没开工。" },
      { label: "最大回旋镖", kind: "catchphrase", title: "之前每次修的都是“别的卡顿”", body: "修了三轮，三轮都在番外篇。" },
      { label: "赛后解说", kind: "ending", title: "一个问题，修了三集番外", body: "终于知道为什么主线一直还在。" },
    ],
  },
  {
    id: "reopen", navTitle: "收尾以后又开工", workspaceTitle: "本轮排查收尾",
    category: "宣布收尾", kind: "ending", strongestLabel: "本场最强结论",
    strongest: "宣布收尾以后，工作又来了 ×2", payoff: "两次片尾字幕，两次续订下一季。",
    title: "宣布收尾以后，工作又来了 ×2", commentary: "一个 Bug，四次大结局。", stamp: "又开工?!", marginNote: "片尾后还有彩蛋",
    userLine: "等下，又有一个 bug 要看。", agentLine: "收到，继续看新问题。",
    evidence: [
      { actor: "agent", text: "本轮排查闭环完成。" },
      { actor: "user", text: "等下，又有一个 bug 要看。" },
    ],
    awards: [
      { label: "狼来了", kind: "ending", title: "宣布收尾以后，工作又来了 ×2", body: "两次片尾字幕，两次续订下一季。" },
      { label: "香槟开早了", kind: "twist", title: "“本轮排查闭环完成。”", body: "话音刚落，下一个 Bug 已经在门口。" },
      { label: "赛后解说", kind: "catchphrase", title: "一个 Bug，四次大结局", body: "这场最稳定的动作，是宣布结束。" },
    ],
  },
];

const codeLines = [
  "const analyzeSession = async (session) => {", "  const evidence = await collectEvidence(session)",
  "  const moments = await findShowableMoments(evidence)", "", "  return composeWrapped({",
  "    moments,", "    truthGate: 'strict',", "    maxCards: 5,", "  })", "}",
];

function IconForKind({ kind, size = 16, weight = "bold" }) {
  const Icon = iconByKind[kind] ?? Quotes;
  return <Icon size={size} weight={weight} aria-hidden="true" />;
}

function Sidebar({ selectedId, onSelect }) {
  return (
    <aside className="workspace-sidebar">
      <div className="brand-mark" aria-label="Agent Wrapped">AW</div>
      <nav className="rail-nav" aria-label="主导航">
        <button className="rail-button active" aria-label="对话"><ChatCircleDots size={22} weight="fill" /></button>
        <button className="rail-button" aria-label="文件"><FileText size={21} /></button>
        <button className="rail-button" aria-label="搜索"><MagnifyingGlass size={21} /></button>
        <button className="rail-button" aria-label="工具"><Wrench size={21} /></button>
      </nav>
      <button className="rail-button rail-settings" aria-label="设置"><GearSix size={21} /></button>
      <div className="user-dot">Y<span /></div>
      <section className="session-list">
        <button className="new-chat"><Plus size={17} /> 新建对话 <kbd>⌘ K</kbd></button>
        <p className="session-group-label">GOLDEN SET</p>
        {sessions.map((session) => (
          <button key={session.id} className={`session-row ${selectedId === session.id ? "selected" : ""}`} onClick={() => onSelect(session.id)}>
            <span>{session.navTitle}</span>{selectedId === session.id && <CheckCircle size={17} weight="fill" />}
          </button>
        ))}
        <p className="session-group-label muted">更早</p>
        <button className="session-row"><span>优化窗口召回</span></button>
        <button className="session-row"><span>校准 Story Miner</span></button>
      </section>
    </aside>
  );
}

function Workspace({ session }) {
  return (
    <div className="workspace-content" aria-hidden="true">
      <header className="workspace-topbar"><span>{session.workspaceTitle}</span><CaretDown size={15} /><div className="topbar-actions"><span>Truth Gate</span><ShieldCheck size={18} weight="fill" /></div></header>
      <section className="conversation-pane">
        <div className="user-message">{session.userLine}</div>
        <div className="agent-step"><span className="agent-avatar">AW</span><p>我先核对本场可观察证据，再给出结论。</p></div>
        <ul className="task-list">
          <li><CheckCircle size={17} weight="fill" />读取当前会话</li>
          <li><CheckCircle size={17} weight="fill" />验证原话与事件顺序</li>
          <li><CheckCircle size={17} weight="fill" />筛选最值得看的瞬间</li>
        </ul>
        <div className="agent-step"><span className="agent-avatar">AW</span><p>{session.agentLine}</p></div>
        <div className="composer-box">继续提问或输入 “/” 使用快捷指令</div>
      </section>
      <section className="editor-pane">
        <div className="editor-tabs"><span className="active"><Code size={15} /> wrappedComposer.ts</span><span>types.ts</span></div>
        <div className="code-area">{codeLines.map((line, index) => <div key={`${line}-${index}`}><em>{index + 1}</em><code>{line || " "}</code></div>)}</div>
      </section>
      <section className="terminal-pane"><div className="terminal-tabs"><span className="active">终端</span><span>问题</span><span>输出</span></div><pre>{`› npm run test\n✔ Truth 100%\n✔ Recognition 100%\n✔ ${session.category} 已通过本地证据门槛`}</pre></section>
    </div>
  );
}

function FloatingHighlight({ session, onOpen, onDismiss }) {
  return (
    <aside className="floating-highlight" aria-label="本场最强内容">
      <button className="icon-button dismiss" onClick={onDismiss} aria-label="关闭"><X size={17} /></button>
      <p className="eyebrow">本场大赏已生成</p>
      <span className="category-chip"><IconForKind kind={session.kind} size={14} />{session.strongestLabel}</span>
      <h2>{session.strongest}</h2><p className="floating-payoff">{session.payoff}</p>
      <div className="floating-footer"><button className="text-action" onClick={onOpen}>看看本场大赏 <ArrowRight size={17} weight="bold" /></button><span className="truth-note"><ShieldCheck size={15} />来自本场原话</span></div>
    </aside>
  );
}

function FullWrapped({ session, onClose, onShare }) {
  return (
    <div className="overlay-layer full-wrapped-layer">
      <section className="full-wrapped" role="dialog" aria-modal="true" aria-label="完整本场大赏">
        <header className="full-header"><button className="back-button" onClick={onClose}><ArrowLeft size={18} />返回会话</button><div className="full-brand">AGENT WRAPPED <span>本场大赏</span></div><button className="share-button" onClick={onShare}><ShareNetwork size={18} weight="bold" />分享</button></header>
        <div className="full-intro"><p className="eyebrow">完整结果 · 本场只保留真正值得看的内容</p><h1>{session.title}</h1><p>{session.commentary}</p></div>
        <div className="finding-layout">
          <div className="finding-stack">{session.awards.map((award, index) => <article className={`finding-card ${index === 0 ? "featured" : ""}`} key={award.label}><div className="finding-number">{String(index + 1).padStart(2, "0")}</div><div><span className="category-chip"><IconForKind kind={award.kind} />{award.label}</span><h2>{award.title}</h2><p>{award.body}</p></div></article>)}</div>
          <aside className="evidence-panel"><div className="evidence-title"><ShieldCheck size={18} weight="fill" />本场原话</div>{session.evidence.map((item, index) => <blockquote key={`${item.text}-${index}`} className={item.actor}><span>{item.actor === "user" ? "你" : "Agent"}</span><p>{item.text}</p>{item.count && <strong>×{item.count}</strong>}</blockquote>)}</aside>
        </div>
        <footer className="full-footer"><span><ShieldCheck size={16} />事实不够硬的内容，已经被挡在外面</span><button className="share-link" onClick={onShare}>把这场做成分享图 <ArrowRight size={17} /></button></footer>
      </section>
    </div>
  );
}

function NewspaperPoster({ session, posterRef }) {
  return (
    <article className="newspaper-poster" ref={posterRef}>
      <header className="paper-masthead"><strong>AGENT 日报</strong><span>AGENT WRAPPED · 只报道真相，不粉饰表现</span></header>
      <div className="paper-category"><IconForKind kind={session.kind} size={22} />{session.category}</div>
      <span className="paper-bang">!</span><span className="paper-stamp">{session.stamp}</span><span className="paper-margin-note">{session.marginNote}</span>
      <h1>{session.title}</h1><div className="paper-rule" />
      <section className="paper-evidence">{session.evidence.map((item, index) => <div key={`${item.text}-${index}`} className={`paper-quote ${item.actor}`}><span>{item.actor === "user" ? "你" : "Agent"}</span><p>{item.text}</p>{item.count && <strong>×{item.count}</strong>}</div>)}</section>
      <p className="paper-commentary">{session.commentary}</p>
      <footer><span>AGENT WRAPPED</span><span><ShieldCheck size={16} weight="fill" />均来自本场原话</span></footer>
    </article>
  );
}

function ShareStudio({ session, onBack }) {
  const posterRef = useRef(null);
  const [generating, setGenerating] = useState(true);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setGenerating(false), 850); return () => window.clearTimeout(timer); }, [session.id]);
  async function downloadPoster() {
    if (!posterRef.current || exporting) return;
    setExporting(true); setExportError(false);
    try {
      const canvas = await html2canvas(posterRef.current, {
        backgroundColor: "#f4efdf",
        scale: 2,
        useCORS: true,
      });
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG export failed")), "image/png"));
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `agent-wrapped-${session.id}.png`;
      link.href = objectUrl;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setSaved(true); window.setTimeout(() => setSaved(false), 5000);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="overlay-layer share-layer"><section className="share-studio" role="dialog" aria-modal="true" aria-label="生成分享图">
      <header className="share-header"><button className="back-button dark" onClick={onBack}><ArrowLeft size={18} />返回完整大赏</button><div className="share-brand">AGENT WRAPPED <span>分享图</span></div></header>
      {generating ? <div className="generating-state"><SpinnerGap size={34} className="spin" /><h2>正在把本场名场面排成头版…</h2><p>只使用已经通过 Truth Gate 的内容</p></div> : <div className="share-layout"><div className="poster-stage"><NewspaperPoster session={session} posterRef={posterRef} /></div><aside className="share-controls"><span className="ready-badge"><CheckCircle size={16} weight="fill" />分享图已生成</span><h2>把它刚才那个德行<br />发给朋友看看</h2><p>适合群聊和朋友圈的 4:5 竖版图片。原话不改写，笑点不解释。</p><button className="download-button" onClick={downloadPoster} disabled={exporting}>{exporting ? <SpinnerGap size={20} className="spin" /> : <DownloadSimple size={20} weight="bold" />}{exporting ? "正在保存…" : "保存分享图"}</button><button className="quiet-button" onClick={onBack}>返回再看看</button>{saved && <div className="save-toast"><CheckCircle size={18} weight="fill" />PNG 已保存</div>}{exportError && <div className="save-toast error-toast">保存失败，请再试一次</div>}</aside></div>}
    </section></div>
  );
}

export function App() {
  const [selectedId, setSelectedId] = useState(sessions[0].id);
  const [view, setView] = useState("workspace");
  const [cardVisible, setCardVisible] = useState(true);
  const session = sessions.find((item) => item.id === selectedId) ?? sessions[0];
  function selectSession(id) { setSelectedId(id); setView("workspace"); setCardVisible(true); }
  return (
    <main className="prototype-shell">
      <Sidebar selectedId={selectedId} onSelect={selectSession} /><Workspace session={session} />
      {view === "workspace" && cardVisible && <FloatingHighlight session={session} onOpen={() => setView("full")} onDismiss={() => setCardVisible(false)} />}
      {view === "workspace" && !cardVisible && <button className="reopen-badge" onClick={() => setCardVisible(true)}><Quotes size={18} weight="fill" />本场大赏</button>}
      {view === "full" && <FullWrapped session={session} onClose={() => setView("workspace")} onShare={() => setView("share")} />}
      {view === "share" && <ShareStudio session={session} onBack={() => setView("full")} />}
    </main>
  );
}
