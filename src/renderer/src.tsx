import { StrictMode, useEffect, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

declare global {
  interface Window {
    xpaw: {
      startStream(requestId: string, message: string): Promise<{ started: boolean }>;
      regenerate(requestId: string): Promise<{ started: boolean; message: string }>;
      cancelStream(requestId: string): Promise<void>;
      newConversation(): Promise<{ conversationId: number }>;
      listConversations(): Promise<Conversation[]>;
      selectConversation(id: number): Promise<{ conversationId: number; messages: Message[] }>;
      renameConversation(id: number, title: string): Promise<void>;
      deleteConversation(id: number): Promise<void>;
      onStreamEvent(listener: (event: StreamEvent) => void): () => void;
      getConfig(): Promise<{ provider: string; modelId: string; workspacePath: string; local: boolean }>;
      getUsage(filter?: { modelId?: string; days?: number }): Promise<{ totalTokens: number; todayTokens: number; requests: number; daily: Array<{ date: string; tokens: number }> }>;
      listModels(): Promise<string[]>;
      selectModel(modelId: string): Promise<{ modelId: string }>;
      listProfiles(): Promise<ModelProfile[]>;
      saveProfile(input: { profile: ModelProfileInput; apiKey?: string }): Promise<ModelProfile[]>;
      selectProfile(id: string): Promise<{ profileId: string }>;
      testProfile(input: unknown): Promise<{ ok: boolean }>;
      listTasks(): Promise<TaskSummary[]>;
      getTaskEvents(taskId: number): Promise<TaskEvent[]>;
      rerunTask(taskId: number): Promise<{ objective: string }>;
      getCharacter(): Promise<CharacterData>;
      saveCharacter(character: CharacterData): Promise<CharacterData>;
      getMemory(): Promise<{ profile: UserProfile; memories: MemoryItem[] }>;
      saveUserProfile(profile: UserProfile): Promise<void>;
      addMemory(memory: Omit<MemoryItem, "id" | "createdAt" | "updatedAt">): Promise<number>;
      updateMemory(id: number, memory: Pick<MemoryItem, "category" | "content">): Promise<void>;
      deleteMemory(id: number): Promise<void>;
      getConversationSummary(id: number): Promise<ConversationSummary | undefined>;
      deleteConversationSummary(id: number): Promise<void>;
      listKnowledge(): Promise<KnowledgeDocument[]>;
      importKnowledge(filePath: string): Promise<void>;
      deleteKnowledge(id: number): Promise<void>;
      searchKnowledge(query: string): Promise<KnowledgeChunk[]>;
    };
  }
}

type Message = { role: "user" | "assistant"; content: string };
type Conversation = { id: number; characterId: string; title: string; updatedAt: string };
type ModelProfile = { id: string; name: string; provider: "ollama" | "openai-compatible"; baseUrl: string; modelId: string; temperature: number; maxTokens: number; toolsEnabled: boolean; local: boolean; createdAt: string; updatedAt: string };
type ModelProfileInput = Omit<ModelProfile, "createdAt" | "updatedAt">;
type CharacterData = { id?: string; name: string; description: string; role: string; summary: string; tone: string };
type TaskSummary = { id: number; conversationId: number; objective: string; status: string; plan: string | null; error: string | null; createdAt: string; updatedAt: string };
type TaskEvent = { id: number; taskId: number; type: string; message: string; data: string | null; createdAt: string };
type MemoryItem = { id: number; category: "preference" | "fact" | "instruction" | "summary"; content: string; source: string; createdAt: string; updatedAt: string };
type UserProfile = { preferredName: string; language: string; timezone: string; communicationStyle: string };
type ConversationSummary = { content: string; sourceMessageCount: number; updatedAt: string };
type KnowledgeDocument = { id: number; path: string; name: string; contentHash: string; chunkCount: number; importedAt: string; updatedAt: string };
type KnowledgeChunk = { id: number; documentId: number; path: string; name: string; startLine: number; endLine: number; content: string };
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
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("local-ollama-default");
  const [cloudForm, setCloudForm] = useState({ name: "", baseUrl: "", modelId: "", apiKey: "", temperature: 0.35, maxTokens: 384, toolsEnabled: true });
  const [cloudStatus, setCloudStatus] = useState("");
  const [view, setView] = useState<"chat" | "settings" | "character" | "usage" | "tasks" | "memory" | "knowledge">("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<number>();
  const [character, setCharacter] = useState<CharacterData>();
  const [activity, setActivity] = useState<string | undefined>();
  const [copiedIndex, setCopiedIndex] = useState<number | undefined>();
  const [usageDays, setUsageDays] = useState(365);
  const [usageModelId, setUsageModelId] = useState<string | undefined>();
  const [usageDetail, setUsageDetail] = useState<{ totalTokens: number; todayTokens: number; requests: number; daily: Array<{ date: string; tokens: number }> }>();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskSummary>();
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({ preferredName: "", language: "zh-CN", timezone: "Asia/Shanghai", communicationStyle: "" });
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoryDraft, setMemoryDraft] = useState({ category: "preference" as MemoryItem["category"], content: "" });
  const [conversationSummary, setConversationSummary] = useState<ConversationSummary>();
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [knowledgePath, setKnowledgePath] = useState("");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeChunk[]>([]);
  const [knowledgeStatus, setKnowledgeStatus] = useState("");
  const requestId = useRef<string | undefined>(undefined);
  const messagesEnd = useRef<HTMLDivElement | null>(null);
  const refresh = async () => { setConfig(await window.xpaw.getConfig()); setUsage(await window.xpaw.getUsage()); setModels(await window.xpaw.listModels()); setProfiles(await window.xpaw.listProfiles()); setCharacter(await window.xpaw.getCharacter()); const items = await window.xpaw.listConversations(); setConversations(items); setActiveConversation((current) => current ?? items[0]?.id); };
  useEffect(() => {
    void refresh();
    return window.xpaw.onStreamEvent((event) => {
      if (event.requestId !== requestId.current) return;
      if (event.type === "text_delta") setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, content: item.content + event.delta } : item));
      if (event.type === "tool_started") setActivity(`正在执行工具：${event.name}`);
      if (event.type === "tool_finished") setActivity(`${event.name} 已完成：${event.summary}`);
      if (event.type === "completed") { setActivity(undefined); setBusy(false); requestId.current = undefined; void refresh(); }
      if (event.type === "cancelled") { setActivity(undefined); setMessages((items) => [...items, { role: "assistant", content: "生成已停止。" }]); setBusy(false); requestId.current = undefined; void refresh(); }
      if (event.type === "failed") { setActivity(undefined); setMessages((items) => [...items, { role: "assistant", content: `请求失败：${event.message}` }]); setBusy(false); requestId.current = undefined; void refresh(); }
    });
  }, []);
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);
  const send = async (text = input) => {
    const message = text.trim();
    if (!message || busy) return;
    const id = crypto.randomUUID();
    requestId.current = id;
    setInput(""); setActivity(undefined); setBusy(true); setMessages((items) => [...items, { role: "user", content: message }, { role: "assistant", content: "" }]);
    try { await window.xpaw.startStream(id, message); }
    catch (error) { setActivity(undefined); setMessages((items) => [...items, { role: "assistant", content: `请求失败：${error instanceof Error ? error.message : String(error)}` }]); setBusy(false); requestId.current = undefined; }
  };
  const stop = async () => { if (requestId.current) await window.xpaw.cancelStream(requestId.current); };
  const copyAnswer = async (content: string, index: number) => { await navigator.clipboard.writeText(content); setCopiedIndex(index); setTimeout(() => setCopiedIndex(undefined), 1500); };
  const regenerate = async () => {
    if (busy) return;
    const id = crypto.randomUUID();
    requestId.current = id;
    setBusy(true); setActivity("正在重新生成回答...");
    setMessages((items) => items.slice(0, -1).concat({ role: "assistant", content: "" }));
    try { await window.xpaw.regenerate(id); }
    catch (error) { setActivity(undefined); setMessages((items) => [...items, { role: "assistant", content: `重新生成失败：${error instanceof Error ? error.message : String(error)}` }]); setBusy(false); requestId.current = undefined; }
  };
  const newConversation = async () => { if (busy) return; const result = await window.xpaw.newConversation(); setActiveConversation(result.conversationId); setActivity(undefined); setMessages([{ role: "assistant", content: "新的对话已开始。" }]); await refresh(); };
  const selectConversation = async (id: number) => { if (busy) return; const result = await window.xpaw.selectConversation(id); setActiveConversation(result.conversationId); setActivity(undefined); setMessages(result.messages as Message[]); };
  const renameConversation = async (conversation: Conversation) => { const title = window.prompt("会话名称", conversation.title); if (title !== null) { await window.xpaw.renameConversation(conversation.id, title); await refresh(); } };
  const deleteConversation = async (conversation: Conversation) => { if (!window.confirm(`删除“${conversation.title}”？`)) return; await window.xpaw.deleteConversation(conversation.id); const remaining = await window.xpaw.listConversations(); if (remaining.length) await selectConversation(remaining[0].id); else await newConversation(); await refresh(); };
  const switchModel = async (nextModel: string) => {
    setSwitching(true);
    try {
      await window.xpaw.selectModel(nextModel);
      await refresh();
      setMessages((items) => [...items, { role: "assistant", content: `已切换到模型 ${nextModel}。新的对话请求将使用该模型。` }]);
    } finally { setSwitching(false); }
  };
  const highest = Math.max(...(usage?.daily.map((item) => item.tokens) ?? [1]), 1);
  const profile = profiles.find((item) => item.id === selectedProfileId) ?? profiles[0];
  const saveProfile = async (patch: Partial<ModelProfileInput>) => { if (!profile) return; await window.xpaw.saveProfile({ profile: { ...profile, ...patch } }); await refresh(); };
  const addCloudProfile = async () => {
    if (!cloudForm.name || !cloudForm.baseUrl || !cloudForm.modelId || !cloudForm.apiKey) return;
    const id = `cloud-${crypto.randomUUID()}`;
    setCloudStatus("正在测试连接...");
    try { await window.xpaw.testProfile({ baseUrl: cloudForm.baseUrl.replace(/\/$/, ""), modelId: cloudForm.modelId, provider: "openai-compatible", apiKey: cloudForm.apiKey }); }
    catch (error) { setCloudStatus(`连接失败：${error instanceof Error ? error.message : String(error)}`); return; }
    await window.xpaw.saveProfile({ profile: { id, name: cloudForm.name, provider: "openai-compatible", baseUrl: cloudForm.baseUrl.replace(/\/$/, ""), modelId: cloudForm.modelId, temperature: cloudForm.temperature, maxTokens: cloudForm.maxTokens, toolsEnabled: cloudForm.toolsEnabled, local: false }, apiKey: cloudForm.apiKey });
    setCloudForm({ name: "", baseUrl: "", modelId: "", apiKey: "", temperature: 0.35, maxTokens: 384, toolsEnabled: true });
    setSelectedProfileId(id);
    setCloudStatus("连接成功，档案已加密保存。");
    await refresh();
  };
  const activateProfile = async (id: string) => { await window.xpaw.selectProfile(id); setSelectedProfileId(id); await refresh(); setMessages([{ role: "assistant", content: "已切换模型档案。新的请求将使用该档案。" }]); };
  const saveCharacter = async () => { if (!character) return; const saved = await window.xpaw.saveCharacter(character); setCharacter(saved); };
  const refreshUsage = async (days = usageDays, modelId = usageModelId) => { setUsageDays(days); setUsageModelId(modelId); setUsageDetail(await window.xpaw.getUsage({ days, modelId })); };
  const refreshTasks = async () => { const items = await window.xpaw.listTasks(); setTasks(items); if (!selectedTask && items[0]) { setSelectedTask(items[0]); setTaskEvents(await window.xpaw.getTaskEvents(items[0].id)); } };
  const selectTask = async (task: TaskSummary) => { setSelectedTask(task); setTaskEvents(await window.xpaw.getTaskEvents(task.id)); };
  const rerunTask = async (task: TaskSummary) => { const result = await window.xpaw.rerunTask(task.id); setView("chat"); await send(result.objective); };
  const refreshMemory = async () => { const result = await window.xpaw.getMemory(); setUserProfile(result.profile); setMemories(result.memories); if (activeConversation) setConversationSummary(await window.xpaw.getConversationSummary(activeConversation)); };
  const saveMemory = async () => { if (!memoryDraft.content.trim()) return; await window.xpaw.addMemory({ ...memoryDraft, content: memoryDraft.content.trim(), source: "user" }); setMemoryDraft({ category: "preference", content: "" }); await refreshMemory(); };
  const updateMemory = async (memory: MemoryItem, content: string) => { await window.xpaw.updateMemory(memory.id, { category: memory.category, content }); await refreshMemory(); };
  const refreshKnowledge = async () => setKnowledgeDocuments(await window.xpaw.listKnowledge());
  const importKnowledge = async () => { if (!knowledgePath.trim()) return; setKnowledgeStatus("正在导入..."); try { await window.xpaw.importKnowledge(knowledgePath.trim()); setKnowledgePath(""); setKnowledgeStatus("导入完成。"); await refreshKnowledge(); } catch (error) { setKnowledgeStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`); } };
  const searchKnowledge = async () => { setKnowledgeResults(await window.xpaw.searchKnowledge(knowledgeQuery)); };
  if (view === "knowledge") return <main className="app-shell"><aside className="rail"><div className="mark">X</div><button className="rail-button" onClick={() => setView("chat")}>✉</button><button className="rail-button active">⌕</button><button className="rail-button" onClick={() => setView("memory")}>◉</button><button className="rail-button" onClick={() => setView("settings")}>⚙</button></aside><aside className="sidebar"><div className="brand"><span>XPaw</span><small>LOCAL KNOWLEDGE</small></div><p className="settings-note">文档保留在原路径，XPaw 只保存可检索文本索引。</p></aside><section className="settings-page"><header><div><p className="eyebrow">本地知识库</p><h1>文档与引用</h1></div><button className="back" onClick={() => setView("chat")}>返回对话</button></header><div className="knowledge-import"><input placeholder="输入文本文件绝对路径，例如 D:\\Notes\\project.md" value={knowledgePath} onChange={(event) => setKnowledgePath(event.target.value)} /><button className="save" onClick={() => void importKnowledge()}>导入或更新</button><small>{knowledgeStatus}</small></div><div className="knowledge-search"><input placeholder="搜索已导入的知识库" value={knowledgeQuery} onChange={(event) => setKnowledgeQuery(event.target.value)} /><button onClick={() => void searchKnowledge()}>搜索</button></div><div className="knowledge-results">{knowledgeResults.map((item) => <article key={item.id}><strong>{item.name}:{item.startLine}-{item.endLine}</strong><pre>{item.content}</pre></article>)}</div><div className="knowledge-docs">{knowledgeDocuments.map((document) => <article key={document.id}><div><strong>{document.name}</strong><small>{document.chunkCount} 个分块 · {document.path}</small></div><button onClick={() => void window.xpaw.deleteKnowledge(document.id).then(refreshKnowledge)}>移除索引</button></article>)}</div></section><aside className="insights"><p className="eyebrow">支持格式</p><h2>文本优先</h2><div className="workspace"><small>TXT、MD、JSON、CSV、YAML</small><small>单文件最大 5 MB</small><small>回答会引用文件和行号</small></div></aside></main>;
  if (view === "memory") return <main className="app-shell"><aside className="rail"><div className="mark">X</div><button className="rail-button" onClick={() => setView("chat")}>✉</button><button className="rail-button active">◉</button><button className="rail-button" onClick={() => setView("settings")}>⚙</button></aside><aside className="sidebar"><div className="brand"><span>XPaw</span><small>MEMORY CONTROL</small></div><p className="settings-note">只有你明确保存的内容会成为长期记忆。敏感信息不应保存。</p></aside><section className="settings-page"><header><div><p className="eyebrow">可控记忆</p><h1>用户档案与长期记忆</h1></div><button className="back" onClick={() => setView("chat")}>返回对话</button></header><div className="memory-layout"><div className="settings-form"><h2>用户档案</h2><label>偏好称呼<input value={userProfile.preferredName} onChange={(event) => setUserProfile({ ...userProfile, preferredName: event.target.value })} /></label><label>语言<input value={userProfile.language} onChange={(event) => setUserProfile({ ...userProfile, language: event.target.value })} /></label><label>时区<input value={userProfile.timezone} onChange={(event) => setUserProfile({ ...userProfile, timezone: event.target.value })} /></label><label>沟通偏好<textarea value={userProfile.communicationStyle} onChange={(event) => setUserProfile({ ...userProfile, communicationStyle: event.target.value })} /></label><button className="save" onClick={() => void window.xpaw.saveUserProfile(userProfile)}>保存用户档案</button>{conversationSummary && <div className="summary-card"><p className="eyebrow">当前会话摘要</p><p>{conversationSummary.content}</p><button onClick={() => { if (activeConversation) void window.xpaw.deleteConversationSummary(activeConversation).then(refreshMemory); }}>删除摘要</button></div>}</div><div className="memory-list"><h2>长期记忆</h2><div className="memory-add"><select value={memoryDraft.category} onChange={(event) => setMemoryDraft({ ...memoryDraft, category: event.target.value as MemoryItem["category"] })}><option value="preference">偏好</option><option value="fact">事实</option><option value="instruction">约定</option><option value="summary">摘要</option></select><textarea placeholder="例如：用户偏好中文且希望回答简洁。" value={memoryDraft.content} onChange={(event) => setMemoryDraft({ ...memoryDraft, content: event.target.value })} /><button className="save" onClick={() => void saveMemory()}>明确保存记忆</button></div>{memories.map((memory) => <article className="memory-item" key={memory.id}><small>{memory.category} · {memory.source}</small><textarea defaultValue={memory.content} onBlur={(event) => { if (event.target.value !== memory.content) void updateMemory(memory, event.target.value); }} /><button onClick={() => void window.xpaw.deleteMemory(memory.id).then(refreshMemory)}>删除</button></article>)}</div></div></section><aside className="insights"><p className="eyebrow">注入规则</p><h2>相关且有限</h2><div className="workspace"><small>每次最多检索 5 条相关记忆</small><small>用户可编辑或删除全部记忆</small><small>密码、验证码和 API Key 不保存</small></div></aside></main>;
  if (view === "tasks") return <main className="app-shell"><aside className="rail"><div className="mark">X</div><button className="rail-button" onClick={() => setView("chat")}>✉</button><button className="rail-button active">☑</button><button className="rail-button" onClick={() => setView("usage")}>▦</button><button className="rail-button" onClick={() => setView("settings")}>⚙</button></aside><aside className="sidebar"><div className="brand"><span>XPaw</span><small>TASK HISTORY</small></div><p className="eyebrow">最近任务</p>{tasks.map((task) => <button className={`task-item ${task.id === selectedTask?.id ? "active" : ""}`} key={task.id} onClick={() => void selectTask(task)}><strong>{task.objective}</strong><small className={`status ${task.status}`}>{task.status}</small></button>)}</aside><section className="settings-page"><header><div><p className="eyebrow">任务审计</p><h1>{selectedTask?.objective ?? "选择一个任务"}</h1></div><button className="back" onClick={() => setView("chat")}>返回对话</button></header>{selectedTask && <div className="task-detail"><div className="task-plan"><p className="eyebrow">执行计划</p><p>{selectedTask.plan ?? "无计划记录"}</p>{selectedTask.error && <p className="task-error">{selectedTask.error}</p>}<button className="save" onClick={() => void rerunTask(selectedTask)}>重新执行原请求</button></div><div className="timeline">{taskEvents.map((event) => <article key={event.id}><i className={event.type}></i><div><strong>{event.type}</strong><p>{event.message}</p><small>{event.createdAt}</small></div></article>)}</div></div>}</section><aside className="insights"><p className="eyebrow">任务状态</p><h2>{selectedTask?.status ?? "-"}</h2><div className="workspace"><small>取消、失败、确认和工具调用均会审计</small><small>中断任务只能重新执行原请求</small></div></aside></main>;
  if (view === "usage") { const detail = usageDetail ?? usage; const usageHigh = Math.max(...(detail?.daily.map((item) => item.tokens) ?? [1]), 1); return <main className="app-shell"><aside className="rail"><div className="mark">X</div><button className="rail-button" onClick={() => setView("chat")}>✉</button><button className="rail-button active">▦</button><button className="rail-button" onClick={() => setView("character")}>☷</button><button className="rail-button" onClick={() => setView("settings")}>⚙</button></aside><aside className="sidebar"><div className="brand"><span>XPaw</span><small>USAGE ANALYTICS</small></div><p className="eyebrow">按模型筛选</p><button className={`session ${!usageModelId ? "active" : ""}`} onClick={() => void refreshUsage(usageDays)}>全部模型</button>{profiles.map((item) => <button className={`session ${usageModelId === item.modelId ? "active" : ""}`} onClick={() => void refreshUsage(usageDays, item.modelId)} key={item.id}>{item.name}</button>)}</aside><section className="settings-page"><header><div><p className="eyebrow">本地统计</p><h1>Token 使用情况</h1></div><button className="back" onClick={() => setView("chat")}>返回对话</button></header><div className="usage-controls">{[7, 30, 365].map((days) => <button className={usageDays === days ? "active" : ""} onClick={() => void refreshUsage(days)} key={days}>{days === 365 ? "一年" : `${days} 天`}</button>)}</div><div className="usage-big"><div><small>总 Token</small><strong>{detail?.totalTokens ?? 0}</strong></div><div><small>今日</small><strong>{detail?.todayTokens ?? 0}</strong></div><div><small>模型请求</small><strong>{detail?.requests ?? 0}</strong></div></div><div className="heatmap large">{Array.from({ length: 182 }, (_, index) => { const point = detail?.daily[index]; const level = point ? Math.max(1, Math.ceil((point.tokens / usageHigh) * 4)) : 0; return <div key={index} className={`heat l${level}`} title={point ? `${point.date}: ${point.tokens} tokens` : "无使用记录"} />; })}</div><div className="legend"><span>少</span><i className="l0"/><i className="l1"/><i className="l2"/><i className="l3"/><i className="l4"/><span>多</span></div></section><aside className="insights"><p className="eyebrow">隐私</p><h2>仅本地存储</h2><div className="workspace"><small>统计来自本机 SQLite</small><small>不会额外保存提示词副本</small></div></aside></main>; }
  if (view === "character") return <main className="app-shell"><aside className="rail"><div className="mark">X</div><button className="rail-button" onClick={() => setView("chat")}>✉</button><button className="rail-button active">☷</button><button className="rail-button" onClick={() => setView("settings")}>⚙</button></aside><aside className="sidebar"><div className="brand"><span>XPaw</span><small>CHARACTER CARD</small></div><div className="character"><div className="avatar">XP</div><div><strong>{character?.name ?? "XPaw"}</strong><small>本机覆盖配置</small></div><i></i></div><p className="settings-note">导出角色卡时不会包含模型、工作区和密钥。</p></aside><section className="settings-page"><header><div><p className="eyebrow">角色设定</p><h1>角色与表达</h1></div><button className="back" onClick={() => setView("chat")}>返回对话</button></header>{character && <div className="settings-form"><label>名称<input value={character.name} onChange={(event) => setCharacter({ ...character, name: event.target.value })} /></label><label>简介<textarea value={character.description} onChange={(event) => setCharacter({ ...character, description: event.target.value })} /></label><label>角色职责<input value={character.role} onChange={(event) => setCharacter({ ...character, role: event.target.value })} /></label><label>核心定位<textarea value={character.summary} onChange={(event) => setCharacter({ ...character, summary: event.target.value })} /></label><label>表达语气<input value={character.tone} onChange={(event) => setCharacter({ ...character, tone: event.target.value })} /></label><button className="save" onClick={() => void saveCharacter()}>保存角色设定</button></div>}</section><aside className="insights"><p className="eyebrow">安全边界</p><h2>不可导出</h2><div className="workspace"><small>API Key</small><small>模型档案</small><small>工作区授权</small></div></aside></main>;
  if (view === "settings") return <main className="app-shell"><aside className="rail"><div className="mark">X</div><button className="rail-button" onClick={() => setView("chat")} title="对话">&#9993;</button><button className="rail-button active" title="设置">&#9881;</button></aside><aside className="sidebar"><div className="brand"><span>XPaw</span><small>MODEL SETTINGS</small></div><p className="eyebrow">模型档案</p>{profiles.map((item) => <button key={item.id} className={`session ${item.id === profile?.id ? "active" : ""}`} onClick={() => setSelectedProfileId(item.id)}>{item.local ? "本地 · " : "云端 · "}{item.name}</button>)}<div className="local-note"><span></span>密钥仅保留在本机</div></aside><section className="settings-page"><header><div><p className="eyebrow">运行时配置</p><h1>模型与能力</h1></div><button className="back" onClick={() => setView("chat")}>返回对话</button></header>{profile && <div className="settings-form"><label>档案名称<input value={profile.name} onChange={(event) => void saveProfile({ name: event.target.value })} /></label><label>Provider<input value={profile.provider} disabled /></label><label>模型{profile.local ? <select value={profile.modelId} onChange={(event) => void switchModel(event.target.value)}>{models.map((model) => <option key={model} value={model}>{model}</option>)}</select> : <input value={profile.modelId} onChange={(event) => void saveProfile({ modelId: event.target.value })} />}</label><label>温度 <output>{profile.temperature.toFixed(2)}</output><input type="range" min="0" max="1" step="0.05" value={profile.temperature} onChange={(event) => void saveProfile({ temperature: Number(event.target.value) })} /></label><label>最大输出 Token<select value={profile.maxTokens} onChange={(event) => void saveProfile({ maxTokens: Number(event.target.value) })}><option value="128">128</option><option value="256">256</option><option value="384">384</option><option value="512">512</option></select></label><label className="toggle"><input type="checkbox" checked={profile.toolsEnabled} onChange={(event) => void saveProfile({ toolsEnabled: event.target.checked })} />允许模型调用文件工具</label><button className="save" onClick={() => void activateProfile(profile.id)}>使用此档案</button></div>}<div className="cloud-form"><p className="eyebrow">新增 OpenAI-compatible 云端连接</p><input placeholder="档案名称" value={cloudForm.name} onChange={(event) => setCloudForm({ ...cloudForm, name: event.target.value })} /><input placeholder="Base URL，例如 https://provider.example/v1" value={cloudForm.baseUrl} onChange={(event) => setCloudForm({ ...cloudForm, baseUrl: event.target.value })} /><input placeholder="模型名称" value={cloudForm.modelId} onChange={(event) => setCloudForm({ ...cloudForm, modelId: event.target.value })} /><input type="password" placeholder="API Key，仅加密保存在本机" value={cloudForm.apiKey} onChange={(event) => setCloudForm({ ...cloudForm, apiKey: event.target.value })} /><button className="save" onClick={() => void addCloudProfile()}>测试并保存云端档案</button><small className="cloud-status">{cloudStatus}</small></div></section><aside className="insights"><p className="eyebrow">能力说明</p><h2>当前档案</h2><div className="workspace"><code>{profile?.modelId}</code><small>{profile?.toolsEnabled ? "允许 Agent 工具调用" : "仅普通聊天"}</small><small>流式输出：已启用</small><small>本地运行：{profile?.local ? "是" : "否"}</small></div></aside></main>;
  return <main className="app-shell">
    <aside className="rail"><div className="mark">X</div><button className="rail-button active" title="对话">&#9993;</button><button className="rail-button" onClick={() => { setView("tasks"); void refreshTasks(); }} title="任务">☑</button><button className="rail-button" onClick={() => { setView("usage"); void refreshUsage(); }} title="用量">▦</button><button className="rail-button" onClick={() => { setView("memory"); void refreshMemory(); }} title="记忆">◉</button><button className="rail-button" onClick={() => { setView("knowledge"); void refreshKnowledge(); }} title="知识库">⌕</button><button className="rail-button" onClick={() => setView("character")} title="角色">&#9787;</button><button className="rail-button" onClick={() => setView("settings")} title="设置">&#9881;</button></aside>
     <aside className="sidebar"><div className="brand"><span>XPaw</span><small>LOCAL COMPANION</small></div><button className="new-chat" disabled={busy} onClick={() => void newConversation()}>+ 新建对话</button><section><p className="eyebrow">角色</p><div className="character"><div className="avatar">XP</div><div><strong>XPaw</strong><small>本地个人助理</small></div><i></i></div></section><section className="sessions"><p className="eyebrow">最近会话</p>{conversations.map((conversation) => <div className={`session-row ${conversation.id === activeConversation ? "active" : ""}`} key={conversation.id}><button className="session" onClick={() => void selectConversation(conversation.id)}>{conversation.title}</button><button className="session-action" onClick={() => void renameConversation(conversation)} title="重命名">⋯</button><button className="session-action" onClick={() => void deleteConversation(conversation)} title="删除">×</button></div>)}</section><div className="local-note"><span></span>{config?.local ? "本地模型运行中" : "云端模型已连接"}</div></aside>
      <section className="conversation"><header><div><p className="eyebrow">当前角色</p><h1>和 XPaw 对话</h1></div><label className="model-pill"><span></span><select value={config?.modelId ?? ""} disabled={switching || !config?.local || busy} onChange={(event) => void switchModel(event.target.value)}>{models.map((model) => <option key={model} value={model}>{model}</option>)}</select><b>{switching ? "切换中" : config?.provider ?? ""}</b></label></header><div className="messages">{messages.map((message, index) => <article key={index} className={`message ${message.role}`}><div className="message-avatar">{message.role === "assistant" ? "XP" : "你"}</div><div><p>{message.role === "assistant" ? "XPaw" : "你"}</p><div className="bubble">{message.content || (busy && index === messages.length - 1 ? <span className="thinking"><span></span><span></span><span></span></span> : "")}</div>{message.role === "assistant" && message.content && <div className="message-actions"><button onClick={() => void copyAnswer(message.content, index)}>{copiedIndex === index ? "已复制" : "复制"}</button>{index === messages.length - 1 && !busy && <button onClick={() => void regenerate()}>重新生成</button>}</div>}</div></article>)}<div ref={messagesEnd} /></div><div className="composer"><div className="activity">{activity ?? ""}</div><div className="suggestions">{starters.map((item) => <button key={item} disabled={busy} onClick={() => void send(item)}>{item}</button>)}</div><textarea value={input} disabled={busy} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="交代一个任务，或和 XPaw 聊聊..." />{busy ? <button className="send stop" onClick={() => void stop()} aria-label="停止生成">■</button> : <button className="send" disabled={!input.trim()} onClick={() => void send()} aria-label="发送">↑</button>}</div></section>
    <aside className="insights"><p className="eyebrow">本地活动</p><h2>Token 用量</h2><div className="stats"><div><small>今日</small><strong>{usage?.todayTokens ?? 0}</strong><span>tokens</span></div><div><small>累计</small><strong>{usage?.totalTokens ?? 0}</strong><span>tokens</span></div></div><div className="heatmap-head"><span>近一年</span><small>{usage?.requests ?? 0} 次模型请求</small></div><div className="heatmap">{Array.from({ length: 84 }, (_, index) => { const point = usage?.daily[index]; const level = point ? Math.max(1, Math.ceil((point.tokens / highest) * 4)) : 0; return <div key={index} className={`heat l${level}`} title={point ? `${point.date}: ${point.tokens} tokens` : "无使用记录"} />; })}</div><div className="legend"><span>少</span><i className="l0"/><i className="l1"/><i className="l2"/><i className="l3"/><i className="l4"/><span>多</span></div><div className="workspace"><p className="eyebrow">授权工作区</p><code>{config?.workspacePath ?? "..."}</code><small>写入会单独请求你的确认</small></div></aside>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
