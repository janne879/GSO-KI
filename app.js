/**
 * GSO KI-Chat — WebLLM Chat Interface
 */

import * as webllm from "https://esm.run/@mlc-ai/web-llm";

let engine = null;
let isGenerating = false;
let currentChatId = null;
let chats = {};
let selectedModel = "Llama-3.2-3B-Instruct-q4f32_1-MLC";
let currentMessages = [];

const $ = id => document.getElementById(id);

const loadScreen    = $("load-screen");
const chatArea      = $("chat-area");
const inputArea     = $("input-area");
const messagesEl    = $("messages");
const userInput     = $("user-input");
const sendBtn       = $("send-btn");
const loadModelBtn  = $("load-model-btn");
const loadProgress  = $("load-progress-wrap");
const progressFill  = $("load-progress-fill");
const progressLabel = $("load-progress-label");
const statusEl      = $("status-indicator");
const statusText    = statusEl ? statusEl.querySelector(".status-text") : null;
const currentTag    = $("current-model-tag");
const historyEl     = $("chat-history");
const webgpuWarn    = $("webgpu-warning");
const deviceInfo    = $("device-info");
const sidebar       = $("sidebar");
const charCount     = $("char-count");

(async function init() {
  detectDevice();
  loadHistory();
  renderHistory();
  setupEventListeners();
  if (!navigator.gpu) {
    if (webgpuWarn) webgpuWarn.style.display = "block";
    if (loadModelBtn) loadModelBtn.disabled = true;
    setStatus("error", "Kein WebGPU");
  }
})();

function detectDevice() {
  if (!deviceInfo) return;
  const gpu = navigator.gpu ? "WebGPU ✓" : "Kein WebGPU";
  const mem = navigator.deviceMemory ? navigator.deviceMemory + "GB RAM" : "";
  deviceInfo.querySelector("span").textContent = [gpu, mem].filter(Boolean).join(" · ");
}

function setStatus(state, text) {
  if (!statusEl) return;
  statusEl.className = "status-indicator " + state;
  if (statusText) statusText.textContent = text;
}

async function loadModel() {
  loadModelBtn.disabled = true;
  loadProgress.style.display = "block";
  setStatus("loading", "Lädt…");
  try {
    engine = await webllm.CreateMLCEngine(selectedModel, {
      initProgressCallback: (progress) => {
        const pct = Math.round((progress.progress || 0) * 100);
        progressFill.style.width = pct + "%";
        progressLabel.textContent = progress.text || ("Lädt… " + pct + "%");
      }
    });
    currentTag.textContent = selectedModel;
    setStatus("ready", "Bereit");
    loadScreen.style.display = "none";
    chatArea.style.display = "flex";
    inputArea.style.display = "block";
    newChat();
    userInput.focus();
  } catch (err) {
    console.error("Modellfehler:", err);
    setStatus("error", "Fehler");
    progressLabel.textContent = "Fehlgeschlagen: " + err.message;
    loadModelBtn.disabled = false;
  }
}

function newChat() {
  currentChatId = "chat_" + Date.now();
  currentMessages = [];
  chats[currentChatId] = { title: "Neuer Chat", messages: [] };
  saveHistory();
  renderHistory();
  messagesEl.innerHTML = "";
  showWelcome();
}

function loadChat(id) {
  if (!chats[id]) return;
  currentChatId = id;
  currentMessages = chats[id].messages.slice();
  messagesEl.innerHTML = "";
  for (const msg of currentMessages) appendMessageEl(msg.role, msg.content, false);
  if (currentMessages.length === 0) showWelcome();
  renderHistory();
}

function showWelcome() {
  messagesEl.innerHTML = '<div class="welcome-msg"><h2>GSO KI-Chat</h2><p>Dein Modell ist geladen und bereit.<br>Stell beliebige Fragen – dein Gespräch bleibt vollständig privat.</p></div>';
}

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || !engine || isGenerating) return;
  if (messagesEl.querySelector(".welcome-msg")) messagesEl.innerHTML = "";
  userInput.value = "";
  autoResize();
  charCount.textContent = "0 / 4000";
  sendBtn.disabled = true;
  currentMessages.push({ role: "user", content: text });
  appendMessageEl("user", text, true);
  updateChatTitle(text);
  saveHistory();
  const assistantEl = appendMessageEl("assistant", "", false);
  const bubble = assistantEl.querySelector(".bubble");
  isGenerating = true;
  let fullResponse = "";
  try {
    const stream = await engine.chat.completions.create({
      messages: currentMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    });
    const cursor = document.createElement("span");
    cursor.className = "typing-cursor";
    bubble.appendChild(cursor);
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      fullResponse += delta;
      cursor.remove();
      bubble.innerHTML = formatMarkdown(fullResponse);
      bubble.appendChild(cursor);
      scrollToBottom();
    }
    cursor.remove();
    bubble.innerHTML = formatMarkdown(fullResponse);
    addCodeCopyButtons(bubble);
  } catch (err) {
    bubble.innerHTML = '<span style="color:var(--red)">Fehler: ' + err.message + '</span>';
    fullResponse = fullResponse || "[Fehler bei der Generierung]";
  }
  currentMessages.push({ role: "assistant", content: fullResponse });
  chats[currentChatId].messages = currentMessages.slice();
  saveHistory();
  isGenerating = false;
  sendBtn.disabled = !userInput.value.trim();
  scrollToBottom();
}

