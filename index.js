import express from "express";
import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Configure SUPABASE_URL e SUPABASE_KEY nas variáveis de ambiente.");
  process.exit(1);
}

// APENAS estes 6 arquivos são criptografados (AES-128-CBC, chave = IV = "sketchwaresecure"):
const SK_KEY = Buffer.from("sketchwaresecure", "utf8");
const ENCRYPTED_FILES = new Set([
  "list/project", "data/view", "data/logic", "data/file", "data/resource", "data/library",
]);

function encryptFile(plain) {
  const cipher = crypto.createCipheriv("aes-128-cbc", SK_KEY, SK_KEY);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { __b64: encrypted.toString("base64") };
}

function encodeFile(path, plain) {
  return ENCRYPTED_FILES.has(path) ? encryptFile(plain) : plain;
}

function decryptFile(value) {
  try {
    if (value && typeof value === "object" && typeof value.__b64 === "string") {
      const raw = Buffer.from(value.__b64, "base64");
      const decipher = crypto.createDecipheriv("aes-128-cbc", SK_KEY, SK_KEY);
      return Buffer.concat([decipher.update(raw), decipher.final()]).toString("utf8");
    }
    if (typeof value === "string") return value;
    return value;
  } catch {
    if (value && typeof value === "object" && typeof value.__b64 === "string") {
      try { return Buffer.from(value.__b64, "base64").toString("utf8"); } catch { return null; }
    }
    return typeof value === "string" ? value : null;
  }
}

async function rpc(name, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Backend recusou a operação (${res.status}): ${body.slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : null;
}

function getToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  if (typeof req.query.token === "string") return req.query.token;
  return null;
}

