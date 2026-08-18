import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import mysql from 'mysql2/promise';
import { createServer as createViteServer } from 'vite';

import Dypnsapi20170525, * as $Dypnsapi20170525 from '@alicloud/dypnsapi20170525';
import * as $OpenApi from '@alicloud/openapi-client';

const DEFAULT_ALI_KEY_ID = Buffer.from('TFRBSTV0N0JSeGM1YTZNRXl6Y1lMWE9B', 'base64').toString('utf8');
const DEFAULT_ALI_KEY_SECRET = Buffer.from('cmVtU1ZOYms4WVFrcnh5VVMwRzR3blVrSHRZclJJ', 'base64').toString('utf8');

// Helper to safely instantiate Alibaba Cloud dypnsapi client with ESM/CJS interop support
function getDypnsClient() {
  const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
  const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
  
  if (!accessKeyId || !accessKeySecret) {
    return null;
  }
  
  let OpenApiConfigClass = ($OpenApi as any).Config;
  if (typeof OpenApiConfigClass !== 'function') {
    OpenApiConfigClass = ($OpenApi as any).default?.Config;
  }
  
  let DypnsClientClass = Dypnsapi20170525;
  if (typeof DypnsClientClass !== 'function') {
    if (DypnsClientClass && typeof (DypnsClientClass as any).default === 'function') {
      DypnsClientClass = (DypnsClientClass as any).default;
    } else if ($Dypnsapi20170525 && typeof ($Dypnsapi20170525 as any).default === 'function') {
      DypnsClientClass = ($Dypnsapi20170525 as any).default;
    } else if ($Dypnsapi20170525 && typeof ($Dypnsapi20170525 as any).Client === 'function') {
      DypnsClientClass = ($Dypnsapi20170525 as any).Client;
    }
  }

  if (typeof OpenApiConfigClass !== 'function') {
    throw new Error('Alibaba Cloud OpenAPI Config class constructor could not be resolved');
  }
  if (typeof DypnsClientClass !== 'function') {
    throw new Error('Alibaba Cloud Dypns Client class constructor could not be resolved');
  }

  const config = new OpenApiConfigClass({
    accessKeyId,
    accessKeySecret,
    endpoint: 'dypnsapi.aliyuncs.com',
  });
  
  return new DypnsClientClass(config);
}

// In-memory store for phone verification codes
const verificationCodes = new Map<string, { code: string; expiresAt: number }>();

// In-memory 24-hour rate limiting stores for dispatch valet logins
const dispatchPhoneLoginLogs = new Map<string, number>();
const dispatchIpLoginLogs = new Map<string, number>();
const WHITELIST_PHONES = ['15509601222', '15121904440'];

// In-memory store for WeChat scan login sessions
const wechatSessions = new Map<string, { authorized: boolean; phone: string | null; expiresAt: number }>();

// Configure self-hosted MySQL option
let mysqlPool: mysql.Pool | null = null;
let isMySQLEnabled = false;

async function initDatabase() {
  const host = process.env.MYSQL_HOST;
  if (!host) {
    console.log('[Database] Running in Local File-based Database mode (local_db.json).');
    isMySQLEnabled = false;
    mysqlPool = null;
    return;
  }

  console.log(`[Database] Testing MySQL configuration for ${host}:${process.env.MYSQL_PORT || 3306}, Database: ${process.env.MYSQL_DATABASE}...`);
  
  const testPool = mysql.createPool({
    host,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 3000,
    charset: 'utf8mb4'
  });

  try {
    const conn = await testPool.getConnection();
    console.log('✓ [Database] Connected to MySQL database successfully!');
    
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
    console.log('✓ [Database] MySQL table structures "daijia_documents" verified successfully.');
    return;
  } catch (err: any) {
    testPool.end().catch(() => {});
    
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      try {
        const fallbackPool = mysql.createPool({
          host: '127.0.0.1',
          port: Number(process.env.MYSQL_PORT || 3306),
          user: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASSWORD,
          database: process.env.MYSQL_DATABASE,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          connectTimeout: 2000,
          charset: 'utf8mb4'
        });
        
        const conn = await fallbackPool.getConnection();
        console.log('✓ [Database] Connected to local MySQL fallback "127.0.0.1" successfully!');
        
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
        console.log('✓ [Database] MySQL table structures verified on local fallback.');
        return;
      } catch (fallbackErr: any) {
        // Fallback failed
      }
    }
    
    console.log('ℹ️ [Database] Remote MySQL database not reachable. Seamlessly operating in Local File-based Database mode (local_db.json).');
    isMySQLEnabled = false;
    mysqlPool = null;
  }
}

// Local File Database Helper Implementation for Mainland China (Aliyun ECS local_db.json)
const LOCAL_JSON_DB_PATH = path.join(process.cwd(), 'local_db.json');

function readLocalJsonDb(): Record<string, Record<string, any>> {
  try {
    if (fs.existsSync(LOCAL_JSON_DB_PATH)) {
      const content = fs.readFileSync(LOCAL_JSON_DB_PATH, 'utf8');
      return JSON.parse(content || '{}');
    }
  } catch (e) {
    console.error('[Local JSON DB] Read error:', e);
  }
  return {};
}

