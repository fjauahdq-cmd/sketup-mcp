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

// ---- Formato de arquivo do app ----
// A MAIORIA dos arquivos de projeto = bytes AES-128-CBC, chave = IV = "sketchwaresecure".
// Na nuvem trafegam como { "__b64": "<base64 dos bytes>" }.
// EXCEÇÃO: alguns arquivos são TEXTO PURO no app (FileUtil.readFile sem decriptar):
const SK_KEY = Buffer.from("sketchwaresecure", "utf8");
const PLAIN_FILES = new Set(["data/permission", "data/project_config", "data/import"]);

function encryptFile(plain) {
  const cipher = crypto.createCipheriv("aes-128-cbc", SK_KEY, SK_KEY);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { __b64: encrypted.toString("base64") };
}

// Grava respeitando o tipo do arquivo: texto puro ou criptografado
function encodeFile(path, plain) {
  return PLAIN_FILES.has(path) ? plain : encryptFile(plain);
}

function decryptFile(value) {
  try {
    if (value && typeof value === "object" && typeof value.__b64 === "string") {
      const raw = Buffer.from(value.__b64, "base64");
      const decipher = crypto.createDecipheriv("aes-128-cbc", SK_KEY, SK_KEY);
      return Buffer.concat([decipher.update(raw), decipher.final()]).toString("utf8");
    }
    if (typeof value === "string") return value; // arquivo texto puro
    return value;
  } catch {
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

// ---- Estrutura REAL de um projeto SKET-UP (extraída de um projeto criado pelo app) ----
// list/project        → config (criptografado)
// data/file           → seções @activity / @customview (criptografado)
// data/view           → seções @tela.xml / @tela.xml_fab (criptografado)
// data/logic          → seções @Tela.java_* (criptografado)
// data/resource       → seções @images/@sounds/@fonts (criptografado)
// data/library        → seções @firebaseDB/@compat/@admob/@googleMap (criptografado)
// data/permission     → array JSON de permissões (TEXTO PURO)

const STANDARD_FILES = ["list/project", "data/view", "data/logic", "data/file", "data/resource", "data/library", "data/permission"];

const VIEW_TYPES = {
  0: "LinearLayout", 1: "RelativeLayout", 2: "HScrollView", 3: "Button", 4: "TextView",
  5: "EditText", 6: "ImageView", 7: "WebView", 8: "ProgressBar", 9: "ListView",
  10: "Spinner", 11: "CheckBox", 12: "VScrollView", 13: "Switch", 14: "SeekBar",
  15: "CalendarView", 16: "FAB", 17: "AdView",
};

// FAB padrão — copiado de um projeto real criado pelo app
const DEFAULT_FAB = { adSize: "", adUnitId: "", alpha: 1.0, checked: 0, choiceMode: 0, clickable: 1, convert: "", customView: "", dividerHeight: 1, enabled: 1, firstDayOfWeek: 1, id: "_fab", image: { rotate: 0, scaleType: "CENTER" }, indeterminate: "false", index: 0, inject: "", layout: { backgroundColor: 16777215, borderColor: -16740915, gravity: 0, height: -2, layoutGravity: 85, marginBottom: 16, marginLeft: 16, marginRight: 16, marginTop: 16, orientation: -1, paddingBottom: 0, paddingLeft: 0, paddingRight: 0, paddingTop: 0, weight: 0, weightSum: 0, width: -2 }, max: 100, parentAttributes: {}, parentType: -1, preIndex: 0, preParentType: 0, progress: 0, progressStyle: "?android:progressBarStyle", scaleX: 1.0, scaleY: 1.0, spinnerMode: 1, text: { hint: "", hintColor: 16777215, imeOption: 0, inputType: 1, line: 0, singleLine: 0, text: "", textColor: 16777215, textFont: "default_font", textSize: 12, textType: 0 }, translationX: 0.0, translationY: 0.0, type: 16 };

function libraryItem(libType, useYn) {
  return JSON.stringify({ adUnits: [], appId: "", configurations: {}, data: "", libType, reserved1: "", reserved2: "", reserved3: "", testDevices: [], useYn });
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Skeleton IDÊNTICO ao que o app grava ao criar um projeto novo
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

function summarizeViews(viewText) {
  const lines = String(viewText).split("\n");
  const screens = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("@")) {
      const dot = line.indexOf(".");
      current = {
        screen: dot > 0 ? line.slice(1, dot) : line.slice(1),
        kind: dot > 0 ? line.slice(dot + 1) : "",
        widgets: [],
      };
      screens.push(current);
      continue;
    }
    if (!line.trim() || !current) continue;
    try {
      const v = JSON.parse(line);
      const widget = { id: v.id, type: VIEW_TYPES[v.type] ?? v.type, parent: v.parent };
      if (v.text?.text) widget.text = v.text.text;
      current.widgets.push(widget);
    } catch {
      current.widgets.push({ raw: line.slice(0, 120) });
    }
  }
  return { screens };
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

function createServer(token) {
  const server = new McpServer({ name: "sketup-mcp", version: "2.4.0" });

  server.registerTool(
    "list_projects",
    { description: "Lista os projetos da conta vinculada (id, sc_id, pacote, versão, atualização)", inputSchema: {} },
    async () => asText(await rpc("mcp_projects_list", { p_token: token }))
  );

  server.registerTool(
    "get_project",
    {
      description: "Lê um projeto completo: config + arquivos descriptografados (list/project, data/view, data/logic...)",
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
    "set_project_files",
    {
      description: "Regrava TODOS os arquivos de um projeto de uma vez (mapa caminho→texto puro; o servidor aplica o formato certo de cada arquivo). Ideal para correções em lote.",
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
      description: "Lê um arquivo do projeto (list/project, data/view, data/logic, data/file, data/resource, data/library, data/permission) descriptografado",
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
    "save_file",
    {
      description: "Grava um arquivo do projeto (texto puro — o servidor aplica o formato certo: criptografa ou não conforme o tipo). Marca o projeto como atualizado para o sync.",
      inputSchema: {
        project_id: z.string(),
        path: z.string().describe("ex.: data/view"),
        content: z.string().describe("Conteúdo em texto puro (formato do arquivo do app)"),
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
    "get_views",
    {
      description: "Resume as telas e widgets do projeto (seções @tela.xml): id, tipo, pai, texto",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) => {
      const row = await getProject(token, project_id);
      const viewText = decryptFile(row?.data?.files?.["data/view"]);
      if (!viewText) return asText({ error: "projeto sem arquivo data/view" });
      return asText(summarizeViews(viewText));
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
  res.json({ ok: true, service: "sketup-mcp", version: "2.4.0", time: new Date().toISOString() });
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
app.listen(port, () => console.log(`sketup-mcp v2.4 ouvindo na porta ${port}`));
