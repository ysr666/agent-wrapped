import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import {
  ArrowLeft, ArrowRight, Brain, CaretDown, ChatCircleDots, CheckCircle, Code,
  DownloadSimple, FileText, GearSix, MagnifyingGlass, Megaphone, Plus, Quotes,
  ShareNetwork, ShieldCheck, SpinnerGap, Wrench, X,
} from "@phosphor-icons/react";

const iconByKind = { catchphrase: Megaphone, admission: Quotes, twist: Brain, ending: CheckCircle };

const decorationByLabel = {
  本场金句: { stamp: "原话?!", marginNote: "它真这么说了" },
  高频口癖: { stamp: "又来了?!", marginNote: "本场主题曲" },
  最大回旋镖: { stamp: "收回?!", marginNote: "前后都算数" },
  狼来了: { stamp: "又来?!", marginNote: "片尾还有彩蛋" },
  香槟开早了: { stamp: "等等?!", marginNote: "开早了，撤杯" },
  剧情急转弯: { stamp: "反转?!", marginNote: "主线突然拐弯" },
  精神状态: { stamp: "急了?!", marginNote: "情绪非常具体" },
  现场抓包: { stamp: "抓到?!", marginNote: "证据就在现场" },
  本场角色: { stamp: "像它?!", marginNote: "仅限本场表现" },
};

function visualKind(card) {
  if (card?.type === "persona") return "admission";
  if (["catchphrase", "wolf-cry"].includes(card?.kind)) return "catchphrase";
  if (["quote", "emotional-peak"].includes(card?.kind)) return "admission";
  if (["premature-celebration", "ending_then_more_work"].includes(card?.kind)) return "ending";
  return "twist";
}

function actorLine(evidence, actor, fallback) {
  return evidence.find((item) => item.actor === actor)?.text ?? fallback;
}

function payloadToSession(payload, metadata) {
  if (!payload?.strongest) return undefined;
  const strongest = payload.strongest;
  const allEvidence = payload.cards.flatMap((card) => card.evidence ?? []);
  const uniqueEvidence = allEvidence.filter((item, index, items) => items.findIndex((candidate) => candidate.actor === item.actor && candidate.text === item.text) === index).slice(0, 5);
  const decoration = decorationByLabel[strongest.label] ?? { stamp: "真的?!", marginNote: "均来自本场证据" };
  return {
    id: payload.sessionId,
    navTitle: metadata?.title ?? payload.title,
    workspaceTitle: metadata?.title ?? payload.title,
    category: strongest.label,
    kind: visualKind(strongest),
    strongestLabel: strongest.type === "award" ? "本场最强一句" : "本场最强结论",
    strongest: strongest.title,
    payoff: strongest.body ?? "真实 Composer 认为这是本场最值得看的内容。",
    title: strongest.title,
    commentary: strongest.body ?? `${payload.cards.length} 张卡通过了本场 Truth Gate。`,
    ...decoration,
    userLine: actorLine(uniqueEvidence, "user", "本场真实会话证据已读取。"),
    agentLine: actorLine(uniqueEvidence, "agent", strongest.title),
    evidence: uniqueEvidence.length > 0 ? uniqueEvidence : [{ actor: "agent", text: strongest.title }],
    awards: payload.cards.map((card) => ({
      label: card.label,
      kind: visualKind(card),
      title: card.title,
      body: card.body ?? "来自真实 Composer 的最终入选卡。",
    })),
    cardCount: payload.cards.length,
    generatedAt: payload.generatedAt,
    cached: payload.cached,
  };
}

const codeLines = [
  "const analyzeSession = async (session) => {", "  const evidence = await collectEvidence(session)",
  "  const moments = await findShowableMoments(evidence)", "", "  return composeWrapped({",
  "    moments,", "    truthGate: 'strict',", "    maxCards: 5,", "  })", "}",
];

function IconForKind({ kind, size = 16, weight = "bold" }) {
  const Icon = iconByKind[kind] ?? Quotes;
  return <Icon size={size} weight={weight} aria-hidden="true" />;
}

