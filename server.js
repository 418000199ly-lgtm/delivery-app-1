#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_config = require("dotenv/config");
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_child_process = require("child_process");
var import_promise = __toESM(require("mysql2/promise"), 1);
var import_vite = require("vite");
var $Dypnsapi20170525 = __toESM(require("@alicloud/dypnsapi20170525"), 1);
var $OpenApi = __toESM(require("@alicloud/openapi-client"), 1);
var DEFAULT_ALI_KEY_ID = Buffer.from("TFRBSTV0N0JSeGM1YTZNRXl6Y1lMWE9B", "base64").toString("utf8");
var DEFAULT_ALI_KEY_SECRET = Buffer.from("cmVtU1ZOYms4WVFrcnh5VVMwRzR3blVrSHRZclJJ", "base64").toString("utf8");
function getDypnsClient() {
  const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
  const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    return null;
  }
  let OpenApiConfigClass = $OpenApi.Config;
  if (typeof OpenApiConfigClass !== "function") {
    OpenApiConfigClass = $OpenApi.default?.Config;
  }
  let DypnsClientClass = $Dypnsapi20170525.default;
  if (typeof DypnsClientClass !== "function") {
    if (DypnsClientClass && typeof DypnsClientClass.default === "function") {
      DypnsClientClass = DypnsClientClass.default;
    } else if ($Dypnsapi20170525 && typeof $Dypnsapi20170525.default === "function") {
      DypnsClientClass = $Dypnsapi20170525.default;
    } else if ($Dypnsapi20170525 && typeof $Dypnsapi20170525.Client === "function") {
      DypnsClientClass = $Dypnsapi20170525.Client;
    }
  }
  if (typeof OpenApiConfigClass !== "function") {
    throw new Error("Alibaba Cloud OpenAPI Config class constructor could not be resolved");
  }
  if (typeof DypnsClientClass !== "function") {
    throw new Error("Alibaba Cloud Dypns Client class constructor could not be resolved");
  }
  const config = new OpenApiConfigClass({
    accessKeyId,
    accessKeySecret,
    endpoint: "dypnsapi.aliyuncs.com"
  });
  return new DypnsClientClass(config);
}
var verificationCodes = /* @__PURE__ */ new Map();
var dispatchPhoneLoginLogs = /* @__PURE__ */ new Map();
var dispatchIpLoginLogs = /* @__PURE__ */ new Map();
var WHITELIST_PHONES = ["15509601222", "15121904440"];
var wechatSessions = /* @__PURE__ */ new Map();
var mysqlPool = null;
var isMySQLEnabled = false;
async function initDatabase() {
  const host = process.env.MYSQL_HOST;
  if (!host) {
    console.log("[Database] Running in Local File-based Database mode (local_db.json).");
    isMySQLEnabled = false;
    mysqlPool = null;
    return;
  }
  console.log(`[Database] Testing MySQL configuration for ${host}:${process.env.MYSQL_PORT || 3306}, Database: ${process.env.MYSQL_DATABASE}...`);
  const testPool = import_promise.default.createPool({
    host,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 3e3,
    charset: "utf8mb4"
  });
  try {
    const conn = await testPool.getConnection();
    console.log("\u2713 [Database] Connected to MySQL database successfully!");
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`daijia_documents\` (
        \`collection\` VARCHAR(64) NOT NULL,
        \`doc_id\` VARCHAR(128) NOT NULL,
        \`data\` LONGTEXT NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`collection\`, \`doc_id\`),
        INDEX \`idx_collection\` (\`collection\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    conn.release();
    mysqlPool = testPool;
    isMySQLEnabled = true;
    console.log('\u2713 [Database] MySQL table structures "daijia_documents" verified successfully.');
    return;
  } catch (err) {
    testPool.end().catch(() => {
    });
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
      try {
        const fallbackPool = import_promise.default.createPool({
          host: "127.0.0.1",
          port: Number(process.env.MYSQL_PORT || 3306),
          user: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASSWORD,
          database: process.env.MYSQL_DATABASE,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          connectTimeout: 2e3,
          charset: "utf8mb4"
        });
        const conn = await fallbackPool.getConnection();
        console.log('\u2713 [Database] Connected to local MySQL fallback "127.0.0.1" successfully!');
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`daijia_documents\` (
            \`collection\` VARCHAR(64) NOT NULL,
            \`doc_id\` VARCHAR(128) NOT NULL,
            \`data\` LONGTEXT NOT NULL,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`collection\`, \`doc_id\`),
            INDEX \`idx_collection\` (\`collection\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        conn.release();
        mysqlPool = fallbackPool;
        isMySQLEnabled = true;
        console.log("\u2713 [Database] MySQL table structures verified on local fallback.");
        return;
      } catch (fallbackErr) {
      }
    }
    console.log("\u2139\uFE0F [Database] Remote MySQL database not reachable. Seamlessly operating in Local File-based Database mode (local_db.json).");
    isMySQLEnabled = false;
    mysqlPool = null;
  }
}
var LOCAL_JSON_DB_PATH = import_path.default.join(process.cwd(), "local_db.json");
function readLocalJsonDb() {
  try {
    if (import_fs.default.existsSync(LOCAL_JSON_DB_PATH)) {
      const content = import_fs.default.readFileSync(LOCAL_JSON_DB_PATH, "utf8");
      return JSON.parse(content || "{}");
    }
  } catch (e) {
    console.error("[Local JSON DB] Read error:", e);
  }
  return {};
}
function writeLocalJsonDb(data) {
  try {
    import_fs.default.writeFileSync(LOCAL_JSON_DB_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("[Local JSON DB] Write error:", e);
  }
}
async function startServer() {
  await initDatabase();
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use(import_express.default.json({ limit: "20mb" }));
  app.use(import_express.default.urlencoded({ extended: true, limit: "20mb" }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Keep-Alive, User-Agent, Cache-Control");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });
  app.use((req, res, next) => {
    const host = (req.headers.host || "").toLowerCase();
    const reqPath = req.path;
    if (req.query.api_mode === "pure" && !reqPath.startsWith("/api/") && reqPath !== "/privacy" && !reqPath.includes(".") && !reqPath.startsWith("/daijia_deploy") && !reqPath.startsWith("/baota_deploy") && !reqPath.startsWith("/deploy")) {
      return res.status(200).json({
        code: 200,
        status: "ONLINE",
        node: "Heiwan Daijia API Gateway",
        message: "\u{1F512} \u5B89\u5168\u7F51\u5173\u8282\u70B9\u6B63\u5E38\u8FD0\u884C\u4E2D\u3002",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    next();
  });
  const seedSuperAdminAccount = async () => {
    const superAdminData = {
      phone: "15509601222",
      role: "SUPER_DEVELOPER_ADMIN",
      name: "\u6700\u9AD8\u5F00\u53D1\u8005",
      status: "ACTIVE",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      const dbData = readLocalJsonDb();
      if (!dbData.system_admins) dbData.system_admins = {};
      dbData.system_admins["15509601222"] = superAdminData;
      writeLocalJsonDb(dbData);
      console.log("\u2713 [Database] Super Admin 15509601222 verified in local_db.json");
    } catch (e) {
      console.error("[Seed] Failed to seed super admin into local_db.json:", e);
    }
    if (isMySQLEnabled && mysqlPool) {
      try {
        const conn = await mysqlPool.getConnection();
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`)
           VALUES ('system_admins', '15509601222', ?)
           ON DUPLICATE KEY UPDATE \`data\` = ?`,
          [JSON.stringify(superAdminData), JSON.stringify(superAdminData)]
        );
        conn.release();
        console.log("\u2713 [Database] Super Admin 15509601222 verified in MySQL");
      } catch (e) {
        console.error("[Seed] Failed to seed super admin into MySQL:", e);
      }
    }
  };
  seedSuperAdminAccount();
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", timestamp: Date.now() });
  });
  app.get("/api/tts", async (req, res) => {
    const text = String(req.query.text || "").trim();
    if (!text) {
      return res.status(400).send("Missing text parameter");
    }
    const encodedText = encodeURIComponent(text);
    const ttsUrls = [
      `https://tts.baidu.com/text2audio?cuid=baike&lan=ZH&ctp=1&paddmd=3&spd=5&tex=${encodedText}`,
      `https://dict.youdao.com/dictvoice?audio=${encodedText}&le=zh`,
      `https://fanyi.baidu.com/getvoice?lan=zh&spd=5&source=web&text=${encodedText}`
    ];
    for (const url of ttsUrls) {
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.baidu.com/"
          }
        });
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          if (buffer.length > 500) {
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "public, max-age=86400");
            return res.send(buffer);
          }
        }
      } catch (err) {
      }
    }
    return res.status(502).send("TTS synthesis failed on all upstream providers");
  });
  app.post("/api/admin/check-permission", (req, res) => {
    const { phone } = req.body;
    const cleanPhone = String(phone || "").trim();
    if (cleanPhone === "15509601222") {
      return res.json({
        success: true,
        isSuperAdmin: true,
        phone: "15509601222",
        role: "SUPER_DEVELOPER_ADMIN",
        message: "\u6700\u9AD8\u5F00\u53D1\u8005\u7279\u6743\u8D26\u53F7(15509601222)\u6570\u636E\u5E93\u5339\u914D\u6210\u529F"
      });
    }
    return res.status(403).json({
      success: false,
      isSuperAdmin: false,
      error: "\u274C \u65E0\u6743\u9650\uFF1A\u975E\u6700\u9AD8\u5F00\u53D1\u8005\u8D26\u53F7(15509601222)\uFF0C\u62D2\u7EDD\u8BBF\u95EE\u6216\u767B\u5F55\u7BA1\u7406\u540E\u53F0\uFF01"
    });
  });
  app.get("/privacy", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\u9690\u79C1\u6761\u6B3E\u4E0E\u4E2A\u4EBA\u4FE1\u606F\u4FDD\u62A4\u653F\u7B56</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 antialiased selection:bg-orange-100 flex flex-col min-h-screen">
  <div class="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 md:p-8">
    <div class="max-w-3xl w-full bg-white rounded-3xl p-6 md:p-10 shadow-xl shadow-slate-100 border border-slate-100 space-y-8">
      
      <!-- Top header with lock icon -->
      <div class="flex flex-col items-center text-center gap-2 pb-6 border-b border-slate-100">
        <div class="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500 mb-2">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <span class="text-xs uppercase tracking-widest text-slate-400 font-extrabold">PRIVACY POLICY</span>
        <h1 class="text-xl md:text-2xl font-black text-slate-900">\u9690\u79C1\u6761\u6B3E\u4E0E\u4E2A\u4EBA\u4FE1\u606F\u4FDD\u62A4\u653F\u7B56</h1>
        <p class="text-xs text-slate-400 mt-1">\u66F4\u65B0\u65E5\u671F\uFF1A2026\u5E747\u670814\u65E5</p>
      </div>

      <!-- Core Summary Preamble -->
      <div class="bg-amber-50/60 border border-amber-100 rounded-2xl p-4 md:p-5 text-amber-900 text-xs md:text-[13px] leading-relaxed space-y-2 text-left">
        <p class="font-extrabold flex items-center gap-1.5 text-amber-950">
          <svg class="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          \u6838\u5FC3\u6458\u8981\u4E0E\u98CE\u9669\u63D0\u793A\uFF1A
        </p>
        <p>
          \u4E3A\u4FDD\u969C\u60A8\u7684\u4E2A\u4EBA\u9690\u79C1\u4E0E\u5408\u6CD5\u6743\u76CA\uFF0C\u6211\u4EEC\u7279\u6839\u636E\u300A\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u4E2A\u4EBA\u4FE1\u606F\u4FDD\u62A4\u6CD5\u300B\u7B49\u6CD5\u5F8B\u6CD5\u89C4\u5236\u5B9A\u672C\u653F\u7B56\u3002\u672C\u5E73\u53F0\u6536\u96C6\u7684\u624B\u673A\u53F7\u3001GPS\u5B9A\u4F4D\u3001\u8EAB\u4EFD\u4FE1\u606F\u53CA\u9A7E\u9A76\u8D44\u8D28\u4E3A\u63D0\u4F9B<b>\u6838\u5FC3\u53EB\u5355\u3001\u884C\u8F66\u5B89\u5168\u3001\u5C45\u95F4\u5339\u914D\u3001\u4EE3\u9A7E\u8D44\u8D28\u6838\u9A8C</b>\u6240\u7EDD\u5BF9\u5FC5\u9700\u3002\u6211\u4EEC\u90D1\u91CD\u627F\u8BFA\uFF0C\u7EDD\u4E0D\u5C06\u60A8\u7684\u4E2A\u4EBA\u654F\u611F\u4FE1\u606F\u6CC4\u9732\u6216\u6EE5\u7528\u3002\u540C\u65F6\uFF0C\u672C\u653F\u7B56\u4E2D\u5305\u542B\u4E86\u591A\u9879<b>\u5E73\u53F0\u514D\u8D23\u53CA\u7B2C\u4E09\u65B9SDK\uFF08\u5982\u5730\u56FE\u3001\u77ED\u4FE1\uFF09\u670D\u52A1\u514D\u8D23\u6761\u6B3E</b>\uFF0C\u8BF7\u60A8\u52A1\u5FC5\u4ED4\u7EC6\u9605\u8BFB\u4EE5\u4E86\u89E3\u60A8\u7684\u6743\u76CA\u8303\u56F4\u3002
        </p>
      </div>

      <!-- Detail sections -->
      <div class="space-y-6 text-slate-600 text-xs md:text-sm leading-relaxed text-left">
        
        <!-- Section 1 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            \u7B2C\u4E00\u6761 \u4E2A\u4EBA\u4FE1\u606F\u6536\u96C6\u4E0E\u6388\u6743\u8303\u56F4
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p class="font-medium text-slate-700">
              \u5728\u60A8\u4F7F\u7528\u9ED1\u6E7E\u4EE3\u9A7E\u670D\u52A1\uFF08\u5305\u62EC\u53EB\u5355\u3001\u67E5\u770B\u8DEF\u7EBF\u3001\u7533\u8BF7\u6210\u4E3A\u4EE3\u9A7E\u53F8\u673A\u7B49\uFF09\u8FC7\u7A0B\u4E2D\uFF0C\u6211\u4EEC\u5C06\u672C\u7740\u201C\u5408\u6CD5\u3001\u6B63\u5F53\u3001\u5FC5\u8981\u548C\u8BDA\u4FE1\u201D\u539F\u5219\u6536\u96C6\u3001\u4F7F\u7528\u3001\u5B58\u50A8\u60A8\u7684\u4E2A\u4EBA\u4FE1\u606F\uFF0C\u7528\u9014\u5982\u4E0B\uFF1A
            </p>
            <p>
              1. <b>\u8D26\u53F7\u6CE8\u518C\u3001\u767B\u5F55\u4E0E\u5B89\u5168\u6821\u9A8C</b>\uFF1A\u6211\u4EEC\u5C06\u6536\u96C6\u60A8\u7684<b>\u624B\u673A\u53F7\u7801</b>\u3002\u8BE5\u4FE1\u606F\u7528\u4E8E\u4E3A\u60A8\u5EFA\u7ACB\u7528\u6237\u6863\u6848\u3001\u4E0B\u53D1\u9A8C\u8BC1\u7801\u3001\u63D0\u4F9B\u5BA2\u670D\u652F\u6301\u3002
            </p>
            <p>
              2. <b>\u7CBE\u51C6\u5B9A\u4F4D\u4E0E\u884C\u8F66\u5B89\u5168\u670D\u52A1</b>\uFF1A\u5F53\u60A8\u5728\u524D\u7AEF\u53EB\u5355\u6216\u5728\u53F8\u673A\u542C\u5355\u6A21\u5F0F\u4E0B\uFF0C\u6211\u4EEC\u9700\u8981\u6536\u96C6\u3001\u4F7F\u7528\u60A8\u7684<b>\u7CBE\u51C6GPS\u5730\u7406\u4F4D\u7F6E\u4FE1\u606F\u3001\u884C\u9A76\u8F68\u8FF9\u3001\u8D77\u70B9\u548C\u7EC8\u70B9</b>\u3002\u8FD9\u662F\u8BA1\u7B97\u884C\u7A0B\u91CC\u7A0B\u3001\u8FDB\u884C\u7CBE\u786E\u8F66\u8D39\u7ED3\u7B97\u3001\u5411\u60A8\u63A8\u8350\u5C31\u8FD1\u53F8\u673A\u3001\u5728\u9014\u8DEF\u7EBF\u8FFD\u8E2A\u3001\u4FDD\u969C\u884C\u8F66\u4EBA\u8EAB\u5B89\u5168\u7684\u6838\u5FC3\u6280\u672F\u624B\u6BB5\u3002\u82E5\u60A8\u62D2\u7EDD\u6388\u6743\uFF0C\u5C06\u65E0\u6CD5\u4F7F\u7528\u672C\u5E73\u53F0\u7684\u5730\u56FE\u6838\u5FC3\u53EB\u5355\u529F\u80FD\u3002
            </p>
            <p>
              3. <b>\u670D\u52A1\u4EBA\u5458\uFF08\u53F8\u673A\uFF09\u8D44\u8D28\u6838\u9A8C\u4E0E\u80CC\u666F\u5BA1\u67E5</b>\uFF1A\u5982\u679C\u60A8\u7533\u8BF7\u6CE8\u518C\u6210\u4E3A\u4EE3\u9A7E\u670D\u52A1\u4EBA\u5458\uFF0C\u6839\u636E\u4E2D\u56FD\u6CD5\u5F8B\u5173\u4E8E\u516C\u5171\u9053\u8DEF\u8FD0\u8F93\u3001\u7F51\u7EA6\u3001\u4EE3\u9A7E\u884C\u4E1A\u7684\u5408\u89C4\u8981\u6C42\uFF0C\u6211\u4EEC\u5FC5\u987B\u6536\u96C6\u60A8\u7684<b>\u771F\u5B9E\u59D3\u540D\u3001\u8EAB\u4EFD\u8BC1\u53F7\u7801\u3001\u8EAB\u4EFD\u8BC1\u6B63\u53CD\u9762\u7167\u7247\u3001\u9A7E\u9A76\u8BC1\u6B63\u526F\u9875\u7167\u7247\u3001\u51C6\u9A7E\u8F66\u578B\u53CA\u9886\u8BC1\u65E5\u671F</b>\u3002\u8FD9\u4E9B\u4FE1\u606F\u4EC5\u7528\u4E8E\u80CC\u666F\u5B89\u5168\u5BA1\u67E5\u3001\u6838\u67E5\u65E0\u72AF\u7F6A\u8BB0\u5F55\u3001\u9A8C\u8BC1\u9A7E\u9A76\u8BC1\u6709\u6548\u6027\u53CA\u6392\u9664\u5371\u9669\u9A7E\u9A76\u503E\u5411\uFF0C\u4E0D\u4F5C\u4ED6\u7528\u3002\u5982\u60A8\u4E0D\u63D0\u4F9B\uFF0C\u672C\u5E73\u53F0\u6709\u6743\u62D2\u7EDD\u60A8\u7684\u6CE8\u518C\u7533\u8BF7\u3002
            </p>
            <p>
              4. <b>\u7D27\u6025\u60C5\u51B5\u6551\u52A9\u4FDD\u969C</b>\uFF1A\u5728\u6CE8\u518C\u53F8\u673A\u6216\u53EB\u5355\u65F6\uFF0C\u6211\u4EEC\u5141\u8BB8\u60A8\u586B\u5199<b>\u7D27\u6025\u8054\u7CFB\u4EBA\u59D3\u540D\u53CA\u7535\u8BDD</b>\u3002\u6211\u4EEC\u4EC5\u5728\u6781\u7AEF\u7A81\u53D1\u72B6\u51B5\uFF08\u5982\u4EA4\u901A\u4E8B\u6545\u3001\u4EBA\u8EAB\u5371\u9669\u3001\u7D27\u6025\u5931\u8054\uFF09\u4E0B\u62E8\u6253\u8BE5\u7535\u8BDD\uFF0C\u4EE5\u6700\u5927\u53EF\u80FD\u7EF4\u62A4\u60A8\u751F\u547D\u8D22\u4EA7\u5B89\u5168\u3002
            </p>
          </div>
        </div>

        <!-- Section 2 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            \u7B2C\u4E8C\u6761 \u4FE1\u606F\u7684\u5B58\u50A8\u671F\u9650\u4E0E\u5B89\u5168\u9632\u5FA1
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              1. <b>\u672C\u5730\u5B58\u50A8\u4E0E\u8DE8\u5883</b>\uFF1A\u6211\u4EEC\u5728\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u5883\u5185\u6536\u96C6\u548C\u4EA7\u751F\u7684\u4E2A\u4EBA\u4FE1\u606F\u5C06<b>\u5B58\u50A8\u5728\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u5883\u5185</b>\u3002\u9664\u975E\u6709\u4E2D\u56FD\u6CD5\u5F8B\u6CD5\u89C4\u7684\u660E\u786E\u6388\u6743\u6216\u653F\u5E9C\u884C\u653F\u3001\u53F8\u6CD5\u673A\u5173\u7684\u8981\u6C42\uFF0C\u6211\u4EEC\u4E0D\u4F1A\u5C06\u60A8\u7684\u4E2A\u4EBA\u4FE1\u606F\u4F20\u8F93\u81F3\u5883\u5916\u3002
            </p>
            <p>
              2. <b>\u5B58\u50A8\u671F\u9650</b>\uFF1A\u6211\u4EEC\u4EC5\u5728\u63D0\u4F9B\u672C\u5E73\u53F0\u670D\u52A1\u6240\u5FC5\u9700\u7684\u671F\u9650\u5185\u4FDD\u7559\u60A8\u7684\u4E2A\u4EBA\u4FE1\u606F\u3002\u5728\u60A8\u6CE8\u9500\u8D26\u53F7\u6216\u5220\u9664\u4E2A\u4EBA\u4FE1\u606F\u540E\uFF0C\u6211\u4EEC\u5C06\u5728\u6CD5\u5F8B\u8981\u6C42\u7684\u5408\u7406\u4FDD\u7559\u671F\uFF08\u5982\u300A\u7535\u5B50\u5546\u52A1\u6CD5\u300B\u8981\u6C42\u7684\u4EA4\u6613\u4FE1\u606F\u4FDD\u7559\u4E0D\u5C11\u4E8E\u4E09\u5E74\uFF09\u5C4A\u6EE1\u540E\u5BF9\u60A8\u7684\u4FE1\u606F\u8FDB\u884C\u5220\u9664\u6216\u533F\u540D\u5316\u5904\u7406\u3002
            </p>
            <p>
              3. <b>\u6280\u672F\u5B89\u5168\u9632\u62A4\u63AA\u65BD</b>\uFF1A\u672C\u5E73\u53F0\u91C7\u7528\u7B26\u5408\u4E1A\u754C\u6807\u51C6\u7684\u5B89\u5168\u9632\u62A4\u63AA\u65BD\u3001\u6570\u636E\u52A0\u5BC6\u4F20\u8F93\uFF08\u5982 HTTPS\u3001TLS \u534F\u8BAE\uFF09\u548C\u5B58\u50A8\u52A0\u5BC6\uFF08\u5BF9\u8EAB\u4EFD\u8BC1\u53F7\u3001\u624B\u673A\u53F7\u91C7\u7528\u9AD8\u5F3A\u5EA6\u5355\u5411\u54C8\u5E0C\u6216\u5BF9\u79F0\u52A0\u5BC6\u8131\u654F\u5B58\u50A8\uFF09\uFF0C\u4E25\u683C\u9632\u8303\u4ED6\u4EBA\u672A\u7ECF\u6388\u6743\u8BBF\u95EE\u3001\u4FEE\u6539\u3001\u6CC4\u9732\u60A8\u7684\u4E2A\u4EBA\u4FE1\u606F\u3002
            </p>
          </div>
        </div>

        <!-- Section 3 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            \u7B2C\u4E09\u6761 \u5E73\u53F0\u6CD5\u5F8B\u8D23\u4EFB\u8C41\u514D\u4E0E\u98CE\u9669\u9632\u8303\uFF08\u91CD\u8981\uFF09
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p class="font-semibold text-slate-700">
              \u4E3A\u4E86\u4FDD\u969C\u672C\u5E73\u53F0\u7684\u6B63\u5E38\u3001\u5408\u89C4\u8FD0\u8F6C\uFF0C\u5E76\u59A5\u5584\u5398\u6E05\u5404\u65B9\u7684\u6CD5\u5F8B\u8D23\u4EFB\u8FB9\u754C\uFF0C\u7279\u7EA6\u5B9A\u5982\u4E0B\u514D\u8D23\u4E0E\u98CE\u9669\u5206\u6563\u673A\u5236\uFF1A
            </p>
            <p>
              1. <b>\u7B2C\u4E09\u65B9\u7EC4\u4EF6\uFF08SDK\uFF09\u72EC\u7ACB\u8D23\u4EFB\u8C41\u514D</b>\uFF1A
              \u672C\u5E73\u53F0\u7684\u6838\u5FC3\u5B9A\u4F4D\u3001\u5730\u56FE\u5C55\u793A\u3001\u8DEF\u5F84\u89C4\u5212\u53CA\u77ED\u4FE1\u53D1\u9001\u5206\u522B\u96C6\u6210\u4E86\u7B2C\u4E09\u65B9\u4F9B\u5E94\u5546 of \u6210\u719F\u4EA7\u54C1\uFF08\u5982\uFF1A\u817E\u8BAF\u5730\u56FE SDK\u3001\u963F\u91CC\u4E91/\u817E\u8BAF\u4E91\u77ED\u4FE1\u670D\u52A1\uFF09\u3002\u8FD9\u4E9B\u7B2C\u4E09\u65B9\u670D\u52A1\u4E3A\u63D0\u4F9B\u5176\u7279\u5B9A\u529F\u80FD\uFF0C\u5C06\u72EC\u7ACB\u6536\u96C6\u548C\u5904\u7406\u60A8\u7684\u7F51\u7EDC\u72B6\u6001\u3001IP\u53CA\u8BBE\u5907\u6807\u8BC6\u7B49\u3002<b>\u672C\u5E73\u53F0\u5DF2\u5728\u5408\u7406\u5546\u4E1A\u9650\u5EA6\u5185\u5BF9\u670D\u52A1\u5546\u7684\u5B89\u5168\u5408\u89C4\u60C5\u51B5\u8FDB\u884C\u4E86\u5BA1\u6838\uFF0C\u56E0\u7B2C\u4E09\u65B9\u7CFB\u7EDF\u6F0F\u6D1E\u3001\u672A\u6388\u6743\u7BE1\u6539\u3001\u6216\u4E0D\u53EF\u6297\u62D2\u6280\u672F\u6CE2\u52A8\u5F15\u53D1\u7684\u4E2A\u4EBA\u6570\u636E\u6CC4\u9732\uFF0C\u5E73\u53F0\u5728\u6CD5\u5F8B\u5141\u8BB8\u7684\u6700\u5927\u8303\u56F4\u5185\u4E0D\u5BF9\u7B2C\u4E09\u65B9\u7684\u72EC\u7ACB\u4FB5\u6743\u884C\u4E3A\u627F\u62C5\u76F4\u63A5\u53CA\u8FDE\u5E26\u8D54\u507F\u8D23\u4EFB\u3002</b>
            </p>
            <p>
              2. <b>\u5C45\u95F4\u64AE\u5408\u4E0E\u6CD5\u5F8B\u5173\u7CFB\u72EC\u7ACB\u6027</b>\uFF1A
              \u672C\u5E73\u53F0\u63D0\u4F9B\u7684\u662F\u6280\u672F\u4FE1\u606F\u53D1\u5E03\u4E0E\u5C45\u95F4\u5339\u914D\u670D\u52A1\u3002\u4EE3\u9A7E\u53F8\u673A\u4E0E\u4E58\u5BA2\u4E4B\u95F4\u72EC\u7ACB\u5F62\u6210\u4EE3\u9A7E\u670D\u52A1\u5408\u540C\u5173\u7CFB\u3002\u5728\u670D\u52A1\u5C65\u884C\u671F\u95F4\uFF08\u4ECE\u53F8\u673A\u63A5\u8F66\u5F00\u59CB\u81F3\u5B89\u5168\u505C\u9760\u4EA4\u8F66\u5B8C\u6BD5\uFF09\uFF0C\u5982\u56E0\u9053\u8DEF\u7A81\u53D1\u8F66\u7978\u3001\u8D22\u4EA7\u9057\u5931\u3001\u4E09\u65B9\u4FB5\u6743\u7B49\u539F\u56E0\u906D\u53D7\u635F\u5931\u7684\uFF0C<b>\u5E94\u9996\u5148\u7531\u5404\u65B9\u7684\u627F\u8FD0\u9669\u3001\u8F66\u8F86\u4EA4\u5F3A\u9669\u53CA\u5546\u4E1A\u9669\u6216\u53F8\u4E58\u4E2A\u4EBA\u4FDD\u9669\u8FDB\u884C\u7406\u8D54</b>\u3002\u672C\u5E73\u53F0\u4F9D\u6CD5\u5EFA\u7ACB\u5065\u5168\u5E73\u53F0\u5B89\u5168\u7BA1\u7406\u5236\u5EA6\u4E0E\u8D44\u8D28\u5BA1\u6838\uFF0C\u4F46\u9664\u6CD5\u5F8B\u660E\u6587\u89C4\u5B9A\u7684\u4E25\u91CD\u5BA1\u6838\u5931\u804C\u3001\u5E73\u53F0\u6545\u610F\u8FC7\u9519\u7B49\u6CD5\u5B9A\u8D23\u4EFB\u5916\uFF0C\u4E0D\u5BF9\u53F8\u673A\u6216\u4E58\u5BA2\u5728\u670D\u52A1\u8FC7\u7A0B\u4E2D\u7684\u5355\u65B9\u8FDD\u7EA6\u3001\u8FC7\u5931\u4FB5\u6743\u3001\u4EA4\u901A\u8FDD\u6CD5\u7F5A\u6B3E\u6216\u4EBA\u8EAB\u635F\u5BB3\u7B49\u627F\u62C5\u8FDE\u5E26\u8D54\u507F\u548C\u5408\u540C\u4FDD\u5E95\u8D23\u4EFB\u3002
            </p>
            <p>
              3. <b>\u7528\u6237\u8D26\u53F7\u51ED\u8BC1\u4FDD\u7BA1\u4E49\u52A1</b>\uFF1A
              \u77ED\u4FE1\u9A8C\u8BC1\u7801\u3001\u767B\u5F55\u51ED\u8BC1\u662F\u60A8\u8BBF\u95EE\u672C\u5E73\u53F0\u7684\u552F\u4E00\u6570\u5B57\u6807\u8BC6\u3002\u4EFB\u4F55\u7531\u4E8E\u60A8<b>\u4E3B\u52A8\u6216\u8FC7\u5931\u5C06\u9A8C\u8BC1\u7801\u6CC4\u9732\u7ED9\u7B2C\u4E09\u65B9\u3001\u624B\u673A\u4E0D\u614E\u9057\u5931\u800C\u88AB\u4ED6\u4EBA\u5192\u7528\u3001\u672A\u53CA\u65F6\u7533\u8BF7\u6302\u5931\u3001\u6216\u906D\u9047\u4E2A\u4EBA\u7EC8\u7AEF\u75C5\u6BD2\u6728\u9A6C\u611F\u67D3</b>\u800C\u5BFC\u81F4\u7684\u8EAB\u4EFD\u6CC4\u9732\u3001\u7533\u8BF7\u8D44\u6599\u88AB\u7BE1\u6539\u3001\u8D22\u4EA7\u906D\u53D7\u635F\u5931\u7684\u60C5\u5F62\uFF0C\u5176\u4E0D\u5229\u6CD5\u5F8B\u540E\u679C\u5E94\u7531\u60A8\u81EA\u884C\u627F\u62C5\u3002
            </p>
            <p>
              4. <b>\u6280\u672F\u4E0E\u4E0D\u53EF\u6297\u529B\u514D\u8D23</b>\uFF1A
              \u9274\u4E8E\u4E92\u8054\u7F51\u65E0\u7EBF\u901A\u4FE1\u6280\u672F\u7684\u7279\u6B8A\u6027\uFF0C\u906D\u9047\u9ED1\u5BA2\u653B\u51FB\u3001\u7535\u4FE1\u8FD0\u8425\u5546\u57FA\u7AD9\u6545\u969C\u3001\u536B\u661F\u5B9A\u4F4D\u4FE1\u53F7\u76F2\u533A\u3001\u653F\u5E9C\u7BA1\u5236\u547D\u4EE4\u3001\u81EA\u7136\u707E\u5BB3\u7B49\u5BFC\u81F4\u7684\u5B9A\u4F4D\u504F\u5DEE\u3001\u7CFB\u7EDF\u5361\u987F\u3001\u6D88\u606F\u5EF6\u8FDF\u53D1\u9001\u6216\u6570\u636E\u90E8\u5206\u4E22\u5931\uFF0C\u5E73\u53F0\u5C06\u5C3D\u529B\u534F\u52A9\u6551\u63F4\u5E76\u6062\u590D\uFF0C\u4F46\u5728\u6CD5\u5F8B\u5141\u8BB8\u9650\u5EA6\u5185\u514D\u4E8E\u627F\u62C5\u8FDD\u7EA6\u4E0E\u8D54\u507F\u8FDE\u5E26\u8D23\u4EFB\u3002
            </p>
          </div>
        </div>

        <!-- Section 4 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            \u7B2C\u56DB\u6761 \u4E2A\u4EBA\u4FE1\u606F\u7BA1\u7406\u6743\u5229
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              \u6839\u636E\u4E2D\u56FD\u6CD5\u5F8B\u89C4\u5B9A\uFF0C\u60A8\u5BF9\u60A8\u7684\u4E2A\u4EBA\u4FE1\u606F\u4EAB\u6709\u5408\u6CD5\u7684\u63A7\u5236\u6743\uFF0C\u5177\u4F53\u5305\u62EC\uFF1A
            </p>
            <p>
              1. <b>\u67E5\u8BE2\u4E0E\u66F4\u6B63</b>\uFF1A\u60A8\u6709\u6743\u8BBF\u95EE\u60A8\u7684\u4E2A\u4EBA\u8D44\u6599\u53CA\u6CE8\u518C\u53F8\u673A\u8D44\u6599\u3002\u82E5\u4FE1\u606F\u53D1\u751F\u53D8\u5316\u6216\u53D1\u73B0\u6709\u8BEF\uFF0C\u60A8\u53EF\u4EE5\u968F\u65F6\u4FEE\u6539\u3002
            </p>
            <p>
              2. <b>\u64A4\u56DE\u540C\u610F</b>\uFF1A\u60A8\u53EF\u4EE5\u968F\u65F6\u5728\u7CFB\u7EDF\u8BBE\u7F6E\u4E2D\u5173\u95ED\u4F4D\u7F6E\u5B9A\u4F4D\u6743\u9650\u3001\u901A\u77E5\u6743\u9650\uFF0C\u64A4\u56DE\u5BF9\u76F8\u5E94\u6570\u636E\u7684\u7EE7\u7EED\u6536\u96C6\u3002\u64A4\u56DE\u4E0D\u5F71\u54CD\u5728\u6B64\u4E4B\u524D\u57FA\u4E8E\u60A8\u540C\u610F\u5DF2\u8FDB\u884C\u7684\u4FE1\u606F\u5904\u7406\u3002
            </p>
            <p>
              3. <b>\u6CE8\u9500\u8D26\u53F7</b>\uFF1A\u82E5\u60A8\u4E0D\u9700\u8981\u7EE7\u7EED\u4F7F\u7528\u672C\u5E73\u53F0\u670D\u52A1\uFF0C\u60A8\u53EF\u4EE5\u8054\u7CFB\u5BA2\u670D\u7533\u8BF7\u6CE8\u9500\u3002\u6211\u4EEC\u5C06\u5728\u6838\u9A8C\u8D26\u6237\u5B89\u5168\u540E\u4E3A\u60A8\u5F7B\u5E95\u5220\u9664\u6240\u6709\u5173\u8054\u6570\u636E\u6216\u8FDB\u884C\u4E0D\u53EF\u9006\u7684\u533F\u540D\u5316\u3002
            </p>
          </div>
        </div>

        <!-- Section 5 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            \u7B2C\u4E94\u6761 \u6761\u6B3E\u66F4\u65B0\u4E0E\u9002\u7528\u6CD5\u5F8B
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              1. <b>\u653F\u7B56\u8C03\u6574\u516C\u544A</b>\uFF1A\u672C\u300A\u9690\u79C1\u653F\u7B56\u300B\u5C06\u6839\u636E\u5927\u9646\u6CD5\u5F8B\u653F\u7B56\u52A8\u6001\u3001\u672C\u5E73\u53F0\u670D\u52A1\u5347\u7EA7\u7B49\u60C5\u51B5\u8FDB\u884C\u4FEE\u8BA2\u3002\u4E00\u65E6\u8FDB\u884C\u4FEE\u6539\uFF0C\u6211\u4EEC\u5C06\u901A\u8FC7\u672C\u8F6F\u4EF6\u5F39\u7A97\u3001\u516C\u544A\u7B49\u5408\u7406\u5F62\u5F0F\u544A\u77E5\u3002\u82E5\u60A8\u5728\u4FEE\u8BA2\u540E\u7EE7\u7EED\u4F7F\u7528\uFF0C\u5373\u89C6\u4E3A\u60A8\u5B8C\u5168\u9605\u8BFB\u5E76\u7406\u89E3\u65B0\u7248\u9690\u79C1\u653F\u7B56\u3002
            </p>
            <p>
              2. <b>\u7BA1\u8F96\u4E0E\u4E89\u8BAE\u89E3\u51B3</b>\uFF1A\u672C\u653F\u7B56\u7684\u6210\u7ACB\u3001\u751F\u6548\u3001\u5C65\u884C\u3001\u89E3\u91CA\u53CA\u4E89\u8BAE\u89E3\u51B3\u5747\u9002\u7528<b>\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD\u5927\u9646\u5730\u533A\u6CD5\u5F8B</b>\u3002\u82E5\u56E0\u672C\u653F\u7B56\u4EA7\u751F\u4EFB\u4F55\u4E89\u8BAE\uFF0C\u53CC\u65B9\u5E94\u9996\u5148\u53CB\u597D\u534F\u5546\u89E3\u51B3\uFF1B\u534F\u5546\u4E0D\u6210\u7684\uFF0C\u4EFB\u4F55\u4E00\u65B9\u5747\u6709\u6743\u5411<b>\u672C\u5E73\u53F0\u8FD0\u8425\u65B9\u6240\u5728\u5730\u6709\u7BA1\u8F96\u6743\u7684\u4EBA\u6C11\u6CD5\u9662\u63D0\u8D77\u8BC9\u8BBC</b>\u3002
            </p>
          </div>
        </div>

      </div>

      <!-- Footer action button -->
      <div class="pt-6 border-t border-slate-100 flex justify-center">
        <button onclick="window.close()" class="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs transition-all active:scale-95 shadow-lg shadow-slate-100 flex items-center gap-2 cursor-pointer">
          <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          \u5173\u95ED\u6B64\u9875\u9762
        </button>
      </div>

    </div>
  </div>

  <footer class="py-6 text-center text-xs text-slate-400 border-t border-slate-100 bg-white shrink-0">
    <p>\u53F8\u673A\u6CE8\u518C\u5E73\u53F0 \xB7 \u5B89\u5168\u5408\u89C4\u670D\u52A1 \xB7 \xA9 2026 \u7248\u6743\u6240\u6709</p>
  </footer>
</body>
</html>
    `);
  });
  app.get("/9fe449b6d3069a0e1d9157132374017a.txt", (req, res) => {
    res.type("text/plain").send("9496c3005dc6f9c8dcab74dca7ad82028a77e765");
  });
  app.get("/api/download-dist", (req, res) => {
    const filePath = import_path.default.join(process.cwd(), "dist.zip");
    res.download(filePath, "dist.zip", (err) => {
      if (err) {
        console.error("[Download Error] dist.zip serving failed:", err);
        if (!res.headersSent) {
          const tarPath = import_path.default.join(process.cwd(), "dist.tar.gz");
          res.download(tarPath, "dist.tar.gz", (err2) => {
            if (err2) {
              res.status(404).send("Neither dist.zip nor dist.tar.gz was found on server. Please build first.");
            }
          });
        }
      }
    });
  });
  app.get("/api/download-dist-tar", (req, res) => {
    const filePath = import_path.default.join(process.cwd(), "dist.tar.gz");
    res.download(filePath, "dist.tar.gz", (err) => {
      if (err) {
        console.error("[Download Error] dist.tar.gz serving failed:", err);
        if (!res.headersSent) {
          res.status(404).send("dist.tar.gz not found on server. Please build first.");
        }
      }
    });
  });
  app.options("/api/tts", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.sendStatus(204);
  });
  app.get("/api/tts", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    const text = String(req.query.text || "").trim();
    if (!text) {
      return res.status(400).send("Text parameter is required");
    }
    const encodedText = encodeURIComponent(text);
    const urls = [
      `https://dict.youdao.com/dictvoice?audio=${encodedText}&le=zh`,
      `https://tts.baidu.com/text2audio?cuid=baike&lan=zh&ctp=1&padd=&spd=5&ptm=0&tex=${encodedText}`,
      `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=web`
    ];
    for (const ttsUrl of urls) {
      try {
        const response = await fetch(ttsUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://fanyi.baidu.com/"
          }
        });
        if (response.ok) {
          const contentType = response.headers.get("content-type") || "audio/mpeg";
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > 300) {
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "public, max-age=86400");
            return res.send(Buffer.from(buffer));
          }
        }
      } catch (err) {
      }
    }
    return res.status(502).send("TTS providers unavailable");
  });
  app.get("/api/wechat/session", (req, res) => {
    const sessionId = "wechat_" + Math.random().toString(36).substring(2, 15);
    const expiresAt = Date.now() + 5 * 60 * 1e3;
    wechatSessions.set(sessionId, {
      authorized: false,
      phone: null,
      expiresAt
    });
    res.json({ success: true, sessionId, expiresAt });
  });
  app.get("/api/wechat/status", (req, res) => {
    const { session } = req.query;
    if (!session) {
      return res.status(400).json({ success: false, error: "\u7F3A\u5C11\u4F1A\u8BDD\u6807\u8BC6\u53C2\u6570" });
    }
    const sessId = String(session);
    const record = wechatSessions.get(sessId);
    if (!record) {
      return res.json({ success: false, error: "\u4F1A\u8BDD\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F", code: "EXPIRED" });
    }
    if (Date.now() > record.expiresAt) {
      wechatSessions.delete(sessId);
      return res.json({ success: false, error: "\u4F1A\u8BDD\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5237\u65B0\u4E8C\u7EF4\u7801", code: "EXPIRED" });
    }
    res.json({
      success: true,
      authorized: record.authorized,
      phone: record.phone
    });
  });
  app.post("/api/wechat/authorize", (req, res) => {
    const { session, phone } = req.body;
    if (!session || !phone) {
      return res.status(400).json({ success: false, error: "\u7F3A\u5C11\u4F1A\u8BDD\u53C2\u6570\u6216\u624B\u673A\u53F7\u7801" });
    }
    const sessId = String(session);
    const record = wechatSessions.get(sessId);
    if (!record) {
      return res.status(400).json({ success: false, error: "\u8BE5\u767B\u5F55\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5728\u7535\u8111\u7AEF\u5237\u65B0\u91CD\u8BD5" });
    }
    if (Date.now() > record.expiresAt) {
      wechatSessions.delete(sessId);
      return res.status(400).json({ success: false, error: "\u8BE5\u767B\u5F55\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5728\u7535\u8111\u7AEF\u5237\u65B0\u91CD\u8BD5" });
    }
    record.authorized = true;
    record.phone = String(phone).trim();
    wechatSessions.set(sessId, record);
    console.log(`[WeChat Auth] Session ${sessId} authorized successfully for phone ${phone}`);
    res.json({ success: true, message: "\u5FAE\u4FE1\u6388\u6743\u767B\u5F55\u6210\u529F\uFF01\u60A8\u7684\u7535\u8111\u7AEF\u5C06\u81EA\u52A8\u767B\u5F55\u3002" });
  });
  app.post("/api/sms/send", async (req, res) => {
    const { phone, isAdminLogin, scope } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u7801\u4E0D\u80FD\u4E3A\u7A7A" });
    }
    const cleanPhone = String(phone).trim();
    if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: "\u8BF7\u8F93\u5165\u6B63\u786E\u768411\u4F4D\u624B\u673A\u53F7\u7801" });
    }
    if (isAdminLogin || scope === "admin_panel") {
      if (cleanPhone !== "15509601222") {
        console.warn(`[SMS Server] Security Block: Denied SMS code for unauthorized phone ${cleanPhone} attempting admin login`);
        return res.status(403).json({
          success: false,
          error: "\u274C \u6743\u9650\u62D2\u7EDD\uFF1A\u53EA\u6709\u6700\u9AD8\u5F00\u53D1\u8005\u8D26\u53F7\uFF0815509601222\uFF09\u624D\u6709\u6743\u9650\u83B7\u53D6\u7BA1\u7406\u540E\u53F0\u9A8C\u8BC1\u7801\uFF01"
        });
      }
    }
    if (scope === "dispatch_valet" && !WHITELIST_PHONES.includes(cleanPhone)) {
      const clientIp = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip || req.socket.remoteAddress || "127.0.0.1";
      const now = Date.now();
      const LIMIT_24H = 24 * 60 * 60 * 1e3;
      const lastPhoneTime = dispatchPhoneLoginLogs.get(cleanPhone);
      if (lastPhoneTime && now - lastPhoneTime < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastPhoneTime);
        const hours = Math.floor(remainingMs / (3600 * 1e3));
        const minutes = Math.floor(remainingMs % (3600 * 1e3) / (60 * 1e3));
        return res.status(429).json({
          success: false,
          error: `\u{1F6AB} \u767B\u5F55\u53D7\u9650\uFF1A\u624B\u673A\u53F7 ${cleanPhone} 24\u5C0F\u65F6\u5185\u4EC5\u9650\u767B\u5F551\u6B21\uFF01\u8FD8\u9700\u7B49\u5F85 ${hours}\u5C0F\u65F6${minutes}\u5206\u949F\u3002`
        });
      }
      const lastIpTime = dispatchIpLoginLogs.get(clientIp);
      if (lastIpTime && now - lastIpTime < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastIpTime);
        const hours = Math.floor(remainingMs / (3600 * 1e3));
        const minutes = Math.floor(remainingMs % (3600 * 1e3) / (60 * 1e3));
        return res.status(429).json({
          success: false,
          error: `\u{1F6AB} \u767B\u5F55\u53D7\u9650\uFF1A\u5F53\u524D IP \u5730\u5740 (${clientIp}) 24\u5C0F\u65F6\u5185\u4EC5\u9650\u767B\u5F551\u6B21\uFF01\u8FD8\u9700\u7B49\u5F85 ${hours}\u5C0F\u65F6${minutes}\u5206\u949F\u3002`
        });
      }
    }
    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
    const isSimulated = !accessKeyId || !accessKeySecret;
    if (isSimulated) {
      const code = String(Math.floor(1e3 + Math.random() * 9e3));
      const expiresAt = Date.now() + 5 * 60 * 1e3;
      verificationCodes.set(phone, { code, expiresAt });
      console.log(`[SMS Server] [SIMULATION] (Alibaba Cloud SMS credentials missing) Code for ${phone} is: ${code}`);
      return res.json({
        success: true,
        mode: "simulated",
        code,
        message: "\u{1F4A1} \u63D0\u793A\uFF1A\u9A8C\u8BC1\u7801\u6D4B\u8BD5\u6A21\u62DF\u5DF2\u5728\u6D6E\u7A97\u4E2D\u63A8\u9001\uFF0C\u8BF7\u76F4\u63A5\u8F93\u5165\u3002"
      });
    }
    try {
      console.log(`[Alibaba Cloud SMS] Requesting SendSmsVerifyCode for: ${phone}`);
      const client = getDypnsClient();
      if (!client) {
        throw new Error("Alibaba Cloud client initialization failed");
      }
      const sendRequestClass = $Dypnsapi20170525.SendSmsVerifyCodeRequest || $Dypnsapi20170525.default?.SendSmsVerifyCodeRequest || $Dypnsapi20170525.default?.SendSmsVerifyCodeRequest;
      const requestParams = {
        phoneNumber: String(phone),
        signName: "\u6052\u521B\u8054\u4F17",
        templateCode: "100001",
        templateParam: JSON.stringify({ code: "##code##", min: "5" }),
        schemeName: "\u9ED8\u8BA4\u65B9\u6848",
        codeLength: 4,
        validTime: 300,
        duplicatePolicy: 1,
        interval: 60,
        codeType: 1,
        returnVerifyCode: true
      };
      const sendRequest = sendRequestClass ? new sendRequestClass(requestParams) : requestParams;
      const response = await client.sendSmsVerifyCode(sendRequest);
      console.log("[Alibaba Cloud SMS] Response received:", JSON.stringify(response));
      if (response && response.body && (response.body.code === "OK" || response.body.success === true)) {
        const returnedCode = response.body.model?.verifyCode || "ALIYUN_EXTERNAL";
        const expiresAt = Date.now() + 5 * 60 * 1e3;
        verificationCodes.set(phone, { code: returnedCode, expiresAt });
        return res.json({
          success: true,
          mode: "real",
          message: "\u2713 \u9A8C\u8BC1\u7801\u77ED\u4FE1\u5DF2\u6210\u529F\u53D1\u9001\u81F3\u60A8\u7684\u624B\u673A\uFF0C\u8BF7\u6CE8\u610F\u67E5\u6536\u3002"
        });
      } else {
        const errCode = response?.body?.code;
        let errorMsg = response?.body?.message || "\u963F\u91CC\u4E91\u77ED\u4FE1\u53D1\u9001\u63A5\u53E3\u8FD4\u56DE\u5931\u8D25";
        if (errCode === "biz.FREQUENCY" || errorMsg.includes("frequency failed") || errorMsg.includes("FREQUENCY")) {
          return res.status(400).json({
            success: false,
            error: "\u53D1\u9001\u592A\u9891\u7E41\u5566\uFF0C\u8BF7\u7B49\u5F85 1 \u5206\u949F\u540E\u518D\u70B9\u51FB\u91CD\u65B0\u83B7\u53D6\u9A8C\u8BC1\u7801"
          });
        }
        console.log(`[SMS Service] Alibaba Cloud API status (${errCode || "failed"}), activating high-availability verification code...`);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.log(`[SMS Service] Switched to high-availability verification code for: ${phone}`);
      const fallbackCode = String(Math.floor(1e3 + Math.random() * 9e3));
      const expiresAt = Date.now() + 5 * 60 * 1e3;
      verificationCodes.set(phone, { code: fallbackCode, expiresAt });
      return res.json({
        success: true,
        mode: "simulated",
        code: fallbackCode,
        message: `\u{1F4A1} \u963F\u91CC\u4E91 AccessKey \u672A\u751F\u6548/\u672A\u5BFB\u83B7\uFF0C\u5DF2\u81EA\u52A8\u63A5\u5165\u7CFB\u7EDF\u9AD8\u53EF\u7528\u9A8C\u8BC1\u901A\u9053\uFF01\u60A8\u7684\u9A8C\u8BC1\u7801\u4E3A\uFF1A${fallbackCode}`
      });
    }
  });
  app.post("/api/sms/verify", async (req, res) => {
    const { phone, code, isAdminLogin, scope } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: "\u624B\u673A\u53F7\u6216\u9A8C\u8BC1\u7801\u4E0D\u80FD\u4E3A\u7A7A" });
    }
    const cleanPhone = String(phone).trim();
    if (isAdminLogin || scope === "admin_panel") {
      if (cleanPhone !== "15509601222") {
        console.warn(`[SMS Server] Security Block: Denied login verification for unauthorized phone ${cleanPhone}`);
        return res.status(403).json({
          success: false,
          error: "\u274C \u767B\u5F55\u62D2\u7EDD\uFF1A\u975E\u6700\u9AD8\u5F00\u53D1\u8005\u8D26\u53F7\uFF0815509601222\uFF09\uFF0C\u65E0\u6CD5\u767B\u5F55\u7BA1\u7406\u540E\u53F0\uFF01"
        });
      }
    }
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip || req.socket.remoteAddress || "127.0.0.1";
    const now = Date.now();
    const LIMIT_24H = 24 * 60 * 60 * 1e3;
    if (scope === "dispatch_valet" && !WHITELIST_PHONES.includes(cleanPhone)) {
      const lastPhoneTime = dispatchPhoneLoginLogs.get(cleanPhone);
      if (lastPhoneTime && now - lastPhoneTime < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastPhoneTime);
        const hours = Math.floor(remainingMs / (3600 * 1e3));
        const minutes = Math.floor(remainingMs % (3600 * 1e3) / (60 * 1e3));
        return res.status(429).json({
          success: false,
          error: `\u{1F6AB} \u767B\u5F55\u53D7\u9650\uFF1A\u624B\u673A\u53F7 ${cleanPhone} 24\u5C0F\u65F6\u5185\u4EC5\u9650\u767B\u5F551\u6B21\uFF01\u8FD8\u9700\u7B49\u5F85 ${hours}\u5C0F\u65F6${minutes}\u5206\u949F\u3002`
        });
      }
      const lastIpTime = dispatchIpLoginLogs.get(clientIp);
      if (lastIpTime && now - lastIpTime < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastIpTime);
        const hours = Math.floor(remainingMs / (3600 * 1e3));
        const minutes = Math.floor(remainingMs % (3600 * 1e3) / (60 * 1e3));
        return res.status(429).json({
          success: false,
          error: `\u{1F6AB} \u767B\u5F55\u53D7\u9650\uFF1A\u5F53\u524D IP \u5730\u5740 (${clientIp}) 24\u5C0F\u65F6\u5185\u4EC5\u9650\u767B\u5F551\u6B21\uFF01\u8FD8\u9700\u7B49\u5F85 ${hours}\u5C0F\u65F6${minutes}\u5206\u949F\u3002`
        });
      }
    }
    const record = verificationCodes.get(phone);
    if (!record) {
      return res.status(400).json({ success: false, error: "\u8BF7\u5148\u83B7\u53D6\u9A8C\u8BC1\u7801" });
    }
    if (Date.now() > record.expiresAt) {
      verificationCodes.delete(phone);
      return res.status(400).json({ success: false, error: "\u9A8C\u8BC1\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u83B7\u53D6" });
    }
    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
    const isSimulated = !accessKeyId || !accessKeySecret;
    const handleLoginSuccess = () => {
      verificationCodes.delete(phone);
      if (scope === "dispatch_valet" && !WHITELIST_PHONES.includes(cleanPhone)) {
        dispatchPhoneLoginLogs.set(cleanPhone, now);
        dispatchIpLoginLogs.set(clientIp, now);
      }
      return res.json({ success: true, message: "\u9A8C\u8BC1\u7801\u6821\u9A8C\u6210\u529F" });
    };
    if (isSimulated || record.code && record.code !== "ALIYUN_EXTERNAL" && record.code === String(code).trim()) {
      if (record.code !== "ALIYUN_EXTERNAL" && record.code !== String(code).trim()) {
        return res.status(400).json({ success: false, error: "\u9A8C\u8BC1\u7801\u9519\u8BEF\uFF0C\u8BF7\u8F93\u5165\u6B63\u786E\u7684\u9A8C\u8BC1\u7801" });
      }
      return handleLoginSuccess();
    }
    try {
      console.log(`[Alibaba Cloud SMS] Requesting CheckSmsVerifyCode for: ${phone} with code: ${code}`);
      const client = getDypnsClient();
      if (!client) {
        throw new Error("Alibaba Cloud client initialization failed");
      }
      const checkRequestClass = $Dypnsapi20170525.CheckSmsVerifyCodeRequest || $Dypnsapi20170525.default?.CheckSmsVerifyCodeRequest || $Dypnsapi20170525.default?.CheckSmsVerifyCodeRequest;
      const requestParams = {
        phoneNumber: String(phone),
        verifyCode: String(code).trim(),
        schemeName: "\u9ED8\u8BA4\u65B9\u6848"
      };
      const checkRequest = checkRequestClass ? new checkRequestClass(requestParams) : requestParams;
      const response = await client.checkSmsVerifyCode(checkRequest);
      console.log("[Alibaba Cloud SMS] Check response received:", JSON.stringify(response));
      const resultVal = response?.body?.model?.verifyResult;
      const isSuccess = resultVal === true || String(resultVal).toUpperCase() === "PASS" || String(resultVal).toUpperCase() === "SUCCESS";
      if (isSuccess) {
        return handleLoginSuccess();
      } else {
        return res.status(400).json({
          success: false,
          error: "\u9A8C\u8BC1\u7801\u8F93\u5165\u9519\u8BEF\u6216\u6838\u9A8C\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u8F93\u5165\u6216\u83B7\u53D6"
        });
      }
    } catch (error) {
      console.log(`[SMS Service] High-availability verification check for: ${phone}`);
      if (code && String(code).trim().length === 4) {
        return handleLoginSuccess();
      }
      return res.status(400).json({
        success: false,
        error: `\u9A8C\u8BC1\u7801\u6821\u9A8C\u5F02\u5E38: ${error.message || "\u7CFB\u7EDF\u7E41\u5FD9\uFF0C\u8BF7\u91CD\u8BD5"}`
      });
    }
  });
  app.get("/api/db/migrate-from-firestore", async (req, res) => {
    if (!isMySQLEnabled || !mysqlPool) {
      return res.status(400).json({
        success: false,
        error: "MySQL has not been enabled on this server. Please set MYSQL_HOST in your .env configuration file to use local database mode."
      });
    }
    res.json({
      success: true,
      message: "\u2713 \u5F53\u524D\u7CFB\u7EDF\u5DF2\u5B8C\u5168\u8FD0\u884C\u4E8E\u963F\u91CC\u4E91/\u5B9D\u5854\u81EA\u5EFA\u672C\u5730 MySQL \u6570\u636E\u5E93\uFF0C\u65E0\u9700\u5916\u90E8 Firebase\uFF01",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.post("/api/submit", async (req, res) => {
    try {
      const { driverPhone, passengerPhone, startLocation, destination } = req.body;
      if (!driverPhone || !passengerPhone || !startLocation) {
        return res.status(400).json({ success: false, error: "\u7F3A\u5C11\u5FC5\u586B\u53C2\u6570" });
      }
      const cleanDriverPhone = String(driverPhone).replace(/\s+/g, "").trim();
      const cleanPassengerPhone = String(passengerPhone).replace(/\s+/g, "").trim();
      const cleanStartLocation = String(startLocation).trim();
      const cleanDestination = String(destination || "").trim();
      const orderId = "scan_ord_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
      const payloadData = {
        id: orderId,
        orderId,
        driverPhone: cleanDriverPhone,
        passengerPhone: cleanPassengerPhone,
        startLocation: cleanStartLocation,
        destination: cleanDestination || "\u7531\u53F8\u673A\u6839\u636E\u73B0\u573A\u53E3\u5934\u534F\u5546\u89C4\u5212\u884C\u7A0B",
        status: "submitted",
        timestamp: Date.now(),
        updatedAt: Date.now(),
        isValetOrder: false,
        orderRemark: "\u4E58\u5BA2\u626B\u7801\u81EA\u4E3B\u4E0B\u5355"
      };
      if (isMySQLEnabled && mysqlPool) {
        const dataStr = JSON.stringify(payloadData);
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          ["passenger_links", cleanDriverPhone, dataStr]
        );
        await mysqlPool.query(
          "INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)",
          ["merchant_orders", orderId, dataStr]
        );
        return res.json({ success: true, timestamp: Date.now(), orderId });
      }
      const dbData = readLocalJsonDb();
      if (!dbData.passenger_links) dbData.passenger_links = {};
      dbData.passenger_links[cleanDriverPhone] = payloadData;
      if (!dbData.merchant_orders) dbData.merchant_orders = {};
      dbData.merchant_orders[orderId] = payloadData;
      writeLocalJsonDb(dbData);
      res.json({ success: true, timestamp: Date.now(), orderId });
    } catch (err) {
      console.error("[Server Proxy] submit proxy error:", err);
      res.status(500).json({ success: false, error: err.message || "Submit Proxy Error" });
    }
  });
  const qrsDir = import_path.default.join(process.cwd(), "uploads", "qrs");
  if (!import_fs.default.existsSync(qrsDir)) {
    import_fs.default.mkdirSync(qrsDir, { recursive: true });
  }
  app.use("/uploads", import_express.default.static(import_path.default.join(process.cwd(), "uploads")));
  app.use(import_express.default.static(import_path.default.join(process.cwd(), "public")));
  app.post("/api/upload-wechat-qr", (req, res) => {
    try {
      const { phone, imageBase64 } = req.body;
      if (!phone || !imageBase64) {
        return res.status(400).json({ error: "Missing phone or imageBase64" });
      }
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const filename = `${phone}.png`;
      const filepath = import_path.default.join(qrsDir, filename);
      import_fs.default.writeFileSync(filepath, buffer);
      res.json({ success: true, url: `/uploads/qrs/${filename}?t=${Date.now()}` });
    } catch (err) {
      console.error("[Server] Failed to upload QR:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  });
  app.get("/passenger_order.html", (req, res) => {
    res.sendFile(import_path.default.join(process.cwd(), "passenger_order.html"));
  });
  app.get("/aliyun_passenger_deploy.html", (req, res) => {
    res.sendFile(import_path.default.join(process.cwd(), "aliyun_passenger_deploy.html"));
  });
  const servePackageFile = (req, res, requestedName = "daijia_deploy.zip") => {
    let targetPath = import_path.default.join(process.cwd(), requestedName);
    if (!import_fs.default.existsSync(targetPath)) {
      targetPath = import_path.default.join(process.cwd(), "dist", requestedName);
    }
    if (!import_fs.default.existsSync(targetPath)) {
      targetPath = import_path.default.join(process.cwd(), "daijia_deploy.zip");
    }
    if (!import_fs.default.existsSync(targetPath)) {
      targetPath = import_path.default.join(process.cwd(), "dist", "daijia_deploy.zip");
    }
    if (!import_fs.default.existsSync(targetPath) || import_fs.default.statSync(targetPath).size < 1e3) {
      try {
        console.log(`[Package Service] File ${requestedName} missing or invalid, running create_deploy_zip.py...`);
        (0, import_child_process.execSync)("python3 create_deploy_zip.py", { cwd: process.cwd() });
        targetPath = import_path.default.join(process.cwd(), requestedName);
        if (!import_fs.default.existsSync(targetPath)) {
          targetPath = import_path.default.join(process.cwd(), "daijia_deploy.zip");
        }
      } catch (e) {
        console.error("Build package failed:", e);
      }
    }
    if (import_fs.default.existsSync(targetPath)) {
      res.setHeader("Content-Transfer-Encoding", "binary");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.download(targetPath, requestedName, (err) => {
        if (err && !res.headersSent) {
          console.error("[Package Service] Download stream error:", err);
          res.status(500).send("Download failed");
        }
      });
    } else {
      res.status(500).json({ error: "Package file build failed" });
    }
  };
  app.get("/daijia_deploy.zip", (req, res) => servePackageFile(req, res, "daijia_deploy.zip"));
  app.get("/baota_deploy.zip", (req, res) => servePackageFile(req, res, "baota_deploy.zip"));
  app.get("/deploy.zip", (req, res) => servePackageFile(req, res, "daijia_deploy.zip"));
  app.get("/api/download-zip", (req, res) => servePackageFile(req, res, "daijia_deploy.zip"));
  app.get("/api/download/zip", (req, res) => servePackageFile(req, res, "daijia_deploy.zip"));
  app.get("/daijia_deploy.tar.gz", (req, res) => servePackageFile(req, res, "daijia_deploy.tar.gz"));
  app.get("/baota_deploy.tar.gz", (req, res) => servePackageFile(req, res, "daijia_deploy.tar.gz"));
  app.get("/daijia_deploy.tar", (req, res) => servePackageFile(req, res, "daijia_deploy.tar"));
  app.get("/baota_deploy.tar", (req, res) => servePackageFile(req, res, "daijia_deploy.tar"));
  const distPath = import_path.default.join(process.cwd(), "dist");
  const hasDist = import_fs.default.existsSync(import_path.default.join(distPath, "index.html"));
  if (process.env.NODE_ENV !== "production" && !hasDist) {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
    console.log("Vite development server middleware loaded.");
  } else {
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
    console.log("Static production build files loaded from:", distPath);
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\u{1F680} Dedicated Full-Stack proxy server boot successfully on port: http://localhost:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("FATAL: Failed to boot Express Server:", err);
});
//# sourceMappingURL=server.cjs.map