function appendMessageEl(role, content, animate) {
  const msg = document.createElement("div");
  msg.className = "message " + role;
  if (!animate) msg.style.animation = "none";
  const label = role === "user" ? "Du" : "GSO";
  msg.innerHTML = '<div class="avatar">' + label + '</div><div class="bubble">' + (content ? formatMarkdown(content) : "") + '</div>';
  messagesEl.appendChild(msg);
  scrollToBottom();
  return msg;
}

function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

function formatMarkdown(text) {
  let out = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  out = out.replace(/```(\w*)\n?([\s\S]*?)```/g, function(_, lang, code) {
    return '<pre><code class="lang-' + lang + '">' + code.trim() + '</code></pre>';
  });
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  out = out.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  out = out.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
  out = out.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
  out = out.replace(/^---$/gm, "<hr />");
  out = out.replace(/^[\*\-] (.+)$/gm, "<li>$1</li>");
  out = out.replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>");
  out = out.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  out = out.split(/\n\n+/).map(function(para) {
    para = para.trim();
    if (!para) return "";
    if (/^<(h[123]|ul|ol|pre|blockquote|hr)/.test(para)) return para;
    return "<p>" + para.replace(/\n/g, "<br/>") + "</p>";
  }).join("\n");
  return out;
}

function addCodeCopyButtons(container) {
  container.querySelectorAll("pre").forEach(function(pre) {
    if (pre.querySelector(".copy-code-btn")) return;
    const btn = document.createElement("button");
    btn.className = "copy-code-btn";
    btn.textContent = "kopieren";
    btn.onclick = function() {
      navigator.clipboard.writeText(pre.querySelector("code")?.textContent || "");
      btn.textContent = "kopiert!";
      setTimeout(function() { btn.textContent = "kopieren"; }, 2000);
    };
    pre.style.position = "relative";
    pre.appendChild(btn);
  });
}

function saveHistory() {
  try {
    localStorage.setItem("gso_chats", JSON.stringify(chats));
    localStorage.setItem("gso_current", currentChatId);
  } catch (_) {}
}

function loadHistory() {
  try {
    const saved = localStorage.getItem("gso_chats");
    if (saved) chats = JSON.parse(saved);
    const last = localStorage.getItem("gso_current");
    if (last && chats[last]) currentChatId = last;
  } catch (_) {}
}

function renderHistory() {
  const entries = Object.entries(chats).reverse();
  if (entries.length === 0) {
    historyEl.innerHTML = '<div class="history-empty">Noch keine Chats</div>';
    return;
  }
  historyEl.innerHTML = entries.map(function(e) {
    return '<div class="history-item ' + (e[0] === currentChatId ? "active" : "") + '" data-id="' + e[0] + '">' + escapeHtml(e[1].title) + '</div>';
  }).join("");
  historyEl.querySelectorAll(".history-item").forEach(function(el) {
    el.addEventListener("click", function() { if (engine) loadChat(el.dataset.id); });
  });
}

function updateChatTitle(text) {
  if (!chats[currentChatId]) return;
  chats[currentChatId].title = text.length > 38 ? text.slice(0, 38) + "…" : text;
  renderHistory();
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

$("model-selector").querySelectorAll(".model-option").forEach(function(opt) {
  opt.addEventListener("click", function() {
    if (engine) return;
    $("model-selector").querySelectorAll(".model-option").forEach(function(o) { o.classList.remove("active"); });
    opt.classList.add("active");
    selectedModel = opt.dataset.model;
  });
});

function autoResize() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 200) + "px";
}

function setupEventListeners() {
  loadModelBtn.addEventListener("click", loadModel);
  userInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage();
    }
  });
  userInput.addEventListener("input", function() {
    autoResize();
    charCount.textContent = userInput.value.length + " / 4000";
    sendBtn.disabled = !userInput.value.trim() || isGenerating;
  });
  sendBtn.addEventListener("click", sendMessage);
  $("new-chat-btn").addEventListener("click", function() { if (engine) newChat(); });
  $("clear-btn").addEventListener("click", function() {
    if (!engine) return;
    currentMessages = [];
    if (chats[currentChatId]) chats[currentChatId].messages = [];
    saveHistory();
    messagesEl.innerHTML = "";
    showWelcome();
  });
  $("sidebar-toggle").addEventListener("click", function() {
    sidebar.classList.toggle("collapsed");
    sidebar.classList.toggle("open");
  });
}