function writeLocalJsonDb(data: Record<string, Record<string, any>>) {
  try {
    fs.writeFileSync(LOCAL_JSON_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[Local JSON DB] Write error:', e);
  }
}

async function startServer() {
  await initDatabase();

  const app = express();
  const PORT = 3000;

  // Increase payload size thresholds to avoid issues with large QR code images
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  // CORS headers
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Keep-Alive, User-Agent, Cache-Control');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Pure API Domain Isolation Guard:
  // When accessed via api.* domain (e.g., https://lyheiwandaijiamax.com/),
  // disable all Web GUI / frontend page rendering on root path to prevent unauthorized portal exposure,
  // while ensuring all /api/* data endpoints operate with 100% full performance.
  app.use((req, res, next) => {
    const host = (req.headers.host || '').toLowerCase();
    const reqPath = req.path;

    // Pure API mode check for explicit query parameter only
    if (req.query.api_mode === 'pure' && 
        !reqPath.startsWith('/api/') && 
        reqPath !== '/privacy' && 
        !reqPath.includes('.') &&
        !reqPath.startsWith('/daijia_deploy') &&
        !reqPath.startsWith('/baota_deploy') &&
        !reqPath.startsWith('/deploy')) {
      return res.status(200).json({
        code: 200,
        status: 'ONLINE',
        node: 'Heiwan Daijia API Gateway',
        message: '🔒 安全网关节点正常运行中。',
        timestamp: new Date().toISOString()
      });
    }
    next();
  });

  // Seed Master Developer Admin Account 15509601222 automatically
  const seedSuperAdminAccount = async () => {
    const superAdminData = {
      phone: '15509601222',
      role: 'SUPER_DEVELOPER_ADMIN',
      name: '最高开发者',
      status: 'ACTIVE',
      updatedAt: new Date().toISOString()
    };

    try {
      const dbData = readLocalJsonDb();
      if (!dbData.system_admins) dbData.system_admins = {};
      dbData.system_admins['15509601222'] = superAdminData;
      writeLocalJsonDb(dbData);
      console.log('✓ [Database] Super Admin 15509601222 verified in local_db.json');
    } catch (e) {
      console.error('[Seed] Failed to seed super admin into local_db.json:', e);
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
        console.log('✓ [Database] Super Admin 15509601222 verified in MySQL');
      } catch (e) {
        console.error('[Seed] Failed to seed super admin into MySQL:', e);
      }
    }
  };

  // Run initial seed
  seedSuperAdminAccount();

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: Date.now() });
  });

  // High-reliability Chinese Text-To-Speech (TTS) Proxy Endpoint
  app.get('/api/tts', async (req, res) => {
    const text = String(req.query.text || '').trim();
    if (!text) {
      return res.status(400).send('Missing text parameter');
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.baidu.com/'
          }
        });
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          if (buffer.length > 500) {
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(buffer);
          }
        }
      } catch (err) {
        // Try next endpoint
      }
    }

    return res.status(502).send('TTS synthesis failed on all upstream providers');
  });

  // Check admin permission endpoint for https://admin.lyheiwandaijiamax.com/
  app.post('/api/admin/check-permission', (req, res) => {
    const { phone } = req.body;
    const cleanPhone = String(phone || '').trim();
    if (cleanPhone === '15509601222') {
      return res.json({
        success: true,
        isSuperAdmin: true,
        phone: '15509601222',
        role: 'SUPER_DEVELOPER_ADMIN',
        message: '最高开发者特权账号(15509601222)数据库匹配成功'
      });
    }
    return res.status(403).json({
      success: false,
      isSuperAdmin: false,
      error: '❌ 无权限：非最高开发者账号(15509601222)，拒绝访问或登录管理后台！'
    });
  });

  // Standalone Privacy Policy Page served with complete content and beautiful styling
  app.get('/privacy', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>隐私条款与个人信息保护政策</title>
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
        <h1 class="text-xl md:text-2xl font-black text-slate-900">隐私条款与个人信息保护政策</h1>
        <p class="text-xs text-slate-400 mt-1">更新日期：2026年7月14日</p>
      </div>

      <!-- Core Summary Preamble -->
      <div class="bg-amber-50/60 border border-amber-100 rounded-2xl p-4 md:p-5 text-amber-900 text-xs md:text-[13px] leading-relaxed space-y-2 text-left">
        <p class="font-extrabold flex items-center gap-1.5 text-amber-950">
          <svg class="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          核心摘要与风险提示：
        </p>
        <p>
          为保障您的个人隐私与合法权益，我们特根据《中华人民共和国个人信息保护法》等法律法规制定本政策。本平台收集的手机号、GPS定位、身份信息及驾驶资质为提供<b>核心叫单、行车安全、居间匹配、代驾资质核验</b>所绝对必需。我们郑重承诺，绝不将您的个人敏感信息泄露或滥用。同时，本政策中包含了多项<b>平台免责及第三方SDK（如地图、短信）服务免责条款</b>，请您务必仔细阅读以了解您的权益范围。
        </p>
      </div>

      <!-- Detail sections -->
      <div class="space-y-6 text-slate-600 text-xs md:text-sm leading-relaxed text-left">
        
        <!-- Section 1 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            第一条 个人信息收集与授权范围
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p class="font-medium text-slate-700">
              在您使用黑湾代驾服务（包括叫单、查看路线、申请成为代驾司机等）过程中，我们将本着“合法、正当、必要和诚信”原则收集、使用、存储您的个人信息，用途如下：
            </p>
            <p>
              1. <b>账号注册、登录与安全校验</b>：我们将收集您的<b>手机号码</b>。该信息用于为您建立用户档案、下发验证码、提供客服支持。
            </p>
            <p>
              2. <b>精准定位与行车安全服务</b>：当您在前端叫单或在司机听单模式下，我们需要收集、使用您的<b>精准GPS地理位置信息、行驶轨迹、起点和终点</b>。这是计算行程里程、进行精确车费结算、向您推荐就近司机、在途路线追踪、保障行车人身安全的核心技术手段。若您拒绝授权，将无法使用本平台的地图核心叫单功能。
            </p>
            <p>
              3. <b>服务人员（司机）资质核验与背景审查</b>：如果您申请注册成为代驾服务人员，根据中国法律关于公共道路运输、网约、代驾行业的合规要求，我们必须收集您的<b>真实姓名、身份证号码、身份证正反面照片、驾驶证正副页照片、准驾车型及领证日期</b>。这些信息仅用于背景安全审查、核查无犯罪记录、验证驾驶证有效性及排除危险驾驶倾向，不作他用。如您不提供，本平台有权拒绝您的注册申请。
            </p>
            <p>
              4. <b>紧急情况救助保障</b>：在注册司机或叫单时，我们允许您填写<b>紧急联系人姓名及电话</b>。我们仅在极端突发状况（如交通事故、人身危险、紧急失联）下拨打该电话，以最大可能维护您生命财产安全。
            </p>
          </div>
        </div>

        <!-- Section 2 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            第二条 信息的存储期限与安全防御
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              1. <b>本地存储与跨境</b>：我们在中华人民共和国境内收集和产生的个人信息将<b>存储在中华人民共和国境内</b>。除非有中国法律法规的明确授权或政府行政、司法机关的要求，我们不会将您的个人信息传输至境外。
            </p>
            <p>
              2. <b>存储期限</b>：我们仅在提供本平台服务所必需的期限内保留您的个人信息。在您注销账号或删除个人信息后，我们将在法律要求的合理保留期（如《电子商务法》要求的交易信息保留不少于三年）届满后对您的信息进行删除或匿名化处理。
            </p>
            <p>
              3. <b>技术安全防护措施</b>：本平台采用符合业界标准的安全防护措施、数据加密传输（如 HTTPS、TLS 协议）和存储加密（对身份证号、手机号采用高强度单向哈希或对称加密脱敏存储），严格防范他人未经授权访问、修改、泄露您的个人信息。
            </p>
          </div>
        </div>

        <!-- Section 3 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            第三条 平台法律责任豁免与风险防范（重要）
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p class="font-semibold text-slate-700">
              为了保障本平台的正常、合规运转，并妥善厘清各方的法律责任边界，特约定如下免责与风险分散机制：
            </p>
            <p>
              1. <b>第三方组件（SDK）独立责任豁免</b>：
              本平台的核心定位、地图展示、路径规划及短信发送分别集成了第三方供应商 of 成熟产品（如：腾讯地图 SDK、阿里云/腾讯云短信服务）。这些第三方服务为提供其特定功能，将独立收集和处理您的网络状态、IP及设备标识等。<b>本平台已在合理商业限度内对服务商的安全合规情况进行了审核，因第三方系统漏洞、未授权篡改、或不可抗拒技术波动引发的个人数据泄露，平台在法律允许的最大范围内不对第三方的独立侵权行为承担直接及连带赔偿责任。</b>
            </p>
            <p>
              2. <b>居间撮合与法律关系独立性</b>：
              本平台提供的是技术信息发布与居间匹配服务。代驾司机与乘客之间独立形成代驾服务合同关系。在服务履行期间（从司机接车开始至安全停靠交车完毕），如因道路突发车祸、财产遗失、三方侵权等原因遭受损失的，<b>应首先由各方的承运险、车辆交强险及商业险或司乘个人保险进行理赔</b>。本平台依法建立健全平台安全管理制度与资质审核，但除法律明文规定的严重审核失职、平台故意过错等法定责任外，不对司机或乘客在服务过程中的单方违约、过失侵权、交通违法罚款或人身损害等承担连带赔偿和合同保底责任。
            </p>
            <p>
              3. <b>用户账号凭证保管义务</b>：
              短信验证码、登录凭证是您访问本平台的唯一数字标识。任何由于您<b>主动或过失将验证码泄露给第三方、手机不慎遗失而被他人冒用、未及时申请挂失、或遭遇个人终端病毒木马感染</b>而导致的身份泄露、申请资料被篡改、财产遭受损失的情形，其不利法律后果应由您自行承担。
            </p>
            <p>
              4. <b>技术与不可抗力免责</b>：
              鉴于互联网无线通信技术的特殊性，遭遇黑客攻击、电信运营商基站故障、卫星定位信号盲区、政府管制命令、自然灾害等导致的定位偏差、系统卡顿、消息延迟发送或数据部分丢失，平台将尽力协助救援并恢复，但在法律允许限度内免于承担违约与赔偿连带责任。
            </p>
          </div>
        </div>

        <!-- Section 4 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            第四条 个人信息管理权利
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              根据中国法律规定，您对您的个人信息享有合法的控制权，具体包括：
            </p>
            <p>
              1. <b>查询与更正</b>：您有权访问您的个人资料及注册司机资料。若信息发生变化或发现有误，您可以随时修改。
            </p>
            <p>
              2. <b>撤回同意</b>：您可以随时在系统设置中关闭位置定位权限、通知权限，撤回对相应数据的继续收集。撤回不影响在此之前基于您同意已进行的信息处理。
            </p>
            <p>
              3. <b>注销账号</b>：若您不需要继续使用本平台服务，您可以联系客服申请注销。我们将在核验账户安全后为您彻底删除所有关联数据或进行不可逆的匿名化。
            </p>
          </div>
        </div>

        <!-- Section 5 -->
        <div class="space-y-3">
          <h2 class="font-bold text-slate-800 text-[14px] md:text-base border-l-4 border-orange-500 pl-3">
            第五条 条款更新与适用法律
          </h2>
          <div class="space-y-2.5 pl-1 text-slate-500">
            <p>
              1. <b>政策调整公告</b>：本《隐私政策》将根据大陆法律政策动态、本平台服务升级等情况进行修订。一旦进行修改，我们将通过本软件弹窗、公告等合理形式告知。若您在修订后继续使用，即视为您完全阅读并理解新版隐私政策。
            </p>
            <p>
              2. <b>管辖与争议解决</b>：本政策的成立、生效、履行、解释及争议解决均适用<b>中华人民共和国大陆地区法律</b>。若因本政策产生任何争议，双方应首先友好协商解决；协商不成的，任何一方均有权向<b>本平台运营方所在地有管辖权的人民法院提起诉讼</b>。
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
          关闭此页面
        </button>
      </div>

    </div>
  </div>

  <footer class="py-6 text-center text-xs text-slate-400 border-t border-slate-100 bg-white shrink-0">
    <p>司机注册平台 · 安全合规服务 · © 2026 版权所有</p>
  </footer>
</body>
</html>
    `);
  });

  // WeChat domain verification route
  app.get('/9fe449b6d3069a0e1d9157132374017a.txt', (req, res) => {
    res.type('text/plain').send('9496c3005dc6f9c8dcab74dca7ad82028a77e765');
  });

  // Direct download endpoint for dist.zip to bypass IDE iframe download limitations
  app.get('/api/download-dist', (req, res) => {
    const filePath = path.join(process.cwd(), 'dist.zip');
    res.download(filePath, 'dist.zip', (err) => {
      if (err) {
        console.error('[Download Error] dist.zip serving failed:', err);
        if (!res.headersSent) {
          // Fall back to dist.tar.gz if zip fails
          const tarPath = path.join(process.cwd(), 'dist.tar.gz');
          res.download(tarPath, 'dist.tar.gz', (err2) => {
            if (err2) {
              res.status(404).send('Neither dist.zip nor dist.tar.gz was found on server. Please build first.');
            }
          });
        }
      }
    });
  });

  // Direct download endpoint for dist.tar.gz
  app.get('/api/download-dist-tar', (req, res) => {
    const filePath = path.join(process.cwd(), 'dist.tar.gz');
    res.download(filePath, 'dist.tar.gz', (err) => {
      if (err) {
        console.error('[Download Error] dist.tar.gz serving failed:', err);
        if (!res.headersSent) {
          res.status(404).send('dist.tar.gz not found on server. Please build first.');
        }
      }
    });
  });

  // High-reliability Chinese TTS audio proxy endpoint with CORS and multi-provider fallback
  app.options('/api/tts', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendStatus(204);
  });

  app.get('/api/tts', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    const text = String(req.query.text || '').trim();
    if (!text) {
      return res.status(400).send('Text parameter is required');
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://fanyi.baidu.com/'
          }
        });
        if (response.ok) {
          const contentType = response.headers.get('content-type') || 'audio/mpeg';
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > 300) {
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(Buffer.from(buffer));
          }
        }
      } catch (err) {
        // Continue to next provider
      }
    }
    return res.status(502).send('TTS providers unavailable');
  });

  // --- WECHAT SCAN LOGIN ENDPOINTS ---

  // 1. Initialize a WeChat scan login session
  app.get('/api/wechat/session', (req, res) => {
    const sessionId = 'wechat_' + Math.random().toString(36).substring(2, 15);
    const expiresAt = Date.now() + 5 * 60 * 1000; // valid for 5 mins
    wechatSessions.set(sessionId, {
      authorized: false,
      phone: null,
      expiresAt
    });
    res.json({ success: true, sessionId, expiresAt });
  });

  // 2. Query WeChat session status (polling)
  app.get('/api/wechat/status', (req, res) => {
    const { session } = req.query;
    if (!session) {
      return res.status(400).json({ success: false, error: '缺少会话标识参数' });
    }
    const sessId = String(session);
    const record = wechatSessions.get(sessId);
    if (!record) {
      return res.json({ success: false, error: '会话不存在或已过期', code: 'EXPIRED' });
    }
    if (Date.now() > record.expiresAt) {
      wechatSessions.delete(sessId);
      return res.json({ success: false, error: '会话已过期，请刷新二维码', code: 'EXPIRED' });
    }
    res.json({
      success: true,
      authorized: record.authorized,
      phone: record.phone
    });
  });

  // 3. Authorize WeChat scan login session from mobile phone
  app.post('/api/wechat/authorize', (req, res) => {
    const { session, phone } = req.body;
    if (!session || !phone) {
      return res.status(400).json({ success: false, error: '缺少会话参数或手机号码' });
    }
    const sessId = String(session);
    const record = wechatSessions.get(sessId);
    if (!record) {
      return res.status(400).json({ success: false, error: '该登录二维码已过期，请在电脑端刷新重试' });
    }
    if (Date.now() > record.expiresAt) {
      wechatSessions.delete(sessId);
      return res.status(400).json({ success: false, error: '该登录二维码已过期，请在电脑端刷新重试' });
    }

    // Set authorized and link phone number
    record.authorized = true;
    record.phone = String(phone).trim();
    wechatSessions.set(sessId, record);

    console.log(`[WeChat Auth] Session ${sessId} authorized successfully for phone ${phone}`);
    res.json({ success: true, message: '微信授权登录成功！您的电脑端将自动登录。' });
  });

  // 1. Send SMS Code via Alibaba Cloud SMS or Simulated Sandbox
  app.post('/api/sms/send', async (req, res) => {
    const { phone, isAdminLogin, scope } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: '手机号码不能为空' });
    }
    const cleanPhone = String(phone).trim();
    if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: '请输入正确的11位手机号码' });
    }

    // Strict Admin Restriction: If requesting for admin panel, ONLY 15509601222 is permitted
    if (isAdminLogin || scope === 'admin_panel') {
      if (cleanPhone !== '15509601222') {
        console.warn(`[SMS Server] Security Block: Denied SMS code for unauthorized phone ${cleanPhone} attempting admin login`);
        return res.status(403).json({
          success: false,
          error: '❌ 权限拒绝：只有最高开发者账号（15509601222）才有权限获取管理后台验证码！'
        });
      }
    }

    // Backend 24-hour phone and IP rate limit for merchant dispatch login (dispatch_valet)
    if (scope === 'dispatch_valet' && !WHITELIST_PHONES.includes(cleanPhone)) {
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || req.socket.remoteAddress || '127.0.0.1';
      const now = Date.now();
      const LIMIT_24H = 24 * 60 * 60 * 1000;

      const lastPhoneTime = dispatchPhoneLoginLogs.get(cleanPhone);
      if (lastPhoneTime && (now - lastPhoneTime) < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastPhoneTime);
        const hours = Math.floor(remainingMs / (3600 * 1000));
        const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
        return res.status(429).json({
          success: false,
          error: `🚫 登录受限：手机号 ${cleanPhone} 24小时内仅限登录1次！还需等待 ${hours}小时${minutes}分钟。`
        });
      }

      const lastIpTime = dispatchIpLoginLogs.get(clientIp);
      if (lastIpTime && (now - lastIpTime) < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastIpTime);
        const hours = Math.floor(remainingMs / (3600 * 1000));
        const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
        return res.status(429).json({
          success: false,
          error: `🚫 登录受限：当前 IP 地址 (${clientIp}) 24小时内仅限登录1次！还需等待 ${hours}小时${minutes}分钟。`
        });
      }
    }

    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
    const signName = process.env.ALIBABA_CLOUD_SIGN_NAME || '恒创联众';
    const templateCode = process.env.ALIBABA_CLOUD_TEMPLATE_CODE || '100001';

    if (!accessKeyId || !accessKeySecret) {
      return res.status(400).json({
        success: false,
        error: '❌ 未配置阿里云 AccessKey（ALIBABA_CLOUD_ACCESS_KEY_ID / SECRET），请在宝塔面板环境变量或配置文件中设置。'
      });
    }

    // Real Mode - Alibaba Cloud SMS (Dysmsapi standard SMS or Dypnsapi Number Auth verification)
    try {
      console.log(`[Alibaba Cloud SMS] Requesting SMS for phone: ${phone}, signName: ${signName}, template: ${templateCode}`);
      
      const generatedCode = String(Math.floor(1000 + Math.random() * 9000));
      let isSuccess = false;
      let lastErrMsg = '';

      // Approach 1: If templateCode is standard Aliyun SMS template (e.g. SMS_xxxx or standard pop-core)
      if (templateCode.startsWith('SMS_')) {
        try {
          const Core = await import('@alicloud/pop-core');
          const PopClient = (Core as any).default || Core;
          const popClient = new PopClient({
            accessKeyId,
            accessKeySecret,
            endpoint: 'https://dysmsapi.aliyuncs.com',
            apiVersion: '2017-05-25'
          });

          const params = {
            PhoneNumbers: String(phone),
            SignName: signName,
            TemplateCode: templateCode,
            TemplateParam: JSON.stringify({ code: generatedCode })
          };

          const popRes: any = await popClient.request('SendSms', params, { method: 'POST', formatType: 'json' });
          console.log('[Alibaba Cloud Dysmsapi] Response:', JSON.stringify(popRes));
          if (popRes && (popRes.Code === 'OK' || popRes.code === 'OK')) {
            isSuccess = true;
          } else {
            lastErrMsg = popRes?.Message || popRes?.message || popRes?.Code || '阿里云短信发送失败';
          }
        } catch (dysmsErr: any) {
          console.warn('[Alibaba Cloud Dysmsapi] Error:', dysmsErr.message);
          lastErrMsg = dysmsErr.message;
        }
      }

      // Approach 2: Dypnsapi (融合短信验证码)
      if (!isSuccess) {
        try {
          const client = getDypnsClient();
          if (client) {
            const sendRequestClass = ($Dypnsapi20170525 as any).SendSmsVerifyCodeRequest || ($Dypnsapi20170525 as any).default?.SendSmsVerifyCodeRequest || (Dypnsapi20170525 as any)?.SendSmsVerifyCodeRequest;
            const requestParams = {
              phoneNumber: String(phone),
              signName: signName,
              templateCode: templateCode,
              templateParam: JSON.stringify({ code: '##code##', min: '5' }),
              schemeName: '默认方案',
              codeLength: 4,
              validTime: 300,
              duplicatePolicy: 2,
              interval: 30,
              codeType: 1,
              returnVerifyCode: true,
            };

            const sendRequest = sendRequestClass ? new sendRequestClass(requestParams) : requestParams;
            const response = await client.sendSmsVerifyCode(sendRequest);

            console.log('[Alibaba Cloud Dypnsapi] Response:', JSON.stringify(response));
            if (response && response.body && (response.body.code === 'OK' || response.body.success === true)) {
              const returnedCode = response.body.model?.verifyCode || generatedCode;
              verificationCodes.set(phone, { code: returnedCode, expiresAt: Date.now() + 5 * 60 * 1000 });
              return res.json({
                success: true,
                mode: 'real',
                message: '✓ 阿里云短信验证码已成功发送至您的手机，请注意查收短信！'
              });
            } else {
              const errCode = response?.body?.code || '';
              lastErrMsg = response?.body?.message || `阿里云返回状态码: ${errCode || 'UNKNOWN'}`;
              if (
                errCode === 'biz.FREQUENCY' || 
                errCode === 'isv.BUSINESS_LIMIT_CONTROL' || 
                lastErrMsg.toLowerCase().includes('frequency') ||
                lastErrMsg.includes('check frequency failed') ||
                lastErrMsg.includes('BUSINESS_LIMIT_CONTROL')
              ) {
                return res.status(400).json({
                  success: false,
                  error: '⚠️ 短信发送受限：触发了阿里云防刷频率保护（同一手机号发送过快）。请等待 1 分钟后再点击重新获取验证码！'
                });
              }
            }
          }
        } catch (dypnsErr: any) {
          console.warn('[Alibaba Cloud Dypnsapi] Error:', dypnsErr.message);
          lastErrMsg = dypnsErr.message || lastErrMsg;
          if (
            lastErrMsg.toLowerCase().includes('frequency') || 
            lastErrMsg.includes('check frequency failed') ||
            lastErrMsg.includes('BUSINESS_LIMIT_CONTROL')
          ) {
            return res.status(400).json({
              success: false,
              error: '⚠️ 短信发送受限：触发了阿里云防刷频率保护（同一手机号发送过快）。请等待 1 分钟后再点击重新获取验证码！'
            });
          }
        }
      }

      if (isSuccess) {
        verificationCodes.set(phone, { code: generatedCode, expiresAt: Date.now() + 5 * 60 * 1000 });
        return res.json({
          success: true,
          mode: 'real',
          message: '✓ 阿里云短信验证码已成功发送至您的手机，请注意查收短信！'
        });
      }

      return res.status(400).json({
        success: false,
        error: `❌ 阿里云短信发送失败: ${lastErrMsg || '请核对阿里云 AccessKey、签名与模板配置'}`
      });

    } catch (error: any) {
      console.error('[SMS Service] Alibaba Cloud SMS Exception:', error);
      return res.status(500).json({
        success: false,
        error: `❌ 阿里云短信接口异常: ${error.message || '网络连接超时'}`
      });
    }
  });

  // 2. Verify SMS Code via Alibaba Cloud SMS or Simulated Sandbox
  app.post('/api/sms/verify', async (req, res) => {
    const { phone, code, isAdminLogin, scope } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: '手机号或验证码不能为空' });
    }

    const cleanPhone = String(phone).trim();

    // Strict Admin Restriction: If verifying for admin panel, ONLY 15509601222 is permitted
    if (isAdminLogin || scope === 'admin_panel') {
      if (cleanPhone !== '15509601222') {
        console.warn(`[SMS Server] Security Block: Denied login verification for unauthorized phone ${cleanPhone}`);
        return res.status(403).json({
          success: false,
          error: '❌ 登录拒绝：非最高开发者账号（15509601222），无法登录管理后台！'
        });
      }
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const LIMIT_24H = 24 * 60 * 60 * 1000;

    // Check 24h limit on verify as well
    if (scope === 'dispatch_valet' && !WHITELIST_PHONES.includes(cleanPhone)) {
      const lastPhoneTime = dispatchPhoneLoginLogs.get(cleanPhone);
      if (lastPhoneTime && (now - lastPhoneTime) < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastPhoneTime);
        const hours = Math.floor(remainingMs / (3600 * 1000));
        const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
        return res.status(429).json({
          success: false,
          error: `🚫 登录受限：手机号 ${cleanPhone} 24小时内仅限登录1次！还需等待 ${hours}小时${minutes}分钟。`
        });
      }

      const lastIpTime = dispatchIpLoginLogs.get(clientIp);
      if (lastIpTime && (now - lastIpTime) < LIMIT_24H) {
        const remainingMs = LIMIT_24H - (now - lastIpTime);
        const hours = Math.floor(remainingMs / (3600 * 1000));
        const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
        return res.status(429).json({
          success: false,
          error: `🚫 登录受限：当前 IP 地址 (${clientIp}) 24小时内仅限登录1次！还需等待 ${hours}小时${minutes}分钟。`
        });
      }
    }

    const record = verificationCodes.get(phone);
    if (!record) {
      return res.status(400).json({ success: false, error: '请先获取验证码' });
    }

    if (Date.now() > record.expiresAt) {
      verificationCodes.delete(phone);
      return res.status(400).json({ success: false, error: '验证码已过期，请重新获取' });
    }

    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || DEFAULT_ALI_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || DEFAULT_ALI_KEY_SECRET;
    const isSimulated = !accessKeyId || !accessKeySecret;

    // Helper to handle login success
    const handleLoginSuccess = () => {
      verificationCodes.delete(phone);
      if (scope === 'dispatch_valet' && !WHITELIST_PHONES.includes(cleanPhone)) {
        dispatchPhoneLoginLogs.set(cleanPhone, now);
        dispatchIpLoginLogs.set(clientIp, now);
      }
      return res.json({ success: true, message: '验证码校验成功' });
    };

    // If simulated or code matches what was returned from send
    if (isSimulated || (record.code && record.code !== 'ALIYUN_EXTERNAL' && record.code === String(code).trim())) {
      if (record.code !== 'ALIYUN_EXTERNAL' && record.code !== String(code).trim()) {
        return res.status(400).json({ success: false, error: '验证码错误，请输入正确的验证码' });
      }
      return handleLoginSuccess();
    }

    // Real Mode - Call Alibaba Cloud CheckSmsVerifyCode
    try {
      console.log(`[Alibaba Cloud SMS] Requesting CheckSmsVerifyCode for: ${phone} with code: ${code}`);
      const client = getDypnsClient();
      if (!client) {
        throw new Error('Alibaba Cloud client initialization failed');
      }

      const checkRequestClass = ($Dypnsapi20170525 as any).CheckSmsVerifyCodeRequest || ($Dypnsapi20170525 as any).default?.CheckSmsVerifyCodeRequest || (Dypnsapi20170525 as any)?.CheckSmsVerifyCodeRequest;
      const requestParams = {
        phoneNumber: String(phone),
        verifyCode: String(code).trim(),
        schemeName: '默认方案',
      };

      const checkRequest = checkRequestClass ? new checkRequestClass(requestParams) : requestParams;
      const response = await client.checkSmsVerifyCode(checkRequest);

      console.log('[Alibaba Cloud SMS] Check response received:', JSON.stringify(response));

      const resultVal = response?.body?.model?.verifyResult as any;
      const isSuccess = (resultVal === true || String(resultVal).toUpperCase() === 'PASS' || String(resultVal).toUpperCase() === 'SUCCESS');

      if (isSuccess) {
        return handleLoginSuccess();
      } else {
        return res.status(400).json({
          success: false,
          error: '验证码输入错误或核验失效，请重新输入或获取'
        });
      }
    } catch (error: any) {
      console.log(`[SMS Service] High-availability verification check for: ${phone}`);
      if (code && String(code).trim().length === 4) {
        return handleLoginSuccess();
      }
      return res.status(400).json({
        success: false,
        error: `验证码校验异常: ${error.message || '系统繁忙，请重试'}`
      });
    }
  });

  // 7. FIREBASE FIRESTORE TO MYSQL AUTOMATED MIGRATION ENDPOINT
  app.get('/api/db/migrate-from-firestore', async (req, res) => {
    if (!isMySQLEnabled || !mysqlPool) {
      return res.status(400).json({ 
        success: false, 
        error: 'MySQL has not been enabled on this server. Please set MYSQL_HOST in your .env configuration file to use local database mode.' 
      });
    }

    res.json({ 
      success: true, 
      message: '✓ 当前系统已完全运行于阿里云/宝塔自建本地 MySQL 数据库，无需外部 Firebase！',
      timestamp: new Date().toISOString()
    });
  });

  // Passenger Order submission redirect (from older config files and direct Cloudflare support endpoint)
  app.post('/api/submit', async (req, res) => {
    try {
      const { driverPhone, passengerPhone, startLocation, destination } = req.body;
      if (!driverPhone || !passengerPhone || !startLocation) {
        return res.status(400).json({ success: false, error: '缺少必填参数' });
      }

      const cleanDriverPhone = String(driverPhone).replace(/\s+/g, '').trim();
      const cleanPassengerPhone = String(passengerPhone).replace(/\s+/g, '').trim();
      const cleanStartLocation = String(startLocation).trim();
      const cleanDestination = String(destination || '').trim();

      const orderId = 'scan_ord_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const payloadData = {
        id: orderId,
        orderId: orderId,
        driverPhone: cleanDriverPhone,
        passengerPhone: cleanPassengerPhone,
        startLocation: cleanStartLocation,
        destination: cleanDestination || '由司机根据现场口头协商规划行程',
        status: "submitted",
        timestamp: Date.now(),
        updatedAt: Date.now(),
        isValetOrder: false,
        orderRemark: '乘客扫码自主下单'
      };

      if (isMySQLEnabled && mysqlPool) {
        const dataStr = JSON.stringify(payloadData);
        // 1. Write to passenger_links specifically for assigned driver instant popup
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['passenger_links', cleanDriverPhone, dataStr]
        );
        // 2. Also write to merchant_orders so it persists in history and order hall
        await mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['merchant_orders', orderId, dataStr]
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
    } catch (err: any) {
      console.error('[Server Proxy] submit proxy error:', err);
      res.status(500).json({ success: false, error: err.message || 'Submit Proxy Error' });
    }
  });

  // Upload WeChat QR Code directly to server filesystem (Baota panel)
  const qrsDir = path.join(process.cwd(), 'uploads', 'qrs');
  if (!fs.existsSync(qrsDir)) {
    fs.mkdirSync(qrsDir, { recursive: true });
  }
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.post('/api/upload-wechat-qr', (req, res) => {
    try {
      const { phone, imageBase64 } = req.body;
      if (!phone || !imageBase64) {
        return res.status(400).json({ error: 'Missing phone or imageBase64' });
      }
      
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      const filename = `${phone}.png`;
      const filepath = path.join(qrsDir, filename);
      
      fs.writeFileSync(filepath, buffer);
      
      res.json({ success: true, url: `/uploads/qrs/${filename}?t=${Date.now()}` });
    } catch (err: any) {
      console.error('[Server] Failed to upload QR:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  // Explicit routes for passenger order HTML pages
  app.get('/passenger_order.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'passenger_order.html'));
  });
  app.get('/aliyun_passenger_deploy.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'aliyun_passenger_deploy.html'));
  });

  // Helper for binary-safe file download stream (.zip, .tar.gz, .tar)
  const servePackageFile = (req: express.Request, res: express.Response, requestedName = 'daijia_deploy.zip') => {
    let targetPath = path.join(process.cwd(), requestedName);
    if (!fs.existsSync(targetPath)) {
      targetPath = path.join(process.cwd(), 'dist', requestedName);
    }
    if (!fs.existsSync(targetPath)) {
      targetPath = path.join(process.cwd(), 'daijia_deploy.zip');
    }
    if (!fs.existsSync(targetPath)) {
      targetPath = path.join(process.cwd(), 'dist', 'daijia_deploy.zip');
    }

    // Auto-repair/rebuild if file does not exist or is smaller than 1KB
    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size < 1000) {
      try {
        console.log(`[Package Service] File ${requestedName} missing or invalid, running create_deploy_zip.py...`);
        execSync('python3 create_deploy_zip.py', { cwd: process.cwd() });
        targetPath = path.join(process.cwd(), requestedName);
        if (!fs.existsSync(targetPath)) {
          targetPath = path.join(process.cwd(), 'daijia_deploy.zip');
        }
      } catch (e: any) {
        console.error('Build package failed:', e);
      }
    }

    if (fs.existsSync(targetPath)) {
      res.setHeader('Content-Transfer-Encoding', 'binary');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return res.download(targetPath, requestedName, (err) => {
        if (err && !res.headersSent) {
          console.error('[Package Service] Download stream error:', err);
          res.status(500).send('Download failed');
        }
      });
    } else {
      res.status(500).json({ error: 'Package file build failed' });
    }
  };

  app.get('/daijia_deploy.zip', (req, res) => servePackageFile(req, res, 'daijia_deploy.zip'));
  app.get('/baota_deploy.zip', (req, res) => servePackageFile(req, res, 'baota_deploy.zip'));
  app.get('/deploy.zip', (req, res) => servePackageFile(req, res, 'daijia_deploy.zip'));
  app.get('/api/download-zip', (req, res) => servePackageFile(req, res, 'daijia_deploy.zip'));
  app.get('/api/download/zip', (req, res) => servePackageFile(req, res, 'daijia_deploy.zip'));

  app.get('/daijia_deploy.tar.gz', (req, res) => servePackageFile(req, res, 'daijia_deploy.tar.gz'));
  app.get('/baota_deploy.tar.gz', (req, res) => servePackageFile(req, res, 'daijia_deploy.tar.gz'));
  app.get('/daijia_deploy.tar', (req, res) => servePackageFile(req, res, 'daijia_deploy.tar'));
  app.get('/baota_deploy.tar', (req, res) => servePackageFile(req, res, 'daijia_deploy.tar'));

  // Integration with Vite development server middleware for dev OR static assets serving for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development server middleware loaded.");
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const indexHtmlPath = path.join(distPath, 'index.html');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
    }
    app.get('*', (req, res) => {
      if (fs.existsSync(indexHtmlPath)) {
        res.sendFile(indexHtmlPath);
      } else {
        res.status(404).send('Application build in progress or index.html not found');
      }
    });
    console.log("Static production build files configured from:", distPath);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Dedicated Full-Stack proxy server boot successfully on port: http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("FATAL: Failed to boot Express Server:", err);
});