function Sidebar({ sessions, selectedId, onSelect, loading }) {
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
        <p className="session-group-label">REAL GOLDEN SET</p>
        {loading && <div className="session-row session-loading"><SpinnerGap size={16} className="spin" /><span>读取本地真实会话…</span></div>}
        {sessions.map((session) => (
          <button key={session.id} className={`session-row ${selectedId === session.id ? "selected" : ""}`} onClick={() => onSelect(session.id)}>
            <span>{session.title}</span>{selectedId === session.id && <CheckCircle size={17} weight="fill" />}
          </button>
        ))}
        <p className="session-group-label muted">本地只读 · 原日志不出机</p>
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
          <aside className="evidence-panel"><div className="evidence-title"><ShieldCheck size={18} weight="fill" />本场安全证据</div>{session.evidence.map((item, index) => <blockquote key={`${item.text}-${index}`} className={item.actor}><span>{item.actor === "user" ? "你" : item.actor === "tool" ? "Tool" : "Agent"}</span><p>{item.text}</p>{item.count && <strong>×{item.count}</strong>}</blockquote>)}</aside>
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
      <section className="paper-evidence">{session.evidence.slice(0, 4).map((item, index) => <div key={`${item.text}-${index}`} className={`paper-quote ${item.actor}`}><span>{item.actor === "user" ? "你" : item.actor === "tool" ? "Tool" : "Agent"}</span><p>{item.text}</p>{item.count && <strong>×{item.count}</strong>}</div>)}</section>
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

function ComposerStatus({ state, message, onRetry }) {
  return <aside className={`composer-status ${state}`} aria-live="polite">
    {state === "loading" ? <SpinnerGap size={22} className="spin" /> : <ShieldCheck size={21} weight="fill" />}
    <div><strong>{state === "loading" ? "正在跑真实 Wrapped Composer…" : state === "empty" ? "这场诚实地没有卡" : "真实生成暂时失败"}</strong><p>{message}</p></div>
    {state === "error" && <button onClick={onRetry}>重试</button>}
  </aside>;
}

export function App() {
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState();
  const [payload, setPayload] = useState();
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingPayload, setLoadingPayload] = useState(false);
  const [error, setError] = useState();
  const [retryNonce, setRetryNonce] = useState(0);
  const [view, setView] = useState("workspace");
  const [cardVisible, setCardVisible] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoadingSessions(true); setError(undefined);
    fetch("/api/real-wrapped/sessions", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "无法读取真实会话。");
        return body.sessions ?? [];
      })
      .then((items) => { setSessions(items); setSelectedId((current) => current ?? items[0]?.id); })
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => setLoadingSessions(false));
    return () => controller.abort();
  }, [retryNonce]);
  useEffect(() => {
    if (!selectedId) return undefined;
    const controller = new AbortController();
    setLoadingPayload(true); setPayload(undefined); setError(undefined);
    fetch(`/api/real-wrapped/${selectedId}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "真实 Composer 生成失败。");
        return body;
      })
      .then(setPayload)
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => setLoadingPayload(false));
    return () => controller.abort();
  }, [selectedId, retryNonce]);
  const metadata = sessions.find((item) => item.id === selectedId);
  const session = payloadToSession(payload, metadata);
  const workspaceSession = session ?? {
    workspaceTitle: metadata?.title ?? "读取真实 DSH 会话",
    userLine: "本场真实会话正在本地只读分析。",
    agentLine: loadingPayload ? "正在筛选最值得看的瞬间…" : payload?.emptyMessage ?? error ?? "等待真实会话。",
    category: payload?.cards?.length === 0 ? "诚实 no-story" : "真实 Composer",
  };
  function selectSession(id) { setSelectedId(id); setView("workspace"); setCardVisible(true); }
  function retry() { setRetryNonce((value) => value + 1); }
  return (
    <main className="prototype-shell">
      <Sidebar sessions={sessions} selectedId={selectedId} onSelect={selectSession} loading={loadingSessions} /><Workspace session={workspaceSession} />
      {view === "workspace" && loadingPayload && <ComposerStatus state="loading" message="真实 DSH 日志只读留在本机；正在运行确定性 Composer。" />}
      {view === "workspace" && !loadingPayload && error && <ComposerStatus state="error" message={error} onRetry={retry} />}
      {view === "workspace" && !loadingPayload && !error && payload && !payload.strongest && <ComposerStatus state="empty" message={payload.emptyMessage} />}
      {view === "workspace" && cardVisible && session && <FloatingHighlight session={session} onOpen={() => setView("full")} onDismiss={() => setCardVisible(false)} />}
      {view === "workspace" && !cardVisible && session && <button className="reopen-badge" onClick={() => setCardVisible(true)}><Quotes size={18} weight="fill" />本场大赏</button>}
      {view === "full" && session && <FullWrapped session={session} onClose={() => setView("workspace")} onShare={() => setView("share")} />}
      {view === "share" && session && <ShareStudio session={session} onBack={() => setView("full")} />}
    </main>
  );
}
