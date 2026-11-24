import { StrictMode, useEffect, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

declare global {
  interface Window {
    xpaw: {
      startStream(requestId: string, message: string): Promise<{ started: boolean }>;
      cancelStream(requestId: string): Promise<void>;
      onStreamEvent(listener: (event: StreamEvent) => void): () => void;
      getConfig(): Promise<{ provider: string; modelId: string; workspacePath: string; local: boolean }>;
      getUsage(): Promise<{ totalTokens: number; todayTokens: number; requests: number; daily: Array<{ date: string; tokens: number }> }>;
      listModels(): Promise<string[]>;
      selectModel(modelId: string): Promise<{ modelId: string }>;
    };
  }
}

type Message = { role: "user" | "assistant"; content: string };
type StreamEvent = { requestId: string; type: "text_delta" | "tool_started" | "tool_finished" | "completed" | "cancelled" | "failed"; delta?: string; name?: string; summary?: string; content?: string; message?: string };
const starters = ["读取 notes.md，并用中文总结。", "列出工作区中的文件。", "帮我创建一个本周待办清单。"];

function App(): ReactElement {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: "我是 XPaw。文件操作只会在你授权的工作区内进行，写入前会请求确认。" }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<{ provider: string; modelId: string; workspacePath: string; local: boolean }>();
  const [usage, setUsage] = useState<{ totalTokens: number; todayTokens: number; requests: number; daily: Array<{ date: string; tokens: number }> }>();
  const [models, setModels] = useState<string[]>([]);
  const [switching, setSwitching] = useState(false);
  const requestId = useRef<string | undefined>(undefined);
  const refresh = async () => { setConfig(await window.xpaw.getConfig()); setUsage(await window.xpaw.getUsage()); setModels(await window.xpaw.listModels()); };
  useEffect(() => {
    void refresh();
    return window.xpaw.onStreamEvent((event) => {
      if (event.requestId !== requestId.current) return;
      if (event.type === "text_delta") setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, content: item.content + event.delta } : item));
      if (event.type === "tool_started") setMessages((items) => [...items, { role: "assistant", content: `正在执行工具：${event.name}` }]);
      if (event.type === "tool_finished") setMessages((items) => [...items, { role: "assistant", content: `${event.name} 已完成：${event.summary}` }]);
      if (event.type === "completed") { setBusy(false); requestId.current = undefined; void refresh(); }
      if (event.type === "cancelled") { setMessages((items) => [...items, { role: "assistant", content: "生成已停止。" }]); setBusy(false); requestId.current = undefined; void refresh(); }
      if (event.type === "failed") { setMessages((items) => [...items, { role: "assistant", content: `请求失败：${event.message}` }]); setBusy(false); requestId.current = undefined; void refresh(); }
    });
  }, []);
  const send = async (text = input) => {
    const message = text.trim();
    if (!message || busy) return;
    const id = crypto.randomUUID();
    requestId.current = id;
    setInput(""); setBusy(true); setMessages((items) => [...items, { role: "user", content: message }, { role: "assistant", content: "" }]);
    try { await window.xpaw.startStream(id, message); }
    catch (error) { setMessages((items) => [...items, { role: "assistant", content: `请求失败：${error instanceof Error ? error.message : String(error)}` }]); setBusy(false); requestId.current = undefined; }
  };
  const stop = async () => { if (requestId.current) await window.xpaw.cancelStream(requestId.current); };
  const switchModel = async (nextModel: string) => {
    setSwitching(true);
    try {
      await window.xpaw.selectModel(nextModel);
      await refresh();
      setMessages((items) => [...items, { role: "assistant", content: `已切换到模型 ${nextModel}。新的对话请求将使用该模型。` }]);
    } finally { setSwitching(false); }
  };
  const highest = Math.max(...(usage?.daily.map((item) => item.tokens) ?? [1]), 1);
  return <main className="app-shell">
    <aside className="rail"><div className="mark">X</div><button className="rail-button active" title="对话">&#9993;</button><button className="rail-button" title="角色">&#9787;</button><button className="rail-button" title="设置">&#9881;</button></aside>
    <aside className="sidebar"><div className="brand"><span>XPaw</span><small>LOCAL COMPANION</small></div><button className="new-chat" onClick={() => setMessages([{ role: "assistant", content: "新的对话已开始。" }])}>+ 新建对话</button><section><p className="eyebrow">角色</p><div className="character"><div className="avatar">XP</div><div><strong>XPaw</strong><small>本地个人助理</small></div><i></i></div></section><section className="sessions"><p className="eyebrow">最近会话</p><button className="session active">当前对话</button><button className="session">文件与写作</button></section><div className="local-note"><span></span>{config?.local ? "本地模型运行中" : "云端模型已连接"}</div></aside>
    <section className="conversation"><header><div><p className="eyebrow">当前角色</p><h1>和 XPaw 对话</h1></div><label className="model-pill"><span></span><select value={config?.modelId ?? ""} disabled={switching || !config?.local || busy} onChange={(event) => void switchModel(event.target.value)}>{models.map((model) => <option key={model} value={model}>{model}</option>)}</select><b>{switching ? "切换中" : config?.provider ?? ""}</b></label></header><div className="messages">{messages.map((message, index) => <article key={index} className={`message ${message.role}`}><div className="message-avatar">{message.role === "assistant" ? "XP" : "你"}</div><div><p>{message.role === "assistant" ? "XPaw" : "你"}</p><div className="bubble">{message.content || (busy && index === messages.length - 1 ? <span className="thinking"><span></span><span></span><span></span></span> : "")}</div></div></article>)}</div><div className="composer"><div className="suggestions">{starters.map((item) => <button key={item} disabled={busy} onClick={() => void send(item)}>{item}</button>)}</div><textarea value={input} disabled={busy} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="交代一个任务，或和 XPaw 聊聊..." />{busy ? <button className="send stop" onClick={() => void stop()} aria-label="停止生成">■</button> : <button className="send" disabled={!input.trim()} onClick={() => void send()} aria-label="发送">↑</button>}</div></section>
    <aside className="insights"><p className="eyebrow">本地活动</p><h2>Token 用量</h2><div className="stats"><div><small>今日</small><strong>{usage?.todayTokens ?? 0}</strong><span>tokens</span></div><div><small>累计</small><strong>{usage?.totalTokens ?? 0}</strong><span>tokens</span></div></div><div className="heatmap-head"><span>近一年</span><small>{usage?.requests ?? 0} 次模型请求</small></div><div className="heatmap">{Array.from({ length: 84 }, (_, index) => { const point = usage?.daily[index]; const level = point ? Math.max(1, Math.ceil((point.tokens / highest) * 4)) : 0; return <div key={index} className={`heat l${level}`} title={point ? `${point.date}: ${point.tokens} tokens` : "无使用记录"} />; })}</div><div className="legend"><span>少</span><i className="l0"/><i className="l1"/><i className="l2"/><i className="l3"/><i className="l4"/><span>多</span></div><div className="workspace"><p className="eyebrow">授权工作区</p><code>{config?.workspacePath ?? "..."}</code><small>写入会单独请求你的确认</small></div></aside>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