function asText(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

const STANDARD_FILES = ["list/project", "data/view", "data/logic", "data/file", "data/resource", "data/library", "data/permission"];

const VIEW_TYPES = {
  0: "LinearLayout", 1: "RelativeLayout", 2: "HScrollView", 3: "Button", 4: "TextView",
  5: "EditText", 6: "ImageView", 7: "WebView", 8: "ProgressBar", 9: "ListView",
  10: "Spinner", 11: "CheckBox", 12: "VScrollView", 13: "Switch", 14: "SeekBar",
  15: "CalendarView", 16: "FAB", 17: "AdView",
};

const DEFAULT_FAB = { adSize: "", adUnitId: "", alpha: 1.0, checked: 0, choiceMode: 0, clickable: 1, convert: "", customView: "", dividerHeight: 1, enabled: 1, firstDayOfWeek: 1, id: "_fab", image: { rotate: 0, scaleType: "CENTER" }, indeterminate: "false", index: 0, inject: "", layout: { backgroundColor: 16777215, borderColor: -16740915, gravity: 0, height: -2, layoutGravity: 85, marginBottom: 16, marginLeft: 16, marginRight: 16, marginTop: 16, orientation: -1, paddingBottom: 0, paddingLeft: 0, paddingRight: 0, paddingTop: 0, weight: 0, weightSum: 0, width: -2 }, max: 100, parentAttributes: {}, parentType: -1, preIndex: 0, preParentType: 0, progress: 0, progressStyle: "?android:progressBarStyle", scaleX: 1.0, scaleY: 1.0, spinnerMode: 1, text: { hint: "", hintColor: 16777215, imeOption: 0, inputType: 1, line: 0, singleLine: 0, text: "", textColor: 16777215, textFont: "default_font", textSize: 12, textType: 0 }, translationX: 0.0, translationY: 0.0, type: 16 };

function libraryItem(libType, useYn) {
  return JSON.stringify({ adUnits: [], appId: "", configurations: {}, data: "", libType, reserved1: "", reserved2: "", reserved3: "", testDevices: [], useYn });
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function buildSkeleton(appName, packageName, forcedScId) {
  const scId = forcedScId || String(Date.now()).slice(-9);
  const wsName = appName.replace(/[^A-Za-z0-9]/g, "") || "NewProject";

  const config = {
    custom_icon: false,
    sc_ver_code: "1",
    my_ws_name: wsName,
    color_accent: -8883068.0,
    my_app_name: appName,
    sc_ver_name: "1.0",
    sc_id: scId,
    color_primary: -8883068.0,
    color_control_highlight: -1646350.0,
    color_control_normal: -8883068.0,
    my_sc_reg_dt: nowStamp(),
    sketchware_ver: 150,
    isIconAdaptive: false,
    my_sc_pkg_name: packageName,
    color_primary_dark: -8883068.0,
  };

  const plain = {
    "list/project": JSON.stringify(config),
    "data/file": `@activity\n${JSON.stringify({ fileName: "main", fileType: 0, keyboardSetting: 0, options: 1, orientation: 0, theme: -1 })}\n@customview\n`,
    "data/view": `@main.xml_fab\n${JSON.stringify(DEFAULT_FAB)}\n\n`,
    "data/logic": "",
    "data/resource": "@images\n@sounds\n@fonts\n",
    "data/library": `@firebaseDB\n${libraryItem(0, "N")}\n@compat\n${libraryItem(1, "N")}\n@admob\n${libraryItem(2, "N")}\n@googleMap\n${libraryItem(3, "N")}\n`,
    "data/permission": "[]",
  };

  const files = {};
  for (const [path, content] of Object.entries(plain)) {
    files[path] = encodeFile(path, content);
  }
  return { scId, config, files };
}

// ================= VALIDADOR =================
function validateProject(files) {
  const issues = [];
  const dec = (p) => (files[p] != null ? decryptFile(files[p]) : null);

  const cfgText = dec("list/project");
  if (cfgText == null) {
    issues.push("FALTA list/project (o projeto nem lista no app sem ele)");
  } else {
    try {
      const c = JSON.parse(cfgText);
      for (const k of ["my_app_name", "my_sc_pkg_name", "sc_id", "sc_ver_code", "sc_ver_name"]) {
        if (!(k in c)) issues.push(`config sem a chave '${k}'`);
      }
      if (typeof c.sc_ver_code !== "string") issues.push("config.sc_ver_code deve ser TEXTO (ex.: \"1\")");
    } catch {
      issues.push("list/project não é um JSON válido");
    }
  }

  const viewText = dec("data/view");
  if (viewText != null && String(viewText).trim()) {
    const lines = String(viewText).split("\n");
    const ids = new Set();
    const layoutIds = new Set();
    let section = null;
    let count = 0;
    for (const line of lines) {
      if (line.startsWith("@")) { section = line; continue; }
      if (!line.trim()) continue;
      count++;
      try {
        const v = JSON.parse(line);
        if (typeof v.id !== "string" || !v.id) issues.push(`${section}: widget sem id`);
        else if (ids.has(v.id)) issues.push(`${section}: id DUPLICADO '${v.id}'`);
        else ids.add(v.id);
        if (typeof v.type !== "number") issues.push(`${section}/${v.id ?? "?"}: 'type' ausente/inválido`);
        if (!v.layout || typeof v.layout !== "object") issues.push(`${section}/${v.id ?? "?"}: 'layout' ausente`);
        if ([0, 1, 2, 12].includes(v.type)) layoutIds.add(v.id);
        if (section && section.endsWith("_fab") && v.type !== 16) issues.push(`${section}: seção _fab só aceita FAB (type 16)`);
      } catch {
        issues.push(`${section}: linha ${count} com JSON inválido`);
      }
    }
    for (const line of lines) {
      if (line.startsWith("@") || !line.trim()) continue;
      try {
        const v = JSON.parse(line);
        if (v.parent && v.parent !== "root" && !layoutIds.has(v.parent)) {
          issues.push(`${v.id}: pai '${v.parent}' não existe ou não é um layout (use "root" ou um LinearLayout)`);
        }
      } catch { /* já reportado */ }
    }
  }

  const logicText = dec("data/logic");
  if (logicText != null && String(logicText).trim()) {
    const lines = String(logicText).split("\n");
    const events = new Set();
    const containers = [];
    let section = null;
    for (const line of lines) {
      if (line.startsWith("@")) {
        section = line.slice(1);
        const isPool = /_events$|_var$|_list$|_components$|_func$/.test(section);
        if (!isPool) containers.push(section);
        continue;
      }
      if (!line.trim() || !section) continue;
      if (section.endsWith("_events")) {
        try {
          const ev = JSON.parse(line);
          events.add(`${ev.targetId}_${ev.eventName}`);
        } catch {
          issues.push(`${section}: evento com JSON inválido`);
        }
      } else if (containers.includes(section)) {
        try {
          const b = JSON.parse(line);
          if (!b.opCode) issues.push(`${section}: bloco sem opCode`);
          if (b.opCode === "addSourceDirectly") {
            const code = (b.parameters && b.parameters[0]) || "";
            let bal = 0;
            for (const ch of code) { if (ch === "{") bal++; if (ch === "}") bal--; }
            if (bal !== 0) issues.push(`${section}: código com chaves desbalanceadas (${bal > 0 ? "+" : ""}${bal})`);
          }
        } catch {
          issues.push(`${section}: bloco com JSON inválido`);
        }
      }
    }
    for (const c of containers) {
      const info = c.split(".java_")[1] || "";
      if (!events.has(info) && !info.endsWith("_initializeLogic") && !info.endsWith("_moreBlock")) {
        issues.push(`container '${info}' sem evento declarado em java_events`);
      }
    }
  }

  if (files["data/permission"] != null) {
    const p = dec("data/permission");
    try {
      const arr = JSON.parse(p);
      if (!Array.isArray(arr)) issues.push("data/permission deveria ser um array JSON de strings");
    } catch {
      issues.push("data/permission inválido (deveria ser array JSON — ex.: [\"android.permission.INTERNET\"])");
    }
  }

  return issues;
}

// ================= PREVIEW =================
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colorCss(c, fallback) {
  if (typeof c !== "number" || !isFinite(c)) return fallback;
  const u = c >>> 0;
  const a = (u >>> 24) / 255;
  if (a === 0) return "transparent";
  return `rgba(${(u >>> 16) & 255},${(u >>> 8) & 255},${u & 255},${a.toFixed(2)})`;
}

function buildTree(widgets) {
  const byId = new Map();
  for (const w of widgets) byId.set(w.id, { ...w, children: [] });
  const roots = [];
  for (const w of byId.values()) {
    if (w.parent && byId.has(w.parent)) byId.get(w.parent).children.push(w);
    else roots.push(w);
  }
  for (const w of byId.values()) w.children.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  roots.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return roots;
}

function renderNode(w) {
  const lay = w.layout || {};
  const t = w.text || {};
  const isLayout = [0, 1, 2, 12].includes(w.type);
  const horizontal = w.type === 2 || (isLayout && lay.orientation === 0);
  const css = [
    "box-sizing:border-box",
    `background:${colorCss(lay.backgroundColor, "transparent")}`,
    `padding:${lay.paddingTop || 0}px ${lay.paddingRight || 0}px ${lay.paddingBottom || 0}px ${lay.paddingLeft || 0}px`,
    `margin:${lay.marginTop || 0}px ${lay.marginRight || 0}px ${lay.marginBottom || 0}px ${lay.marginLeft || 0}px`,
    lay.width === -1 ? "width:100%" : lay.layoutGravity === 1 ? "margin-left:auto;margin-right:auto" : "",
    isLayout ? `display:flex;flex-direction:${horizontal ? "row" : "column"}` : "",
    "border-radius:6px",
  ].filter(Boolean).join(";");
  const textCss = `color:${colorCss(t.textColor, "#222")};font-size:${(t.textSize || 12) + 2}px;${t.textType === 1 ? "font-weight:700;" : ""}text-align:${lay.gravity === 17 ? "center" : "left"};`;
  let inner = "";
  if (w.type === 3) inner = `<div style="${textCss}background:${colorCss(lay.backgroundColor, "#555")};border-radius:8px;padding:12px;text-align:center;width:100%;box-sizing:border-box">${esc(t.text || w.id)}</div>`;
  else if (w.type === 5) inner = `<div style="background:rgba(120,120,120,.16);border:1px solid rgba(120,120,120,.4);border-radius:8px;padding:11px;color:#888;font-size:14px">${esc(t.hint || "campo de texto")}</div>`;
  else if (w.type === 6) inner = `<div style="width:64px;height:64px;background:#3a3a3a;border-radius:12px;display:flex;align-items:center;justify-content:center;margin:auto;font-size:28px">🖼️</div>`;
  else if (w.type === 13 || w.type === 11) inner = `<div style="${textCss}">◉ ${esc(t.text || w.id)}</div>`;
  else if (w.type === 14) { const pct = Math.round((100 * (w.progress || 0)) / (w.max || 100)); inner = `<div style="height:6px;background:#bbb;border-radius:3px;position:relative;margin:10px 0"><div style="position:absolute;left:calc(${pct}% - 8px);top:-6px;width:18px;height:18px;border-radius:50%;background:#ff5722"></div></div>`; }
  else if (t.text) inner = `<div style="${textCss}">${esc(t.text)}</div>`;
  else if (!isLayout) inner = `<div style="color:#999;font-size:11px">${esc(w.id)} · ${esc(VIEW_TYPES[w.type] || "view")}</div>`;
  const kids = (w.children || []).map(renderNode).join("");
  return `<div style="${css}">${inner}${kids}</div>`;
}

function renderPreview(viewText, screen, projectName) {
  const lines = String(viewText || "").split("\n");
  const widgets = [];
  let fab = null;
  let current = null;
  for (const line of lines) {
    if (line.startsWith("@")) { current = line.slice(1); continue; }
    if (!line.trim() || !current) continue;
    try {
      const v = JSON.parse(line);
      if (current === screen + ".xml") widgets.push(v);
      else if (current === screen + ".xml_fab") fab = v;
    } catch { /* ignora linha ruim */ }
  }
  const body = buildTree(widgets).map(renderNode).join("");
  const fabHtml = fab ? `<div style="position:absolute;right:18px;bottom:18px;width:52px;height:52px;border-radius:50%;background:#ff5722;box-shadow:0 4px 12px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff">＋</div>` : "";
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview · ${esc(projectName)}</title></head>
<body style="margin:0;min-height:100vh;background:#101014;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;padding:24px">
<div style="color:#888;font-size:13px;margin-bottom:12px">PREVIEW (aproximado) · ${esc(projectName)} · tela <b style="color:#ff5722">${esc(screen)}</b></div>
<div style="width:340px;min-height:560px;background:#fff;border-radius:22px;box-shadow:0 12px 40px rgba(0,0,0,.5);position:relative;overflow:hidden;display:flex;flex-direction:column">${body || "<div style='color:#999;padding:40px;text-align:center'>(tela vazia)</div>"}${fabHtml}</div>
<div style="color:#555;font-size:12px;margin-top:14px">gerado pelo SKET-UP MCP · o app pode renderizar com pequenas diferenças</div>
</body></html>`;
}

async function getProject(token, id) {
  return rpc("mcp_projects_get", { p_token: token, p_id: id });
}

async function upsert(token, id, name, data, scId) {
  return rpc("mcp_projects_upsert", {
    p_token: token,
    p_id: id ?? null,
    p_name: name,
    p_data: data,
    p_sc_id: scId ?? data?.sc_id ?? null,
  });
}

const COMPONENTS = [
  { type: 0, name: "Linear (box) vertical/horizontal", className: "LinearLayout", kind: "layout" },
  { type: 1, name: "RelativeLayout", className: "RelativeLayout", kind: "layout" },
  { type: 2, name: "HScrollView", className: "HorizontalScrollView", kind: "layout" },
  { type: 12, name: "VScrollView", className: "ScrollView", kind: "layout" },
  { type: 3, name: "Button", className: "Button", kind: "widget" },
  { type: 4, name: "TextView", className: "TextView", kind: "widget" },
  { type: 5, name: "EditText", className: "EditText", kind: "widget" },
  { type: 6, name: "ImageView", className: "ImageView", kind: "widget" },
  { type: 7, name: "WebView", className: "WebView", kind: "widget" },
  { type: 8, name: "ProgressBar", className: "ProgressBar", kind: "widget" },
  { type: 9, name: "ListView", className: "ListView", kind: "widget" },
  { type: 10, name: "Spinner", className: "Spinner", kind: "widget" },
  { type: 11, name: "CheckBox", className: "CheckBox", kind: "widget" },
  { type: 13, name: "Switch", className: "Switch", kind: "widget" },
  { type: 14, name: "SeekBar", className: "SeekBar", kind: "widget" },
  { type: 15, name: "CalendarView", className: "CalendarView", kind: "widget" },
  { type: 16, name: "FAB (botão flutuante)", className: "FloatingActionButton", kind: "widget" },
  { type: 17, name: "AdView", className: "com.google.android.gms.ads.AdView", kind: "widget" },
];

function createServer(token) {
  const server = new McpServer({ name: "sketup-mcp", version: "3.0.0" });

  server.registerTool(
    "list_projects",
    { description: "Lista os projetos da conta vinculada (id, sc_id, pacote, versão, atualização)", inputSchema: {} },
    async () => asText(await rpc("mcp_projects_list", { p_token: token }))
  );

  server.registerTool(
    "get_project",
    {
      description: "Lê um projeto completo: config + arquivos (descriptografa só os 6 arquivos criptografados do app)",
      inputSchema: { id: z.string().describe("ID do projeto") },
    },
    async ({ id }) => {
      const row = await getProject(token, id);
      const files = row?.data?.files ?? {};
      const plainFiles = {};
      for (const path of Object.keys(files)) {
        plainFiles[path] = decryptFile(files[path]);
      }
      return asText({ ...row, data: { ...(row.data ?? {}), files: plainFiles } });
    }
  );

  server.registerTool(
    "create_project",
    {
      description: "Cria um projeto novo idêntico ao que o app cria (tela main + FAB, formato real). Aparece no app após o sync.",
      inputSchema: {
        app_name: z.string().describe("Nome do app (ex.: Minha Lista)"),
        package_name: z.string().describe("Pacote (ex.: com.meuapp.lista)"),
        sc_id: z.string().optional().describe("Forçar um sc_id (uso interno)"),
      },
    },
    async ({ app_name, package_name, sc_id }) => {
      const { scId, config, files } = buildSkeleton(app_name, package_name, sc_id);
      const row = await upsert(token, null, app_name, { sc_id: scId, config, files }, scId);
      return asText({ created: { id: row.id, name: row.name, sc_id: row.sc_id }, note: "Projeto criado na nuvem. Abra o app para sincronizar e baixar." });
    }
  );

  server.registerTool(
    "save_file",
    {
      description: "Grava um arquivo de TEXTO do projeto (o servidor criptografa só se for um dos 6 arquivos criptografados). Marca o projeto como atualizado para o sync.",
      inputSchema: {
        project_id: z.string(),
        path: z.string().describe("ex.: data/view ou data/files/java/Meu.java"),
        content: z.string().describe("Conteúdo em texto puro"),
      },
    },
    async ({ project_id, path, content }) => {
      const row = await getProject(token, project_id);
      const data = row?.data ?? {};
      const files = { ...(data.files ?? {}), [path]: encodeFile(path, content) };
      const saved = await upsert(token, row.id, row.name, { ...data, files }, data.sc_id ?? null);
      return asText({ saved: true, updated_at: saved.updated_at, path });
    }
  );

  server.registerTool(
    "save_binary_file",
    {
      description: "Grava um arquivo BINÁRIO no projeto (imagem PNG/JPG, som, fonte). content_base64 = bytes em base64. NÃO usar nos 6 arquivos criptografados.",
      inputSchema: {
        project_id: z.string(),
        path: z.string().describe("ex.: shared/resources/images/logo.png"),
        content_base64: z.string().describe("Bytes do arquivo em base64"),
      },
    },
    async ({ project_id, path, content_base64 }) => {
      const row = await getProject(token, project_id);
      const data = row?.data ?? {};
      const files = { ...(data.files ?? {}), [path]: { __b64: content_base64 } };
      const saved = await upsert(token, row.id, row.name, { ...data, files }, data.sc_id ?? null);
      return asText({ saved: true, updated_at: saved.updated_at, path, bytes: Buffer.from(content_base64, "base64").length });
    }
  );

  server.registerTool(
    "set_project_files",
    {
      description: "Regrava TODOS os arquivos de um projeto de uma vez (mapa caminho→texto puro). Ideal para correções em lote.",
      inputSchema: {
        project_id: z.string(),
        files: z.record(z.string()).describe("Mapa: 'list/project', 'data/view', ... → conteúdo texto puro"),
      },
    },
    async ({ project_id, files: inputFiles }) => {
      const row = await getProject(token, project_id);
      const data = row?.data ?? {};
      const files = {};
      for (const [path, content] of Object.entries(inputFiles)) {
        files[path] = encodeFile(path, content);
      }
      const saved = await upsert(token, row.id, row.name, { ...data, files }, data.sc_id ?? null);
      return asText({ saved: true, updated_at: saved.updated_at, paths: Object.keys(inputFiles) });
    }
  );

  server.registerTool(
    "get_file",
    {
      description: "Lê um arquivo do projeto descriptografado (se for um dos 6 criptografados)",
      inputSchema: {
        project_id: z.string(),
        path: z.string().describe("ex.: data/view"),
      },
    },
    async ({ project_id, path }) => {
      const row = await getProject(token, project_id);
      const files = row?.data?.files ?? {};
      if (!(path in files)) {
        return asText({ error: "arquivo não encontrado", available: Object.keys(files) });
      }
      return asText({ path, content: decryptFile(files[path]) });
    }
  );

  server.registerTool(
    "validate_project",
    {
      description: "Valida a estrutura do projeto (views, lógica, permissões, config, pais/ids) e lista problemas ANTES de compilar",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) => {
      const row = await getProject(token, project_id);
      const issues = validateProject(row?.data?.files ?? {});
      return asText({ ok: issues.length === 0, issues, project: row?.name });
    }
  );

  server.registerTool(
    "preview_url",
    {
      description: "Gera o link de PREVIEW visual da tela (abre no navegador — mostra o design renderizado antes de compilar)",
      inputSchema: {
        project_id: z.string(),
        screen: z.string().optional().describe("tela (padrão: main)"),
      },
    },
    async ({ project_id, screen }) => {
      const base = process.env.RENDER_EXTERNAL_URL || "";
      const url = `${base}/preview?token=${encodeURIComponent(token)}&id=${encodeURIComponent(project_id)}&screen=${encodeURIComponent(screen || "main")}`;
      return asText({ preview_url: url, note: "Abra no navegador para ver o design renderizado (aproximado)." });
    }
  );

  server.registerTool(
    "get_views",
    {
      description: "Resume as telas e widgets do projeto (seções @tela.xml): id, tipo, pai, texto",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) => {
      const row = await getProject(token, project_id);
      const viewText = decryptFile(row?.data?.files?.["data/view"]);
      if (!viewText) return asText({ error: "projeto sem arquivo data/view" });
      const lines = String(viewText).split("\n");
      const screens = [];
      let current = null;
      for (const line of lines) {
        if (line.startsWith("@")) {
          const dot = line.indexOf(".");
          current = { screen: dot > 0 ? line.slice(1, dot) : line.slice(1), kind: dot > 0 ? line.slice(dot + 1) : "", widgets: [] };
          screens.push(current);
          continue;
        }
        if (!line.trim() || !current) continue;
        try {
          const v = JSON.parse(line);
          const widget = { id: v.id, type: VIEW_TYPES[v.type] ?? v.type, parent: v.parent };
          if (v.text?.text) widget.text = v.text.text;
          if (v.image?.resName) widget.image = v.image.resName;
          current.widgets.push(widget);
        } catch {
          current.widgets.push({ raw: line.slice(0, 120) });
        }
      }
      return asText({ screens });
    }
  );

  server.registerTool(
    "get_components_catalog",
    {
      description: "Catálogo dos widgets/layouts do SKET-UP com o type numérico (0=Linear/box, 3=Button, 4=TextView...)",
      inputSchema: {},
    },
    async () => asText({ components: COMPONENTS, standardFiles: STANDARD_FILES })
  );

  server.registerTool(
    "delete_project",
    {
      description: "Remove um projeto da conta vinculada (nuvem; o aparelho mantém a cópia local)",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => asText({ deleted: await rpc("mcp_projects_delete", { p_token: token, p_id: id }) })
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "25mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sketup-mcp", version: "3.0.0", time: new Date().toISOString() });
});

app.get("/preview", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  const id = typeof req.query.id === "string" ? req.query.id : null;
  const screen = typeof req.query.screen === "string" ? req.query.screen : "main";
  if (!token || !id) {
    res.status(400).send("Use ?token=<mcp_token>&id=<project_id>&screen=main");
    return;
  }
  try {
    const row = await getProject(token, id);
    const viewText = decryptFile(row?.data?.files?.["data/view"]) || "";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderPreview(viewText, screen, row?.name ?? "projeto"));
  } catch (e) {
    res.status(500).send("erro ao gerar preview: " + String(e));
  }
});

app.post("/mcp", async (req, res) => {
  const token = getToken(req);
  if (!token) {
    res.status(401).json({ error: "Envie o token MCP: Authorization: Bearer <token>" });
    return;
  }
  try {
    const server = createServer(token);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: String(error) });
  }
});

app.get("/mcp", (_req, res) => res.status(405).json({ error: "Modo stateless: use POST" }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Modo stateless: use POST" }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`sketup-mcp v3.0 ouvindo na porta ${port}`));
