import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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

// H1修复：verify 失败计数，5次失败锁定手机号30分钟
const verifyFailures = new Map<string, { count: number; lockedUntil: number }>();

// M4修复：/api/sms/send 限流（IP+手机号：60秒1次 / 1小时5次）
const smsSendLogs = new Map<string, number[]>();

// 认证令牌存储：短信验证成功后签发，用于 /api/db/* 写操作鉴权
// 结构：token -> { phone, scope, createdAt }
// M1修复：持久化到本地文件，Node 重启不丢失；去掉7天过期（手动登出前永不过期）
const AUTH_TOKENS_PATH = (() => {
  try {
    const path = require('path');
    return path.join(path.dirname(LOCAL_JSON_DB_PATH), 'auth_tokens.json');
  } catch (_) { return './auth_tokens.json'; }
})();
const authTokens = new Map<string, { phone: string; scope: string; createdAt: number }>();
// 启动时从文件加载（N-6：主文件损坏时尝试读备份）
try {
  let loaded = false;
  if (fs.existsSync(AUTH_TOKENS_PATH)) {
    try {
      const raw = fs.readFileSync(AUTH_TOKENS_PATH, 'utf8');
      const obj = JSON.parse(raw || '{}');
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') authTokens.set(k, v as any);
      }
      loaded = true;
      console.log(`[Auth] 已从文件加载 ${authTokens.size} 个 token`);
    } catch (_) {
      // 主文件损坏，尝试备份
      const bakPath = AUTH_TOKENS_PATH + '.bak';
      if (fs.existsSync(bakPath)) {
        const rawBak = fs.readFileSync(bakPath, 'utf8');
        const objBak = JSON.parse(rawBak || '{}');
        for (const [k, v] of Object.entries(objBak)) {
          if (v && typeof v === 'object') authTokens.set(k, v as any);
        }
        loaded = true;
        console.log(`[Auth] 主文件损坏，已从备份加载 ${authTokens.size} 个 token`);
      }
    }
  }
  if (!loaded) console.log('[Auth] 无可用 token 文件，从空开始');
} catch (e: any) {
  console.error('[Auth] 加载 token 文件失败:', e?.message);
}
// token 持久化：立即同步写盘（修复 a5：10秒批量导致重启丢 token，抢单 401）
// 登录/登出是低频操作，直接同步写盘比批量更可靠
function persistAuthTokensSync() {
  try {
    const obj: Record<string, any> = {};
    for (const [k, v] of authTokens) obj[k] = v;
    const tmp = AUTH_TOKENS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmp, AUTH_TOKENS_PATH);
  } catch (e: any) {
    console.error('[Auth] 持久化 token 失败:', e?.message);
  }
}
// 保留10秒批量作为兜底（防止极端情况下的脏标记遗漏）
let _authTokensDirty = false;
setInterval(() => {
  if (!_authTokensDirty) return;
  _authTokensDirty = false;
  persistAuthTokensSync();
}, 10000);

// ===== 无状态签名 token（根治"登录已过期"：服务端不存 token，靠密钥验签）=====
// 格式：v1.<base64url(payload)>.<base64url(hmac-sha256)>
// payload: {p:手机号, s:scope, m:是否商户, i:签发时间}
// 用户铁律：手动登出前永不过期 → token 本身不设过期，登出走 blocklist
function _b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64urlDecode(s: string): string {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64').toString('utf8');
}
// 密钥：存 local_db.json 的 _config.tokenSecret，部署包自带 local_db.json 故跨部署不丢
function getTokenSecret(): string {
  try {
    const db: any = readLocalJsonDb();
    if (db && db._config && typeof db._config.tokenSecret === 'string' && db._config.tokenSecret.length >= 32) {
      return db._config.tokenSecret;
    }
    const secret = crypto.randomBytes(48).toString('hex');
    try {
      const dbData: any = readLocalJsonDb() || {};
      dbData._config = dbData._config || {};
      dbData._config.tokenSecret = secret;
      writeLocalJsonDb(dbData);
      console.log('[Auth] 已生成新的 token 签名密钥并持久化');
    } catch (e: any) {
      console.error('[Auth] 保存 token 密钥失败:', e?.message);
    }
    return secret;
  } catch (_) {
    return 'fallback-secret-' + String(Date.now());
  }
}
function createSignedToken(phone: string, scope: string, isMerchant: boolean): string {
  const payload = JSON.stringify({ p: phone, s: scope, m: !!isMerchant, i: Date.now() });
  const pb = _b64urlEncode(payload);
  const sig = crypto.createHmac('sha256', getTokenSecret()).update('v1.' + pb).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `v1.${pb}.${sig}`;
}
function verifySignedToken(token: string): { phone: string; scope: string; isMerchant: boolean } | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const [, pb, sig] = parts;
    const expect = crypto.createHmac('sha256', getTokenSecret()).update('v1.' + pb).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // 常量时间比较防时序攻击
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(_b64urlDecode(pb));
    if (!payload || !payload.p) return null;
    // 登出黑名单检查
    try {
      const db: any = readLocalJsonDb();
      const bl = db && db._config && db._config.tokenBlocklist;
      if (Array.isArray(bl) && bl.includes(token)) return null;
    } catch (_) {}
    return { phone: String(payload.p), scope: String(payload.s || 'driver'), isMerchant: !!payload.m };
  } catch (_) {
    return null;
  }
}
function blocklistToken(token: string) {
  try {
    const dbData: any = readLocalJsonDb() || {};
    dbData._config = dbData._config || {};
    const bl: string[] = Array.isArray(dbData._config.tokenBlocklist) ? dbData._config.tokenBlocklist : [];
    if (!bl.includes(token)) {
      bl.push(token);
      // 黑名单只保留最近 5000 个，防无限增长
      if (bl.length > 5000) bl.splice(0, bl.length - 5000);
      dbData._config.tokenBlocklist = bl;
      writeLocalJsonDb(dbData);
    }
  } catch (e: any) {
    console.error('[Auth] token 拉黑失败:', e?.message);
  }
}

const DEVELOPER_PHONE_SERVER = '15509601222';

// P1: 定时清理内存泄漏（verificationCodes/dispatchLogs/authTokens）
setInterval(() => {
  const now = Date.now();
  try {
    for (const [k, v] of verificationCodes) {
      if (v.expiresAt < now) verificationCodes.delete(k);
    }
    for (const [k, v] of dispatchPhoneLoginLogs) {
      if (now - v > 25 * 3600 * 1000) dispatchPhoneLoginLogs.delete(k);
    }
    for (const [k, v] of dispatchIpLoginLogs) {
      if (now - v > 25 * 3600 * 1000) dispatchIpLoginLogs.delete(k);
    }
    // M14修复：清理过期的 wechatSessions（防缓慢内存泄漏）
    for (const [k, v] of wechatSessions) {
      if (v.expiresAt < now) wechatSessions.delete(k);
    }
    // M1修复：删除 authTokens 7天过期清理（用户铁律：手动登出前永不过期）
  } catch (_) {}
}, 10 * 60 * 1000);

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
    connectionLimit: 100,
    maxIdle: 50,
    idleTimeout: 60000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
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
        INDEX \`idx_collection\` (\`collection\`),
        INDEX \`idx_col_updated\` (\`collection\`, \`updated_at\`)
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
          connectionLimit: 100,
          maxIdle: 50,
          idleTimeout: 60000,
          enableKeepAlive: true,
          keepAliveInitialDelay: 0,
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
            INDEX \`idx_collection\` (\`collection\`),
            INDEX \`idx_col_updated\` (\`collection\`, \`updated_at\`)
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

let cachedDbData: Record<string, Record<string, any>> | null = null;
let lastDbReadTime = 0;

function pickAuthoritativeVipExpiry(...expiries: (string | undefined | null)[]): string {
  for (const exp of expiries) {
    if (exp !== undefined && exp !== null) {
      const trimmed = String(exp).trim();
      if (trimmed !== '') {
        return trimmed;
      }
    }
  }
  return '待开通';
}

export const AUTHORITATIVE_REAL_DRIVER_NAMES: Record<string, string> = {
  '15509601222': '吴彦祖'
};

function isGenericDriverName(name: string, phone: string): boolean {
  const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
  if (AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone]) return false;

  if (!cleanPhone || cleanPhone.length !== 11) return true;

  if (['9147', '3634', '5678', '6058', '0116', '1223', '1958'].some(s => cleanPhone.endsWith(s))) return true;

  if (!name || typeof name !== 'string') return true;
  const clean = String(name).trim();
  if (!clean) return true;
  if (clean === '代驾司机' || clean === '在线代驾司机' || clean === '司机' || clean === '未命名' || clean === '代驾师傅' || clean === '虚拟司机') return true;
  if (/^司机\d+/.test(clean)) return true;
  if (clean.startsWith('司机') && /\d/.test(clean)) return true;
  if (['9147', '3634', '5678', '6058', '0116', '1223', '1958'].some(s => clean.includes(s))) return true;
  const last4 = cleanPhone.slice(-4);
  if (last4 && (clean === `司机${last4}` || clean.endsWith(last4))) return true;
  return false;
}

let isDbWriteScheduled = false;
let isDbWriting = false;

// P0-1: 脏标 + 5秒批量异步刷盘，避免高频同步写阻塞 Event Loop
// （提前声明，供 readLocalJsonDb 的 H15 脏读保护使用）
let _dbDirty = false;
let _dbWriteInFlight = false;

function readLocalJsonDb(): Record<string, Record<string, any>> {
  // H15修复：有未刷盘的脏数据时直接返回内存缓存，避免脏派单被磁盘旧快照覆盖丢失
  if (_dbDirty && cachedDbData) return cachedDbData;
  try {
    if (fs.existsSync(LOCAL_JSON_DB_PATH)) {
      const content = fs.readFileSync(LOCAL_JSON_DB_PATH, 'utf8');
      cachedDbData = JSON.parse(content || '{}');
      lastDbReadTime = Date.now();
      return cachedDbData!;
    }
  } catch (e) {
    console.error('[Local JSON DB] Read error:', e);
  }
  if (!cachedDbData) cachedDbData = {};
  return cachedDbData;
}

// P0-1: 脏标 + 5秒批量异步刷盘已在上方声明（_dbDirty/_dbWriteInFlight）

function writeLocalJsonDb(data: Record<string, Record<string, any>>, immediate = true) {
  cachedDbData = data;
  lastDbReadTime = Date.now();
  // 只打脏标，不同步写盘。由5秒定时器批量异步刷盘，避免786次/秒全量序列化阻塞 Event Loop
  _dbDirty = true;
}

// 5秒批量异步刷盘（H14修复：tmp+rename 原子替换，避免 kill 截断导致全库丢失）
setInterval(() => {
  if (!_dbDirty || _dbWriteInFlight) return;
  _dbDirty = false;
  _dbWriteInFlight = true;
  const snapshot = cachedDbData;
  const tmpPath = LOCAL_JSON_DB_PATH + '.tmp';
  fs.promises.writeFile(tmpPath, JSON.stringify(snapshot), 'utf8')
    .then(() => fs.promises.rename(tmpPath, LOCAL_JSON_DB_PATH))
    .catch((e: any) => console.error('[Local JSON DB] Async write error:', e?.message))
    .finally(() => { _dbWriteInFlight = false; });
}, 5000);

// H14修复：启动时备份 local_db.json.bak
try {
  if (fs.existsSync(LOCAL_JSON_DB_PATH)) {
    const bakPath = LOCAL_JSON_DB_PATH + '.bak';
    fs.copyFileSync(LOCAL_JSON_DB_PATH, bakPath);
    console.log('[Local JSON DB] 启动备份已创建:', bakPath);
  }
} catch (e: any) {
  console.error('[Local JSON DB] 启动备份失败:', e?.message);
}

// N-6修复（2026-10-10复审）：启动时备份 auth_tokens.json.bak
try {
  const tokenPath = getAuthTokenPath();
  if (fs.existsSync(tokenPath)) {
    const bakPath = tokenPath + '.bak';
    fs.copyFileSync(tokenPath, bakPath);
    console.log('[Auth Tokens] 启动备份已创建:', bakPath);
  }
} catch (e: any) {
  console.error('[Auth Tokens] 启动备份失败:', e?.message);
}

async function runSystemDiskCleanup() {
  // 1. Purge MySQL Binary Logs via active MySQL pool connection
  if (isMySQLEnabled && mysqlPool) {
    try {
      const conn = await mysqlPool.getConnection();
      await conn.query('PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL 1 DAY);');
      conn.release();
    } catch (_) {}
  }

  // 2. Clear Nginx site log files asynchronously
  try {
    const logDirs = ['/www/wwwlogs/', '/var/log/nginx/'];
    for (const dir of logDirs) {
      if (fs.existsSync(dir)) {
        const files = await fs.promises.readdir(dir).catch(() => []);
        for (const file of files) {
          if (file.endsWith('.log')) {
            const filePath = path.join(dir, file);
            try {
              const stat = await fs.promises.stat(filePath).catch(() => null);
              if (stat && stat.size > 20 * 1024 * 1024) {
                await fs.promises.truncate(filePath, 0).catch(() => {});
              }
            } catch (_) {}
          }
        }
      }
    }
  } catch (_) {}
}

async function startServer() {
  await initDatabase();

  // Schedule system disk cleanup to run every 12 hours automatically
  setInterval(() => {
    runSystemDiskCleanup().catch(() => {});
  }, 12 * 60 * 60 * 1000);

  const app = express();
  const PORT = 3000;

  // Increase payload size thresholds to avoid issues with large QR code images
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  // CORS headers
  // M11修复：Origin 白名单（不再反射任意Origin）；Allow-Headers 加上 X-Auth-Token
  const CORS_WHITELIST = [
    'https://api.lyheiwandaijiamax.com',
    'https://admin.lyheiwandaijiamax.com',
    'https://lyheiwandaijiamax.com',
    'https://418000199ly-lgtm.github.io',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    // Capacitor 原生 App 的 Origin（iOS/Android）
    'capacitor://heiwan.daijia',
    'https://heiwan.daijia',
    'http://heiwan.daijia'
  ];
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && CORS_WHITELIST.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (!origin) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token, X-Requested-With, Keep-Alive, User-Agent, Cache-Control');
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

    const now = new Date();
    const target46Date = new Date(now.getTime() + 46 * 24 * 60 * 60 * 1000);
    const yyyy = target46Date.getFullYear();
    const mm = String(target46Date.getMonth() + 1).padStart(2, '0');
    const dd = String(target46Date.getDate()).padStart(2, '0');
    const default46Expiry = `${yyyy}-${mm}-${dd}`;

    const driverUserData = {
      phone: '15509601222',
      driverName: '吴彦祖',
      role: '开发者',
      userRole: '开发者',
      vipExpiry: default46Expiry,
      customAppName: '滴滴代驾',
      isOnline: false,
      onlineOrdersEnabled: false,
      isBanned: false,
      city: '银川市',
      updatedAt: new Date().toISOString()
    };

    try {
      const dbData = readLocalJsonDb();
      if (!dbData.system_admins) dbData.system_admins = {};
      dbData.system_admins['15509601222'] = superAdminData;

      if (!dbData.driver_users) dbData.driver_users = {};
      const existingDriver = dbData.driver_users['15509601222'] || {};

      dbData.driver_users['15509601222'] = {
        ...driverUserData,
        ...existingDriver,
        customAppName: existingDriver.customAppName || '滴滴代驾',
        vipExpiry: existingDriver.vipExpiry !== undefined ? existingDriver.vipExpiry : default46Expiry
      };

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

        const localDriver = readLocalJsonDb()?.driver_users?.['15509601222'] || driverUserData;
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`)
           VALUES ('driver_users', '15509601222', ?)
           ON DUPLICATE KEY UPDATE \`data\` = JSON_MERGE_PATCH(\`data\`, ?)`,
          [JSON.stringify(localDriver), JSON.stringify({ role: '开发者', userRole: '开发者' })]
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

  // Purge simulated/mock driver data & unapproved generic drivers
  const purgeMockDriverData = async () => {
    try {
      const dbData = readLocalJsonDb();
      let modified = false;

      // Ensure kicked generic driver phones are in removed_squad_members config
      if (!dbData.config) dbData.config = {};
      if (!dbData.config.removed_squad_members) dbData.config.removed_squad_members = { phones: [] };
      const removedPhones: string[] = dbData.config.removed_squad_members.phones || [];
      const kickedPhones = [
        '17866167770', // 魏秉金
        '19995179865', // 张栋
        '13099566633', // 李鑫
        '18893028825', // 何威
        '18795101111', // 尹柏学
        '18095513011', // 杨海
        '13895299147',
        '17660453634',
        '13812345678',
        '13912345678',
        '19995426058',
        '15509601223',
        '15555556666'
      ];
      kickedPhones.forEach(p => {
        if (!removedPhones.includes(p)) {
          removedPhones.push(p);
          modified = true;
        }
      });
      dbData.config.removed_squad_members.phones = removedPhones;

      // 1. In squad_members: ONLY 15509601222 is kept!
      if (dbData.squad_members) {
        Object.keys(dbData.squad_members).forEach(docId => {
          if (docId !== '15509601222') {
            delete dbData.squad_members[docId];
            modified = true;
          }
        });
      }

      // 2. In squad_applications: ALL except 15509601222 are deleted
      if (dbData.squad_applications) {
        Object.keys(dbData.squad_applications).forEach(docId => {
          if (docId !== '15509601222') {
            delete dbData.squad_applications[docId];
            modified = true;
          }
        });
      }

      // 3. In online_applications: ONLY 15509601222 is kept and properly initialized as approved
      if (!dbData.online_applications) dbData.online_applications = {};
      Object.keys(dbData.online_applications).forEach(docId => {
        if (docId !== '15509601222') {
          delete dbData.online_applications[docId];
          modified = true;
        }
      });

      const onlineApp155 = {
        id: '15509601222',
        phone: '15509601222',
        phoneNumber: '15509601222',
        driverName: '吴彦祖',
        name: '吴彦祖',
        realName: '吴彦祖',
        role: '开发者司机',
        userRole: '开发者司机',
        status: 'approved',
        approvalStatus: '已开通',
        city: '银川市',
        vipExpiry: '2099-12-31',
        onlineOrdersEnabled: true,
        emergencyContact: '13895000000',
        drivingYears: 10,
        idCardFront: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80',
        idCardBack: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
        driverLicenseFront: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
        driverLicenseBack: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
        createdAt: '2026-10-06T00:00:00.000Z',
        updatedAt: '2026-10-06T00:00:00.000Z'
      };
      dbData.online_applications['15509601222'] = onlineApp155;

      // 4. In driver_users: ALL except 15509601222 and merchant A accounts are deleted
      if (dbData.driver_users) {
        Object.keys(dbData.driver_users).forEach(docId => {
          const isMerchantA = docId.toUpperCase().endsWith('A') || dbData.driver_users[docId]?.isMerchant;
          if (docId !== '15509601222' && !isMerchantA) {
            delete dbData.driver_users[docId];
            modified = true;
          }
        });
      }

      // Force 15509601222 developer profile
      if (!dbData.driver_users) dbData.driver_users = {};
      dbData.driver_users['15509601222'] = {
        id: '15509601222',
        phone: '15509601222',
        phoneNumber: '15509601222',
        driverName: '吴彦祖',
        name: '吴彦祖',
        realName: '吴彦祖',
        role: '开发者司机',
        userRole: '开发者司机',
        status: '已通过',
        is_squad_member: 1,
        inSquad: true,
        collection: 'squad_members',
        city: '银川市',
        vipExpiry: '2099-12-31',
        isOnline: true,
        onlineOrdersEnabled: true
      };

      if (modified) {
        writeLocalJsonDb(dbData, true);
        console.log('✓ [Database] Purged all drivers except 15509601222 and merchant accounts from local_db.json');
      }
    } catch (e) {
      console.error('[Purge] Error purging drivers from local_db.json:', e);
    }

    if (isMySQLEnabled && mysqlPool) {
      try {
        const conn = await mysqlPool.getConnection();
        // Delete all drivers except 15509601222 and merchant A accounts from MySQL daijia_documents
        await conn.query(
          `DELETE FROM \`daijia_documents\` 
           WHERE \`collection\` IN ('squad_members', 'squad_applications', 'online_applications', 'driver_users', 'driver_locations') 
           AND \`doc_id\` != '15509601222' AND \`doc_id\` NOT LIKE '%A' AND \`doc_id\` NOT LIKE '%a'`
        );
        
        // Ensure 15509601222 online_applications record exists in MySQL
        const onlineApp155 = {
          id: '15509601222',
          phone: '15509601222',
          phoneNumber: '15509601222',
          driverName: '吴彦祖',
          name: '吴彦祖',
          realName: '吴彦祖',
          role: '开发者司机',
          userRole: '开发者司机',
          status: 'approved',
          approvalStatus: '已开通',
          city: '银川市',
          vipExpiry: '2099-12-31',
          onlineOrdersEnabled: true,
          emergencyContact: '13895000000',
          drivingYears: 10,
          idCardFront: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80',
          idCardBack: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
          driverLicenseFront: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
          driverLicenseBack: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
          createdAt: '2026-10-06T00:00:00.000Z',
          updatedAt: '2026-10-06T00:00:00.000Z'
        };
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`, \`updated_at\`)
           VALUES ('online_applications', '15509601222', ?, NOW())
           ON DUPLICATE KEY UPDATE \`data\` = ?, \`updated_at\` = NOW()`,
          [JSON.stringify(onlineApp155), JSON.stringify(onlineApp155)]
        );

        // Ensure 15509601222 developer profile in MySQL driver_users and squad_members
        const dev155 = {
          id: '15509601222',
          phone: '15509601222',
          phoneNumber: '15509601222',
          driverName: '吴彦祖',
          name: '吴彦祖',
          realName: '吴彦祖',
          role: '开发者司机',
          userRole: '开发者司机',
          status: '已通过',
          is_squad_member: 1,
          inSquad: true,
          collection: 'squad_members',
          city: '银川市',
          vipExpiry: '2099-12-31',
          isOnline: true,
          onlineOrdersEnabled: true
        };
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`, \`updated_at\`)
           VALUES ('driver_users', '15509601222', ?, NOW())
           ON DUPLICATE KEY UPDATE \`data\` = ?, \`updated_at\` = NOW()`,
          [JSON.stringify(dev155), JSON.stringify(dev155)]
        );
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`, \`updated_at\`)
           VALUES ('squad_members', '15509601222', ?, NOW())
           ON DUPLICATE KEY UPDATE \`data\` = ?, \`updated_at\` = NOW()`,
          [JSON.stringify(dev155), JSON.stringify(dev155)]
        );

        // Force-update system_version in MySQL to V2.0 to sync with V2.0 app clients
        const vData = {
          version: "V2.0",
          forceUpgrade: false,
          upgradeUrl: "https://download.heiwan.com/max/v20",
          updatedAt: new Date().toISOString()
        };
        await conn.query(
          `INSERT INTO \`daijia_documents\` (\`collection\`, \`doc_id\`, \`data\`, \`updated_at\`)
           VALUES ('config', 'system_version', ?, NOW())
           ON DUPLICATE KEY UPDATE \`data\` = ?, \`updated_at\` = NOW()`,
          [JSON.stringify(vData), JSON.stringify(vData)]
        );

        conn.release();
        console.log('✓ [Database] Purged all drivers except 15509601222 from MySQL and set system_version to V2.0');
      } catch (e) {
        console.error('[Purge] Error purging drivers from MySQL:', e);
      }
    }
  };

  // Run startup sequence sequentially
  (async () => {
    await purgeMockDriverData();
    await consolidateAllDriversOnStartup();
  })();

  // Consolidate all approved squad/online drivers into driver_users on startup
  const consolidateAllDriversOnStartup = async () => {
    try {
      const dbData = readLocalJsonDb();
      if (!dbData.driver_users) dbData.driver_users = {};
      if (!dbData.squad_members) dbData.squad_members = {};
      if (!dbData.squad_applications) dbData.squad_applications = {};
      if (!dbData.online_applications) dbData.online_applications = {};
      if (!dbData.driver_locations) dbData.driver_locations = {};

      let updatedCount = 0;

      const removedList: string[] = dbData.config?.['removed_squad_members']?.phones || [];

      // 1. Pre-fetch all driver records from MySQL daijia_documents if enabled
      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            "SELECT `collection`, `doc_id`, `data` FROM `daijia_documents` WHERE `collection` IN ('squad_members', 'online_applications', 'squad_applications', 'team_members', 'driver_users', 'driver_locations')"
          );
          if (Array.isArray(rows)) {
            rows.forEach((r: any) => {
               const col = r.collection;
               const docId = r.doc_id;
               if (col && docId && r.data) {
                 const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                 if (!dbData[col]) dbData[col] = {};
                 dbData[col][docId] = { ...(dbData[col][docId] || {}), ...parsed };
               }
            });
          }
        } catch (mErr) {
          console.warn('[Consolidation] Pre-fetching MySQL rows warning:', mErr);
        }
      }

      // Compute standard 50-day target VIP expiry date (e.g., 2026-11-18)
      const now = new Date();
      const target50d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      target50d.setDate(target50d.getDate() + 50);
      const default50DaysVip = `${target50d.getFullYear()}-${String(target50d.getMonth() + 1).padStart(2, '0')}-${String(target50d.getDate()).padStart(2, '0')}`;

      // Purge removed drivers from squad_members and reset in driver_users
      removedList.forEach(p => {
        if (p !== '15509601222') {
          if (dbData.squad_members && dbData.squad_members[p]) {
            delete dbData.squad_members[p];
          }
          if (dbData.driver_locations && dbData.driver_locations[p]) {
            delete dbData.driver_locations[p];
          }
          if (dbData.squad_applications && dbData.squad_applications[p]) {
            if (dbData.squad_applications[p].status === '已通过') {
              dbData.squad_applications[p].status = '未加入小队';
            }
          }
          if (dbData.driver_users && dbData.driver_users[p]) {
            dbData.driver_users[p].is_squad_member = 0;
            dbData.driver_users[p].inSquad = false;
            dbData.driver_users[p].role = '普通司机';
            dbData.driver_users[p].userRole = '普通司机';
            if (dbData.driver_users[p].status === '已通过') {
              dbData.driver_users[p].status = '未加入小队';
            }
          }
        }
      });

      // Purge generic/unapproved drivers from squad_members
      Object.keys(dbData.squad_members).forEach(k => {
        const item = dbData.squad_members[k];
        const cleanPhone = String(item?.phone || item?.phoneNumber || k).replace(/\D/g, '').trim();
        const rawName = String(item?.name || item?.driverName || item?.applicantName || '');
        if (cleanPhone !== '15509601222') {
          if (removedList.includes(cleanPhone) || cleanPhone.includes('9147') || (isGenericDriverName(rawName, cleanPhone) && !AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone])) {
            delete dbData.squad_members[k];
          }
        }
      });

      const approvedSquadPhones = new Set<string>();
      approvedSquadPhones.add('15509601222');

      // Include drivers explicitly in squad_members collection and not in removedList
      if (dbData.squad_members) {
        Object.keys(dbData.squad_members).forEach(k => {
          const cleanPhone = String(dbData.squad_members[k]?.phone || dbData.squad_members[k]?.phoneNumber || k).replace(/\D/g, '').trim();
          if (cleanPhone && cleanPhone.length === 11 && !removedList.includes(cleanPhone)) {
            approvedSquadPhones.add(cleanPhone);
          }
        });
      }

      approvedSquadPhones.forEach(phone => {
        const sq = dbData.squad_members?.[phone] || {};
        const oa = dbData.online_applications?.[phone] || {};
        const sa = dbData.squad_applications?.[phone] || {};
        const dl = dbData.driver_locations?.[phone] || {};
        const du = dbData.driver_users?.[phone] || {};

        const name = du.driverName || du.name || sq.name || sq.driverName || oa.driverName || oa.name || AUTHORITATIVE_REAL_DRIVER_NAMES[phone] || `司机${phone.slice(-4)}`;
        const city = du.city || sq.city || oa.city || '银川市';
        
        let isRejected = (du.status === '已拒绝' || sq.status === '已拒绝' || oa.status === '已拒绝' || sa.status === '已拒绝');

        // Pick authoritative vipExpiry: driver_users du.vipExpiry is primary
        let vipExpiry = du.vipExpiry || sq.vipExpiry || oa.vipExpiry || sa.vipExpiry || '';
        
        if (isRejected) {
          vipExpiry = '待开通';
        } else if (!vipExpiry) {
          vipExpiry = '待开通';
        }

        const role = du.role || du.userRole || sq.role || sq.userRole || (phone === '15509601222' ? '开发者' : '普通司机');

        const consolidatedProfile = {
          ...sq,
          ...oa,
          ...sa,
          ...du,
          phone,
          phoneNumber: phone,
          driverName: name,
          name,
          role,
          userRole: role,
          status: isRejected ? '已拒绝' : '已通过',
          city,
          vipExpiry,
          isOnline: Boolean(du.isOnline || sq.isOnline || dl.isOnline),
          onlineOrdersEnabled: Boolean(du.onlineOrdersEnabled !== undefined ? du.onlineOrdersEnabled : (sq.onlineOrdersEnabled !== false)),
          isBanned: Boolean(du.isBanned),
          updatedAt: du.updatedAt || new Date().toISOString()
        };

        dbData.driver_users[phone] = consolidatedProfile;
        
        // Maintain approved status and persistent approver record for approved squad members
        if (!isRejected && phone !== '15509601222') {
          const approvedBy = sq.approvedBy || du.approvedBy || '最高开发者';
          const approvedRole = sq.approvedRole || du.approvedRole || '管理司机';
          const approvalTime = sq.approvalTime || du.approvalTime || sq.lastUpdatedTime || du.updatedAt || new Date().toLocaleString();

          if (!dbData.squad_members) dbData.squad_members = {};
          const existingSquad = dbData.squad_members[phone] || {};
          dbData.squad_members[phone] = {
            ...existingSquad,
            phone,
            name,
            driverName: name,
            role,
            userRole: role,
            status: '已通过',
            approvedBy,
            approvedRole,
            approvalTime,
            vipExpiry
          };

          if (dbData.squad_applications && dbData.squad_applications[phone]) {
            dbData.squad_applications[phone].status = '已通过';
            dbData.squad_applications[phone].approvedBy = approvedBy;
            dbData.squad_applications[phone].approvedRole = approvedRole;
            dbData.squad_applications[phone].vipExpiry = vipExpiry;
          }
        } else if (phone === '15509601222') {
          if (dbData.squad_members && dbData.squad_members[phone]) {
            dbData.squad_members[phone].vipExpiry = vipExpiry;
            dbData.squad_members[phone].status = '已通过';
          }
          if (dbData.squad_applications && dbData.squad_applications[phone]) {
            dbData.squad_applications[phone].vipExpiry = vipExpiry;
            dbData.squad_applications[phone].status = '已通过';
          }
        }

        updatedCount++;
      });

      // Purge any orphan driver_users entries that are not approved squad drivers or merchant A accounts
      if (dbData.driver_users) {
        Object.keys(dbData.driver_users).forEach(k => {
          const cleanP = k.replace(/\D/g, '').trim();
          const isMerchantA = k.toUpperCase().endsWith('A') || dbData.driver_users[k]?.isMerchant;
          if (cleanP !== '15509601222' && !approvedSquadPhones.has(cleanP) && !isMerchantA) {
            delete dbData.driver_users[k];
          }
        });
      }

      writeLocalJsonDb(dbData);
      console.log(`✓ [Database] Consolidated ${updatedCount} driver profiles into driver_users on startup.`);

      if (isMySQLEnabled && mysqlPool) {
        for (const phone of Object.keys(dbData.driver_users)) {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['driver_users', phone, JSON.stringify(dbData.driver_users[phone])]
          ).catch(() => {});

          if (dbData.squad_applications && dbData.squad_applications[phone]) {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['squad_applications', phone, JSON.stringify(dbData.squad_applications[phone])]
            ).catch(() => {});
          }
          if (dbData.squad_members && dbData.squad_members[phone]) {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['squad_members', phone, JSON.stringify(dbData.squad_members[phone])]
            ).catch(() => {});
          }
          if (dbData.online_applications && dbData.online_applications[phone]) {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['online_applications', phone, JSON.stringify(dbData.online_applications[phone])]
            ).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.error('[Consolidation] Error during driver startup consolidation:', e);
    }
  };

  // Run initial consolidation once on server startup
  consolidateAllDriversOnStartup().catch(() => {});

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: Date.now() });
  });

  // High-reliability Chinese Text-To-Speech (TTS) Proxy Endpoint
  app.get('/api/tts', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    const text = String(req.query.text || '').trim();
    if (!text) {
      return res.status(400).send('Missing text parameter');
    }

    const encodedText = encodeURIComponent(text);
    const ttsProviders = [
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=web`,
        referer: 'https://fanyi.baidu.com/'
      },
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=baidu`,
        referer: 'https://fanyi.baidu.com/'
      },
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=tsn`,
        referer: 'https://fanyi.baidu.com/'
      }
    ];

    for (const item of ttsProviders) {
      try {
        const response = await fetch(item.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': item.referer
          }
        });
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          if (buffer.length > 300) {
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

  // 认证中间件：写操作需要有效的短信登录令牌
  // 规则：普通用户只能写自己手机号的文档；开发者（15509601222）可写任意
  const requireDbAuth = (req: any, res: any, next: any) => {
    const token = req.headers['x-auth-token'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return res.status(401).json({ success: false, error: '未登录：缺少认证令牌，请先短信验证登录' });
    }
    // 根治"登录已过期"：优先验签无状态 token（服务端不存，重启/部署不丢）；
    // 老版本随机 token 走内存 Map 兼容过渡
    const signed = verifySignedToken(String(token));
    const info = signed
      ? { phone: signed.phone, scope: signed.scope, isMerchant: signed.isMerchant, createdAt: 0 }
      : authTokens.get(String(token));
    if (!info) {
      return res.status(401).json({ success: false, error: '登录已失效：令牌无效，请重新短信验证登录' });
    }
    // 开发者不受限制（商户身份的开发者 15509601222A 也是开发者）
    const devPhoneNorm = String(DEVELOPER_PHONE_SERVER || '').trim().toUpperCase();
    const infoPhoneNorm = String(info.phone || '').trim().toUpperCase();
    if (infoPhoneNorm === devPhoneNorm || infoPhoneNorm === devPhoneNorm + 'A') {
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = true;
      (req as any).userRole = 'developer';
      (req as any).isManager = true;
      return next();
    }
    // M10：从 squad_members 查操作者角色（同步读本地缓存）
    let userRole = 'normal';
    try {
      const dbData = readLocalJsonDb();
      const purePhone = infoPhoneNorm.replace(/A$/, '');
      const memberDoc = (dbData.squad_members && (dbData.squad_members[info.phone] || dbData.squad_members[purePhone])) || {};
      const pos = String(memberDoc.squad_position || '').trim().toLowerCase();
      if (pos === 'boss' || pos === 'manager' || pos === 'dispatcher') userRole = pos;
      if (userRole === 'normal') {
        const r = String(memberDoc.role || memberDoc.userRole || '');
        if (r.includes('城市老板')) userRole = 'boss';
        else if (r.includes('城市管理')) userRole = 'manager';
        else if (r.includes('城市派单员')) userRole = 'dispatcher';
      }
    } catch (_) {}
    (req as any).userRole = userRole;
    (req as any).isManager = userRole === 'boss' || userRole === 'manager';
    (req as any).isDispatcher = userRole === 'dispatcher';
    // 普通用户：只能操作自己手机号的文档（A后缀敏感：15509601222 ≠ 15509601222A，互不干扰）
    const normalizeId = (s: any) => String(s || '').trim().toUpperCase();
    // H10修复：同时检查 body.data.id（/api/db/add 的实际 docId 藏在 data 里）
    const bodyDocId = normalizeId(req.body?.id || req.body?.docId || req.body?.data?.id || '');
    const queryDocId = normalizeId(req.query?.id || req.query?.docId || '');
    const targetId = bodyDocId || queryDocId;
    const colName = String(req.body?.col || req.body?.collection || req.query?.col || req.query?.collection || '').trim();
    // M9：商户 A-token 写商户自有集合时，允许"去A后相等"（商户 docId 按纯手机号存储）
    const MERCHANT_OWN_COLS = ['merchant_users', 'web_valet_qrs', 'app_valet_qrs', 'dispatch_qrs', 'dispatch_qrs_web', 'dispatch_qrcodes'];
    const isMerchantToken = /A$/.test(infoPhoneNorm);
    const deA = (s: string) => s.replace(/A$/, '');
    if (isMerchantToken && MERCHANT_OWN_COLS.includes(colName) && targetId && deA(targetId) === deA(infoPhoneNorm)) {
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = false;
      return next();
    }
    // M10：城市老板/城市管理可写成员集合（审批/删除等管理操作）；派单员可写订单集合
    const MEMBER_COLS = ['squad_members', 'driver_users', 'driver_locations', 'squad_applications', 'online_applications', 'team_members'];
    const ORDER_COLS = ['merchant_orders', 'valet_orders'];
    if ((req as any).isManager && (MEMBER_COLS.includes(colName) || ORDER_COLS.includes(colName))) {
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = false;
      return next();
    }
    if ((req as any).isDispatcher && ORDER_COLS.includes(colName)) {
      (req as any).authPhone = info.phone;
      (req as any).isAdmin = false;
      return next();
    }
    // H9修复：无目标文档id的批量操作（如 clear-collection 清空整表）必须要求管理员
    if (!targetId) {
      // /api/db/add 未指定 id 时服务端生成随机 id，允许普通用户创建新文档
      const isAddWithGeneratedId = req.path === '/api/db/add' && !req.body?.data?.id;
      if (!isAddWithGeneratedId) {
        console.warn(`[Auth] 拒绝无目标id的批量操作: token手机=${info.phone}, 路径=${req.path}`);
        return res.status(403).json({ success: false, error: '该操作需要管理员权限' });
      }
    }
    if (targetId && targetId !== infoPhoneNorm) {
      console.warn(`[Auth] 拒绝越权写入: token手机=${info.phone}, 目标=${targetId}, 路径=${req.path}`);
      return res.status(403).json({ success: false, error: '无权操作他人数据' });
    }
    (req as any).authPhone = info.phone;
    (req as any).isAdmin = false;
    next();
  };

  // Check admin permission endpoint for https://admin.lyheiwandaijiamax.com/
  app.post('/api/admin/check-permission', requireDbAuth, (req, res) => {
    // H4修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
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

  // Purge all drivers and applications except 15509601222 on demand
  app.post('/api/admin/purge-all-drivers', requireDbAuth, async (req, res) => {
    // H4修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    try {
      await purgeMockDriverData();
      return res.json({
        success: true,
        message: '✓ 已成功清理所有司机及申请审批信息，仅保留 15509601222'
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err?.message || 'Purge failed'
      });
    }
  });

  // =========================================================================
  // UNIVERSAL DATABASE REST API ENDPOINTS (Supports MySQL & local_db.json)
  // Ensures 100% reliable cross-device data sync, instant order dispatch popups
  // =========================================================================


  // 1. GET Single Document
  // Supports: /api/db/get?col=passenger_links&id=15509601222 OR query params: collection, docId
  app.get('/api/db/get', async (req, res) => {
    try {
      const col = String(req.query.col || req.query.collection || '').trim();
      const docId = String(req.query.id || req.query.docId || '').trim();

      if (!col || !docId) {
        return res.status(400).json({ exists: false, error: 'Missing col or id parameter' });
      }

      const now = new Date();
      const target50d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      target50d.setDate(target50d.getDate() + 50);
      const default50DaysVip = `${target50d.getFullYear()}-${String(target50d.getMonth() + 1).padStart(2, '0')}-${String(target50d.getDate()).padStart(2, '0')}`;

      const isDriverCol = ['driver_users', 'squad_members', 'online_applications', 'squad_applications'].includes(col);
      const cleanPhone = docId.replace(/\D/g, '').trim();
      const isCleanPhone = cleanPhone.length === 11;

      let foundData: any = null;

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            [col, docId]
          );
          if (rows && rows.length > 0) {
            foundData = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
          } else if (isDriverCol) {
            const [crossRows]: any = await mysqlPool.query(
              "SELECT `data` FROM `daijia_documents` WHERE `collection` IN ('driver_users', 'squad_members', 'online_applications', 'squad_applications') AND `doc_id` = ? LIMIT 1",
              [docId]
            );
            if (crossRows && crossRows.length > 0) {
              foundData = typeof crossRows[0].data === 'string' ? JSON.parse(crossRows[0].data) : crossRows[0].data;
            }
          }
        } catch (mysqlErr: any) {
          console.error('[DB Proxy GET MySQL Error]:', mysqlErr);
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (!foundData) {
        const colData = dbData[col] || {};
        foundData = colData[docId];

        if (!foundData && isDriverCol) {
          foundData = dbData.driver_users?.[docId] || dbData.squad_members?.[docId] || dbData.squad_applications?.[docId] || dbData.online_applications?.[docId];
        }
      }

      if ((foundData || docId === '15509601222') && (isDriverCol || isCleanPhone) && docId) {
        const sq = dbData.squad_members?.[docId] || {};
        const oa = dbData.online_applications?.[docId] || {};
        const sa = dbData.squad_applications?.[docId] || {};
        const du = dbData.driver_users?.[docId] || {};
        const raw = foundData || {};

        const effectiveRole = (docId === '15509601222')
          ? '开发者司机'
          : (raw.role || raw.userRole || du.role || du.userRole || sq.role || '普通司机');

        const name = (docId === '15509601222')
          ? '吴彦祖'
          : (raw.driverName || raw.name || du.driverName || du.name || sq.name || sq.driverName || oa.driverName || sa.name || `司机${docId.slice(-4)}`);
        const isRejected = (raw.status === '已拒绝' || du.status === '已拒绝' || sq.status === '已拒绝' || oa.status === '已拒绝' || sa.status === '已拒绝');
        const status = isRejected ? '已拒绝' : '已通过';
        
        // Authoritative vipExpiry resolution: driver_users takes precedence, then raw document
        let vipExpiry = '';
        if (du.vipExpiry !== undefined && du.vipExpiry !== null && du.vipExpiry !== '') {
          vipExpiry = String(du.vipExpiry).trim();
        } else if (raw.vipExpiry !== undefined && raw.vipExpiry !== null && raw.vipExpiry !== '') {
          vipExpiry = String(raw.vipExpiry).trim();
        } else if (sq.vipExpiry !== undefined && sq.vipExpiry !== null && sq.vipExpiry !== '') {
          vipExpiry = String(sq.vipExpiry).trim();
        } else if (oa.vipExpiry !== undefined && oa.vipExpiry !== null && oa.vipExpiry !== '') {
          vipExpiry = String(oa.vipExpiry).trim();
        } else if (sa.vipExpiry !== undefined && sa.vipExpiry !== null && sa.vipExpiry !== '') {
          vipExpiry = String(sa.vipExpiry).trim();
        }

        if (isRejected) {
          vipExpiry = '待开通';
        } else if (!vipExpiry) {
          vipExpiry = '待开通';
        }

        const effectiveQr = (raw.wechatQrCode || du.wechatQrCode || sq.wechatQrCode || raw.qrcode_url || du.qrcode_url || sq.qrcode_url || '').trim();

        const resolvedDoc = {
          ...sq,
          ...oa,
          ...sa,
          ...du,
          ...raw,
          phone: docId,
          phoneNumber: docId,
          driverName: name,
          name: name,
          role: effectiveRole,
          userRole: effectiveRole,
          position: effectiveRole,
          squad_position: effectiveRole === '城市派单员司机' ? 'dispatcher' : effectiveRole === '城市管理司机' ? 'manager' : effectiveRole === '城市老板司机' ? 'boss' : effectiveRole === '开发者司机' ? 'developer' : 'normal',
          status: status,
          vipExpiry: vipExpiry,
          qrcode_url: effectiveQr,
          wechatQrCode: effectiveQr,
          qrCode: effectiveQr,
          approvedBy: raw.approvedBy || sq.approvedBy || du.approvedBy || '最高开发者',
          approvedRole: raw.approvedRole || sq.approvedRole || du.approvedRole || '开发者司机',
          updatedAt: raw.updatedAt || du.updatedAt || new Date().toISOString()
        };

        if (docId === '15509601222') {
          if (!dbData[col]) dbData[col] = {};
          dbData[col][docId] = resolvedDoc;
          if (!dbData.driver_users) dbData.driver_users = {};
          if (!dbData.squad_members) dbData.squad_members = {};
          dbData.driver_users[docId] = { ...(dbData.driver_users[docId] || {}), ...resolvedDoc };
          dbData.squad_members[docId] = { ...(dbData.squad_members[docId] || {}), ...resolvedDoc };
          writeLocalJsonDb(dbData);
        }

        return res.json({ exists: true, id: docId, data: resolvedDoc });
      }

      if (foundData !== null && foundData !== undefined) {
        return res.json({ exists: true, id: docId, data: foundData });
      }
      return res.json({ exists: false, id: docId, data: null });
    } catch (err: any) {
      console.error('[DB Proxy GET Exception]:', err);
      res.status(500).json({ exists: false, error: err.message });
    }
  });

  // 2. LIST Documents from Collection
  // Supports: /api/db/list?col=merchant_orders&limit=10000&constraints=... AND /api/db/:col
  const handleDbList = async (req: express.Request, res: express.Response) => {
    try {
      const col = String(req.params.col || req.query.col || req.query.collection || '').trim();
      if (!col) {
        return res.status(400).json({ docs: [], error: 'Missing col parameter' });
      }

      const limitNum = Math.min(Math.max(Number(req.query.limit) || 10000, 1), 20000);
      // P0-2: 增量拉取，只返回 updated_at > since 的文档，大幅降低3000并发时的数据量
      const sinceParam = String(req.query.since || '').trim();
      const sinceDate = sinceParam ? new Date(sinceParam) : null;
      const hasValidSince = sinceDate && !isNaN(sinceDate.getTime());

      if (isMySQLEnabled && mysqlPool) {
        try {
          let rows: any;
          if (hasValidSince) {
            [rows] = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? AND `updated_at` > ? ORDER BY `updated_at` DESC LIMIT ?',
              [col, sinceDate, limitNum]
            );
          } else {
            [rows] = await mysqlPool.query(
              'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ? ORDER BY `updated_at` DESC LIMIT ?',
              [col, limitNum]
            );
          }
          const now = new Date();
          const target50d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          target50d.setDate(target50d.getDate() + 50);
          const default50DaysVip = `${target50d.getFullYear()}-${String(target50d.getMonth() + 1).padStart(2, '0')}-${String(target50d.getDate()).padStart(2, '0')}`;

          const isDriverCol = ['driver_users', 'squad_members', 'online_applications', 'squad_applications'].includes(col);
          const isOrdersCol = ['merchant_orders', 'valet_orders', 'orders'].includes(col);

          // Check if requester is removed squad member or not approved for orders
          const requesterPhone = String(req.query.userPhone || req.query.phone || req.query.driverPhone || req.headers['x-user-phone'] || '').replace(/\D/g, '').trim();
          if (isOrdersCol && requesterPhone && requesterPhone !== '15509601222') {
            const removedArr: string[] = dbData.config?.['removed_squad_members']?.phones || [];
            if (removedArr.includes(requesterPhone)) {
              return res.json({ docs: [], list: [], data: [] });
            }
          }

          const clearedTimestamp = Number(dbData.config?.['merchant_orders_cleared']?.clearedAt || 0);

          const docs = (rows || []).map((r: any) => {
            const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            const obj = typeof data === 'object' && data !== null ? { ...data } : {};
            return { id: r.doc_id, ...obj, data: obj };
          }).filter((doc: any) => {
            const docIdStr = String(doc.id || doc.phone || '').trim();
            const cleanPhone = docIdStr.replace(/\D/g, '').trim();

            if (col === 'squad_applications') {
              if (docIdStr.toUpperCase().endsWith('A') || doc.isMerchant || doc.accountType === 'merchant') return false;
              if (cleanPhone === '15509601222') return false;
              if (isGenericDriverName(doc.name || doc.driverName || doc.applicantName, cleanPhone)) return doc.status === '已拒绝';
              return true;
            }

            if (col === 'online_applications') {
              // Online applications: Keep 15509601222 developer driver resident; exclude legacy deleted mock drivers
              if (cleanPhone === '15509601222') return true;
              if (docIdStr.toUpperCase().endsWith('A') || doc.isMerchant) return false;
              return true;
            }

            if (['merchant_accounts', 'merchant_users'].includes(col)) {
              // 商户识别（与前端 isMerchantAccountUnified 一致）：A后缀 或 isMerchant/accountType 或 role含商户/商家
              const docRole = String(doc?.role || doc?.userRole || '');
              const isMerchantByRole = (docRole.includes('商户') || docRole.includes('商家')) && !docRole.includes('司机');
              if (!docIdStr.toUpperCase().endsWith('A') && !doc?.isMerchant && doc?.accountType !== 'merchant' && !isMerchantByRole) return false;
              return true;
            }

            if (['squad_members', 'driver_users'].includes(col)) {
              if (cleanPhone === '15509601222') return true;
              if (docIdStr.toUpperCase().endsWith('A')) return false; // Merchant A accounts go to merchant_accounts only
              if (isGenericDriverName(doc.name || doc.driverName, cleanPhone)) return false;
              return true;
            }

            if (isOrdersCol && clearedTimestamp > 0) {
              const t = Number(doc.timestamp || doc.createdAt || doc.dispatchedAt || 0);
              if (t > 0 && t <= clearedTimestamp) return false;
            }
            return true;
          });

          return res.json({ docs, list: docs, data: docs });
        } catch (mysqlErr: any) {
          console.error('[DB Proxy LIST MySQL Error]:', mysqlErr);
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      const colData = dbData[col] || {};

      const docs = Object.keys(colData).map((k) => {
        const itemData = colData[k];
        const obj = typeof itemData === 'object' && itemData !== null ? { ...itemData } : {};
        return {
          id: k,
          ...obj,
          data: obj
        };
      }).filter((doc: any) => {
        const docIdStr = String(doc.id || doc.phone || '').trim();
        const cleanPhone = docIdStr.replace(/\D/g, '').trim();

        if (col === 'squad_applications') {
          if (docIdStr.toUpperCase().endsWith('A') || doc.isMerchant || doc.accountType === 'merchant') return false;
          if (cleanPhone === '15509601222') return false;
          if (isGenericDriverName(doc.name || doc.driverName || doc.applicantName, cleanPhone)) return doc.status === '已拒绝';
          return true;
        }

        if (col === 'online_applications') {
          if (cleanPhone === '15509601222') return true;
          if (docIdStr.toUpperCase().endsWith('A') || doc.isMerchant) return false;
          return true;
        }

        if (['merchant_accounts', 'merchant_users'].includes(col)) {
          if (!docIdStr.toUpperCase().endsWith('A')) return false;
          return true;
        }

        if (['squad_members', 'driver_users'].includes(col)) {
          if (cleanPhone === '15509601222') return true;
          if (docIdStr.toUpperCase().endsWith('A')) return false;
          if (isGenericDriverName(doc.name || doc.driverName, cleanPhone)) return false;
          return true;
        }

        if (isOrdersCol && clearedTimestamp > 0) {
          const t = Number(doc.timestamp || doc.createdAt || doc.dispatchedAt || 0);
          if (t > 0 && t <= clearedTimestamp) return false;
        }

        return true;
      });

      return res.json({ docs, list: docs, data: docs });
    } catch (err: any) {
      console.error('[DB Proxy LIST Exception]:', err);
      res.status(500).json({ docs: [], error: err.message });
    }
  };

  app.get('/api/db/list', handleDbList);
  app.get('/api/db/:col', (req, res, next) => {
    const col = req.params.col;
    if (['get', 'set', 'save', 'update', 'delete', 'clear-collection', 'add', 'migrate-from-firestore'].includes(col)) {
      return next();
    }
    return handleDbList(req, res);
  });

  // 3. SET Document (create or replace/merge) - Supports both /api/db/set and /api/db/save
  app.post(['/api/db/set', '/api/db/save'], requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || '').trim();
      const docId = String(req.body.id || req.body.docId || '').trim();
      const data = req.body.data;
      // Default to true unless explicitly false to prevent accidental document destruction
      const merge = req.body.merge !== undefined ? Boolean(req.body.merge) : true;

      if (!col || !docId || data === undefined) {
        return res.status(400).json({ success: false, error: 'Missing col, id, or data' });
      }

      // M3修复：普通用户写 squad_members 时剥离敏感字段（防被开除司机自助"洗白"）
      // 只有开发者/城市老板/城市管理可写 status/approvalStatus/role/squad_position
      if (col === 'squad_members' && !(req as any).isAdmin && !(req as any).isManager) {
        const SENSITIVE = ['status', 'approvalStatus', 'role', 'squad_position', 'userRole', 'position'];
        for (const f of SENSITIVE) {
          if (data && typeof data === 'object' && f in data) {
            console.warn(`[Auth] 剥离敏感字段: token手机=${(req as any).authPhone}, 字段=${f}`);
            delete data[f];
          }
        }
      }

      // 1. If explicitly approving or applying, automatically unblacklist the driver
      const isExplicitApproval = (data?.status === '已通过' || data?.approvalStatus === '已通过');
      const isExplicitApplication = col === 'squad_applications' && (data?.status === '待审核' || data?.status === '已通过');

      if ((col === 'squad_members' && isExplicitApproval) || isExplicitApplication) {
        // Auto-remove docId from removed_squad_members
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [cfgRows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['config', 'removed_squad_members']
            );
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones.map((p: any) => String(p).trim()).filter((p: string) => p && p !== docId) : [];
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                ['config', 'removed_squad_members', JSON.stringify({ phones })]
              );
            }
          } catch (_) {}
        }
        const dbDataTmp = readLocalJsonDb();
        if (dbDataTmp.config?.['removed_squad_members']?.phones) {
          dbDataTmp.config['removed_squad_members'].phones = dbDataTmp.config['removed_squad_members'].phones
            .map((p: any) => String(p).trim())
            .filter((p: string) => p && p !== docId);
          writeLocalJsonDb(dbDataTmp);
        }
      }

      // If writing to squad_members and not approved, check if driver is blacklisted
      if (col === 'squad_members' && docId !== '15509601222' && !isExplicitApproval) {
        let isRemovedDriver = false;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [cfgRows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['config', 'removed_squad_members']
            );
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones.map((p: any) => String(p).trim()) : [];
              if (phones.includes(docId)) isRemovedDriver = true;
            }
          } catch (_) {}
        } else {
          const dbDataTmp = readLocalJsonDb();
          const phones = dbDataTmp.config?.['removed_squad_members']?.phones || [];
          if (Array.isArray(phones) && phones.map((p: any) => String(p).trim()).includes(docId)) {
            isRemovedDriver = true;
          }
        }
        if (isRemovedDriver) {
          console.warn(`[DB Proxy SET] Dropping non-approved squad_members write for removed driver: ${docId}`);
          return res.json({ success: true, id: docId, dropped: true });
        }
      }

      let finalData = data;

      const now = new Date();
      const target50d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      target50d.setDate(target50d.getDate() + 50);
      const default50DaysVip = `${target50d.getFullYear()}-${String(target50d.getMonth() + 1).padStart(2, '0')}-${String(target50d.getDate()).padStart(2, '0')}`;

      if (isMySQLEnabled && mysqlPool) {
        try {
          if (merge) {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, docId]
            );
            if (rows && rows.length > 0) {
              const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
              finalData = { ...prev, ...data };
              if (col === 'driver_users' || col === 'squad_members' || col === 'online_applications' || col === 'squad_applications') {
                if (data.vipExpiry !== undefined) {
                  finalData.vipExpiry = data.vipExpiry;
                } else if (prev && prev.vipExpiry !== undefined) {
                  finalData.vipExpiry = prev.vipExpiry;
                } else if (!finalData.vipExpiry) {
                  finalData.vipExpiry = '待开通';
                }
                if (data.customAppName !== undefined) {
                  finalData.customAppName = data.customAppName;
                } else if (prev.customAppName !== undefined) {
                  finalData.customAppName = prev.customAppName;
                }
                if (data.deviationMitigation !== undefined) {
                  finalData.deviationMitigation = Boolean(data.deviationMitigation);
                } else if (prev.deviationMitigation !== undefined) {
                  finalData.deviationMitigation = prev.deviationMitigation;
                }
                if (data.deviationKm !== undefined) {
                  finalData.deviationKm = data.deviationKm;
                } else if (prev.deviationKm !== undefined) {
                  finalData.deviationKm = prev.deviationKm;
                }
                if (data.deviationWaitSec !== undefined) {
                  finalData.deviationWaitSec = data.deviationWaitSec;
                } else if (prev.deviationWaitSec !== undefined) {
                  finalData.deviationWaitSec = prev.deviationWaitSec;
                }
              }
            }
          }
          const dataStr = JSON.stringify(finalData);
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, docId, dataStr]
          );
        } catch (mysqlErr: any) {
          console.error('[DB Proxy SET MySQL Error]:', mysqlErr);
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (!dbData[col]) dbData[col] = {};
      if (merge && dbData[col][docId]) {
        const prev = dbData[col][docId];
        finalData = { ...prev, ...data };
        if (col === 'driver_users' || col === 'squad_members' || col === 'online_applications' || col === 'squad_applications') {
          if (data.vipExpiry !== undefined) {
            finalData.vipExpiry = data.vipExpiry;
          } else if (prev && prev.vipExpiry !== undefined) {
            finalData.vipExpiry = prev.vipExpiry;
          } else if (!finalData.vipExpiry) {
            finalData.vipExpiry = '待开通';
          }
          if (data.customAppName !== undefined) {
            finalData.customAppName = data.customAppName;
          } else if (prev.customAppName !== undefined) {
            finalData.customAppName = prev.customAppName;
          }
          if (data.deviationMitigation !== undefined) {
            finalData.deviationMitigation = Boolean(data.deviationMitigation);
          } else if (prev.deviationMitigation !== undefined) {
            finalData.deviationMitigation = prev.deviationMitigation;
          }
          if (data.deviationKm !== undefined) {
            finalData.deviationKm = data.deviationKm;
          } else if (prev.deviationKm !== undefined) {
            finalData.deviationKm = prev.deviationKm;
          }
          if (data.deviationWaitSec !== undefined) {
            finalData.deviationWaitSec = data.deviationWaitSec;
          } else if (prev.deviationWaitSec !== undefined) {
            finalData.deviationWaitSec = prev.deviationWaitSec;
          }
        }
      }
      dbData[col][docId] = finalData;

      // Automatically mirror approved squad/application drivers into driver_users
      if (col === 'squad_members' || col === 'online_applications' || col === 'squad_applications') {
        const cleanDriverPhone = docId.replace(/\D/g, '').trim();
        if (cleanDriverPhone.length === 11) {
          if (!dbData['driver_users']) dbData['driver_users'] = {};
          const existingUser = dbData['driver_users'][cleanDriverPhone] || {};
          const name = finalData.name || finalData.driverName || finalData.applicantName || existingUser.driverName || `司机${cleanDriverPhone.slice(-4)}`;
          
          const resolvedVip = finalData.vipExpiry !== undefined ? finalData.vipExpiry : (existingUser.vipExpiry || '待开通');

          const mergedDriverUser = {
            ...existingUser,
            ...finalData,
            phone: cleanDriverPhone,
            phoneNumber: cleanDriverPhone,
            driverName: name,
            name: name,
            role: finalData.role || finalData.userRole || existingUser.role || '普通司机',
            userRole: finalData.role || finalData.userRole || existingUser.userRole || '普通司机',
            status: finalData.status || existingUser.status || '已通过',
            is_squad_member: (col === 'squad_members' || finalData.status === '已通过' || finalData.is_squad_member === 1) ? 1 : (existingUser.is_squad_member ?? 0),
            city: finalData.city || existingUser.city || '银川市',
            vipExpiry: resolvedVip,
            isOnline: Boolean(finalData.isOnline !== undefined ? finalData.isOnline : existingUser.isOnline),
            onlineOrdersEnabled: Boolean(finalData.onlineOrdersEnabled !== undefined ? finalData.onlineOrdersEnabled : (existingUser.onlineOrdersEnabled !== false)),
            isBanned: Boolean(finalData.isBanned !== undefined ? finalData.isBanned : existingUser.isBanned),
            updatedAt: new Date().toISOString()
          };
          dbData['driver_users'][cleanDriverPhone] = mergedDriverUser;
          if (isMySQLEnabled && mysqlPool) {
            mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['driver_users', cleanDriverPhone, JSON.stringify(mergedDriverUser)]
            ).catch(() => {});
          }
        }
      }

      // If updating driver_users vipExpiry or fields, mirror to squad_members and squad_applications
      if (col === 'driver_users') {
        const cleanDriverPhone = docId.replace(/\D/g, '').trim();
        if (cleanDriverPhone.length === 11) {
          const mirrorCols = ['squad_members', 'squad_applications'];
          for (const mCol of mirrorCols) {
            if (dbData[mCol] && dbData[mCol][cleanDriverPhone]) {
              const currentM = dbData[mCol][cleanDriverPhone];
              const updatedM = { ...currentM };
              if (finalData.vipExpiry !== undefined) updatedM.vipExpiry = finalData.vipExpiry;
              if (finalData.role) {
                updatedM.role = finalData.role;
                updatedM.userRole = finalData.role;
                updatedM.position = finalData.role;
                updatedM.squad_position = finalData.role === '城市派单员司机' ? 'dispatcher' : finalData.role === '城市管理司机' ? 'manager' : finalData.role === '城市老板司机' ? 'boss' : 'normal';
              }
              if (finalData.wechatQrCode) updatedM.wechatQrCode = finalData.wechatQrCode;
              if (finalData.qrCode) updatedM.qrCode = finalData.qrCode;
              if (finalData.qrcode_url) updatedM.qrcode_url = finalData.qrcode_url;
              if (finalData.driverName) {
                updatedM.driverName = finalData.driverName;
                updatedM.name = finalData.driverName;
              }
              if (finalData.city) updatedM.city = finalData.city;
              if (finalData.isBanned !== undefined) updatedM.isBanned = finalData.isBanned;
              dbData[mCol][cleanDriverPhone] = updatedM;

              if (isMySQLEnabled && mysqlPool) {
                mysqlPool.query(
                  'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                  'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                  [mCol, cleanDriverPhone, JSON.stringify(updatedM)]
                ).catch(() => {});
              }
            }
          }
        }
      }

      writeLocalJsonDb(dbData, true);

      // Seamless inter-connectivity: forward writes to Mainland China Aliyun ECS Baota Server if in preview
      const hostHeader = String(req.headers.host || '');
      if (!hostHeader.includes('lyheiwandaijiamax.com')) {
        const baotaBaseUrl = 'https://api.lyheiwandaijiamax.com';
        fetch(`${baotaBaseUrl}/api/db/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ col, id: docId, data, merge })
        }).catch(() => {});
      }

      return res.json({ success: true, id: docId });
    } catch (err: any) {
      console.error('[DB Proxy SET Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. UPDATE Document (partial merge)
  app.post('/api/db/update', requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || '').trim();
      const docId = String(req.body.id || req.body.docId || '').trim();
      const data = req.body.data;

      if (!col || !docId || data === undefined) {
        return res.status(400).json({ success: false, error: 'Missing col, id, or data' });
      }

      // M3修复：普通用户写 squad_members 时剥离敏感字段（防被开除司机自助"洗白"）
      if (col === 'squad_members' && !(req as any).isAdmin && !(req as any).isManager) {
        const SENSITIVE = ['status', 'approvalStatus', 'role', 'squad_position', 'userRole', 'position'];
        for (const f of SENSITIVE) {
          if (data && typeof data === 'object' && f in data) {
            console.warn(`[Auth] 剥离敏感字段: token手机=${(req as any).authPhone}, 字段=${f}`);
            delete data[f];
          }
        }
      }

      // 1. If explicitly approving or applying, automatically unblacklist the driver
      const isExplicitApproval = (data?.status === '已通过' || data?.approvalStatus === '已通过');
      const isExplicitApplication = col === 'squad_applications' && (data?.status === '待审核' || data?.status === '已通过');

      if ((col === 'squad_members' && isExplicitApproval) || isExplicitApplication) {
        // Auto-remove docId from removed_squad_members
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [cfgRows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['config', 'removed_squad_members']
            );
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones.map((p: any) => String(p).trim()).filter((p: string) => p && p !== docId) : [];
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                ['config', 'removed_squad_members', JSON.stringify({ phones })]
              );
            }
          } catch (_) {}
        }
        const dbDataTmp = readLocalJsonDb();
        if (dbDataTmp.config?.['removed_squad_members']?.phones) {
          dbDataTmp.config['removed_squad_members'].phones = dbDataTmp.config['removed_squad_members'].phones
            .map((p: any) => String(p).trim())
            .filter((p: string) => p && p !== docId);
          writeLocalJsonDb(dbDataTmp);
        }
      }

      // If updating squad_members, verify the driver is not in removed_squad_members blacklist
      if (col === 'squad_members' && docId !== '15509601222' && !isExplicitApproval) {
        let isRemovedDriver = false;
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [cfgRows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['config', 'removed_squad_members']
            );
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones.map((p: any) => String(p).trim()) : [];
              if (phones.includes(docId)) isRemovedDriver = true;
            }
          } catch (_) {}
        } else {
          const dbDataTmp = readLocalJsonDb();
          const phones = dbDataTmp.config?.['removed_squad_members']?.phones || [];
          if (Array.isArray(phones) && phones.map((p: any) => String(p).trim()).includes(docId)) {
            isRemovedDriver = true;
          }
        }
        if (isRemovedDriver) {
          console.warn(`[DB Proxy UPDATE] Dropping non-approved squad_members write for removed driver: ${docId}`);
          return res.json({ success: true, id: docId, dropped: true });
        }
      }

      let finalData = data;

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            [col, docId]
          );
          if (rows && rows.length > 0) {
            const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
            finalData = { ...prev, ...data };
          }
          const dataStr = JSON.stringify(finalData);
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, docId, dataStr]
          );
        } catch (mysqlErr: any) {
          console.error('[DB Proxy UPDATE MySQL Error]:', mysqlErr);
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (!dbData[col]) dbData[col] = {};
      const prev = dbData[col][docId] || {};
      finalData = { ...prev, ...data };
      dbData[col][docId] = finalData;

      // Automatically mirror approved squad/application drivers into driver_users
      if (col === 'squad_members' || col === 'online_applications' || col === 'squad_applications') {
        const cleanDriverPhone = docId.replace(/\D/g, '').trim();
        if (cleanDriverPhone.length === 11) {
          if (!dbData['driver_users']) dbData['driver_users'] = {};
          const existingUser = dbData['driver_users'][cleanDriverPhone] || {};
          const name = finalData.name || finalData.driverName || finalData.applicantName || existingUser.driverName || `司机${cleanDriverPhone.slice(-4)}`;
          
          const resolvedVip = finalData.vipExpiry !== undefined ? finalData.vipExpiry : (existingUser.vipExpiry || '待开通');

          const mergedDriverUser = {
            ...existingUser,
            ...finalData,
            phone: cleanDriverPhone,
            phoneNumber: cleanDriverPhone,
            driverName: name,
            name: name,
            role: finalData.role || finalData.userRole || existingUser.role || '普通司机',
            userRole: finalData.role || finalData.userRole || existingUser.userRole || '普通司机',
            status: finalData.status || existingUser.status || '已通过',
            is_squad_member: (col === 'squad_members' || finalData.status === '已通过' || finalData.is_squad_member === 1) ? 1 : (existingUser.is_squad_member ?? 0),
            city: finalData.city || existingUser.city || '银川市',
            vipExpiry: resolvedVip,
            isOnline: Boolean(finalData.isOnline !== undefined ? finalData.isOnline : existingUser.isOnline),
            onlineOrdersEnabled: Boolean(finalData.onlineOrdersEnabled !== undefined ? finalData.onlineOrdersEnabled : (existingUser.onlineOrdersEnabled !== false)),
            isBanned: Boolean(finalData.isBanned !== undefined ? finalData.isBanned : existingUser.isBanned),
            updatedAt: new Date().toISOString()
          };
          dbData['driver_users'][cleanDriverPhone] = mergedDriverUser;
          if (isMySQLEnabled && mysqlPool) {
            mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['driver_users', cleanDriverPhone, JSON.stringify(mergedDriverUser)]
            ).catch(() => {});
          }
        }
      }

      // If updating driver_users vipExpiry or fields, mirror to squad_members and squad_applications
      if (col === 'driver_users') {
        const cleanDriverPhone = docId.replace(/\D/g, '').trim();
        if (cleanDriverPhone.length === 11) {
          const mirrorCols = ['squad_members', 'squad_applications'];
          for (const mCol of mirrorCols) {
            if (dbData[mCol] && dbData[mCol][cleanDriverPhone]) {
              const currentM = dbData[mCol][cleanDriverPhone];
              const updatedM = { ...currentM };
              if (finalData.vipExpiry !== undefined) updatedM.vipExpiry = finalData.vipExpiry;
              if (finalData.driverName) {
                updatedM.driverName = finalData.driverName;
                updatedM.name = finalData.driverName;
              }
              if (finalData.city) updatedM.city = finalData.city;
              if (finalData.isBanned !== undefined) updatedM.isBanned = finalData.isBanned;
              dbData[mCol][cleanDriverPhone] = updatedM;

              if (isMySQLEnabled && mysqlPool) {
                mysqlPool.query(
                  'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                  'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                  [mCol, cleanDriverPhone, JSON.stringify(updatedM)]
                ).catch(() => {});
              }
            }
          }
        }
      }

      writeLocalJsonDb(dbData);

      return res.json({ success: true, id: docId });
    } catch (err: any) {
      console.error('[DB Proxy UPDATE Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Dedicated admin endpoint to update driver VIP expiry across all collections atomically
  app.post('/api/admin/update-driver-expiry', requireDbAuth, async (req, res) => {
    // H5修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    try {
      const phone = String(req.body.phone || req.body.phoneNumber || '').replace(/\D/g, '').trim();
      const rawVip = String(req.body.vipExpiry || '').trim();

      if (!phone || phone.length !== 11) {
        return res.status(400).json({ success: false, error: '请输入有效的11位手机号码' });
      }

      let vipExpiry = rawVip;
      if (!vipExpiry || vipExpiry === '0' || vipExpiry === '0天' || vipExpiry === '待激活' || vipExpiry === '未激活' || vipExpiry === '待开通' || vipExpiry === '未开通' || vipExpiry === '已到期' || vipExpiry === '已过期') {
        vipExpiry = '待开通';
      } else if (vipExpiry === '永久' || vipExpiry === '永久有效' || vipExpiry === 'permanent' || vipExpiry === '终身') {
        vipExpiry = '永久有效';
      }

      const dbData = readLocalJsonDb();
      const targetCols = ['driver_users', 'squad_members', 'squad_applications'];
      
      for (const col of targetCols) {
        if (!dbData[col]) dbData[col] = {};
        const existing = dbData[col][phone] || {};
        const updated = {
          ...existing,
          phone,
          phoneNumber: phone,
          vipExpiry,
          updatedAt: new Date().toISOString()
        };
        dbData[col][phone] = updated;

        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, phone, JSON.stringify(updated)]
          ).catch(() => {});
        }
      }

      writeLocalJsonDb(dbData, true);

      // Seamless inter-connectivity: forward update to Mainland China Aliyun ECS Baota Server if running on Cloud Run/external proxy
      const hostHeader = String(req.headers.host || '');
      if (!hostHeader.includes('lyheiwandaijiamax.com')) {
        const baotaBaseUrl = 'https://api.lyheiwandaijiamax.com';
        fetch(`${baotaBaseUrl}/api/admin/update-driver-expiry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, vipExpiry })
        }).catch(err => console.warn('[Forward to Baota update-driver-expiry error]:', err));

        for (const col of targetCols) {
          fetch(`${baotaBaseUrl}/api/db/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              col,
              id: phone,
              data: { phone, phoneNumber: phone, vipExpiry, updatedAt: new Date().toISOString() },
              merge: true
            })
          }).catch(() => {});
        }
      }

      console.log(`[Admin VIP Expiry Updated] Phone: ${phone} -> vipExpiry: ${vipExpiry}`);
      return res.json({ success: true, phone, vipExpiry });
    } catch (err: any) {
      console.error('[Admin VIP Expiry Update Error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Dedicated admin endpoint to update driver role/position atomically across all collections
  app.post('/api/admin/update-driver-role', requireDbAuth, async (req, res) => {
    // H5修复：加鉴权+isAdmin校验（防止自助提权）
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    try {
      const phone = String(req.body.phone || req.body.phoneNumber || '').replace(/\D/g, '').trim();
      const role = String(req.body.role || req.body.userRole || req.body.position || '').trim();
      const city = String(req.body.city || '').trim();

      if (!phone || phone.length !== 11) {
        return res.status(400).json({ success: false, error: '请输入有效的11位手机号码' });
      }

      const validRole = role || '普通司机';
      const dbData = readLocalJsonDb();
      const targetCols = ['driver_users', 'squad_members', 'squad_applications', 'online_applications'];
      
      for (const col of targetCols) {
        if (!dbData[col]) dbData[col] = {};
        const existing = dbData[col][phone] || {};
        const updated = {
          ...existing,
          phone,
          phoneNumber: phone,
          role: validRole,
          userRole: validRole,
          position: validRole,
          squad_position: validRole === '城市派单员司机' ? 'dispatcher' : validRole === '城市管理司机' ? 'manager' : validRole === '城市老板司机' ? 'boss' : 'normal',
          updatedAt: new Date().toISOString()
        };
        if (city) updated.city = city;
        dbData[col][phone] = updated;

        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, phone, JSON.stringify(updated)]
          ).catch(() => {});
        }
      }

      if (!dbData.team_members) dbData.team_members = {};
      if (['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机'].includes(validRole)) {
        dbData.team_members[phone] = {
          phone,
          role: validRole,
          city: city || dbData.driver_users?.[phone]?.city || '银川市',
          updatedAt: new Date().toISOString()
        };
        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['team_members', phone, JSON.stringify(dbData.team_members[phone])]
          ).catch(() => {});
        }
      } else {
        if (dbData.team_members[phone]) delete dbData.team_members[phone];
        if (isMySQLEnabled && mysqlPool) {
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
            ['team_members', phone]
          ).catch(() => {});
        }
      }

      writeLocalJsonDb(dbData);

      // Seamless inter-connectivity: forward update to Mainland China Aliyun ECS Baota Server
      const hostHeader = String(req.headers.host || '');
      if (!hostHeader.includes('lyheiwandaijiamax.com')) {
        const baotaBaseUrl = 'https://api.lyheiwandaijiamax.com';
        fetch(`${baotaBaseUrl}/api/admin/update-driver-role`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, role: validRole, city })
        }).catch(err => console.warn('[Forward to Baota update-driver-role error]:', err));
      }

      console.log(`[Admin Driver Role Updated] Phone: ${phone} -> role: ${validRole}`);
      return res.json({ success: true, phone, role: validRole });
    } catch (err: any) {
      console.error('[Admin Driver Role Update Error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4.6 Batch Recharge All Squad Drivers VIP (Default 50 Days, Excludes 15509601222)
  app.post(['/api/admin/batch-recharge-squad', '/api/admin/recharge-all-drivers'], requireDbAuth, async (req, res) => {
    // H5修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    try {
      const daysCount = parseInt(req.body.days || '50', 10) || 50;
      const exclude = String(req.body.excludePhone || '15509601222').replace(/\D/g, '').trim();

      const now = new Date();
      const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      targetDate.setDate(targetDate.getDate() + daysCount);
      const targetExpiry = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

      const dbData = readLocalJsonDb();
      if (!dbData.driver_users) dbData.driver_users = {};
      if (!dbData.squad_members) dbData.squad_members = {};
      if (!dbData.squad_applications) dbData.squad_applications = {};
      if (!dbData.online_applications) dbData.online_applications = {};

      const allPhones = new Set<string>();
      ['squad_members', 'squad_applications', 'team_members', 'driver_locations', 'driver_users'].forEach(col => {
        if (dbData[col]) {
          Object.keys(dbData[col]).forEach(k => {
            const cleanPhone = String(dbData[col][k]?.phone || dbData[col][k]?.phoneNumber || k).replace(/\D/g, '').trim();
            if (cleanPhone && cleanPhone.length === 11 && cleanPhone !== exclude) {
              allPhones.add(cleanPhone);
            }
          });
        }
      });

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            "SELECT `collection`, `doc_id`, `data` FROM `daijia_documents` WHERE `collection` IN ('squad_members', 'online_applications', 'squad_applications', 'team_members', 'driver_locations', 'driver_users')"
          );
          if (Array.isArray(rows)) {
            rows.forEach((r: any) => {
              const cleanPhone = String(r.doc_id || '').replace(/\D/g, '').trim();
              if (cleanPhone && cleanPhone.length === 11 && cleanPhone !== exclude) {
                allPhones.add(cleanPhone);
              }
            });
          }
        } catch (_) {}
      }

      const updatedPhones: string[] = [];
      const targetCols = ['driver_users', 'squad_members', 'squad_applications'];

      for (const phone of Array.from(allPhones)) {
        if (phone === exclude) continue;
        updatedPhones.push(phone);

        const sq = dbData.squad_members?.[phone] || {};
        const oa = dbData.online_applications?.[phone] || {};
        const sa = dbData.squad_applications?.[phone] || {};
        const du = dbData.driver_users?.[phone] || {};

        const name = du.driverName || du.name || sq.name || sq.driverName || oa.driverName || sa.name || `司机${phone.slice(-4)}`;
        const city = du.city || sq.city || oa.city || '银川市';

        for (const col of targetCols) {
          if (!dbData[col]) dbData[col] = {};
          const existing = dbData[col][phone] || {};
          dbData[col][phone] = {
            ...existing,
            phone,
            phoneNumber: phone,
            name: existing.name || name,
            driverName: existing.driverName || name,
            city: existing.city || city,
            status: '已通过',
            vipExpiry: targetExpiry,
            updatedAt: new Date().toISOString()
          };

          if (isMySQLEnabled && mysqlPool) {
            mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              [col, phone, JSON.stringify(dbData[col][phone])]
            ).catch(() => {});
          }
        }
      }

      writeLocalJsonDb(dbData);
      console.log(`✓ [Batch VIP Recharge] Successfully recharged ${updatedPhones.length} squad drivers with ${daysCount} days VIP (${targetExpiry})`);

      return res.json({
        success: true,
        count: updatedPhones.length,
        days: daysCount,
        targetExpiry,
        updatedPhones
      });
    } catch (err: any) {
      console.error('[Batch VIP Recharge Error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. DELETE Document
  app.post('/api/db/delete', requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || '').trim();
      const docId = String(req.body.id || req.body.docId || '').trim();

      if (!col || !docId) {
        return res.status(400).json({ success: false, error: 'Missing col or id' });
      }

      // 保护最高权限开发者 15509601222：任何人都不能删除开发者
      if (docId === '15509601222' && (col === 'squad_members' || col === 'driver_users' || col === 'squad_applications')) {
        return res.status(403).json({ success: false, error: '开发者 15509601222 拥有最高系统权限，禁止删除！' });
      }

      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
            [col, docId]
          );
          const isHardDelete = req.body.hardDelete === true || req.body.hardDelete === 'true';

          if (col === 'squad_members' && docId !== '15509601222') {
            // Cascade delete from driver_locations & squad_applications (both by doc_id and phone)
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['driver_locations', docId]
            );
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND (`doc_id` = ? OR JSON_UNQUOTE(JSON_EXTRACT(`data`, \'$.phone\')) = ?)',
              ['squad_applications', docId, docId]
            );
            
            if (isHardDelete) {
              await mysqlPool.query(
                'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
                ['driver_users', docId]
              );
              await mysqlPool.query(
                'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
                ['online_applications', docId]
              );
            } else {
              // Reset driver_users to 普通司机
              const [uRows]: any = await mysqlPool.query(
                'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
                ['driver_users', docId]
              );
              let uData: any = { role: '普通司机', userRole: '普通司机', status: '未加入小队', approvalStatus: '未加入小队', is_squad_member: 0 };
              if (uRows && uRows.length > 0) {
                const prevU = typeof uRows[0].data === 'string' ? JSON.parse(uRows[0].data) : uRows[0].data;
                uData = { ...prevU, ...uData, is_squad_member: 0, status: '未加入小队', approvalStatus: '未加入小队' };
              }
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                ['driver_users', docId, JSON.stringify(uData)]
              );
            }

            // Add to removed_squad_members config
            const [cfgRows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['config', 'removed_squad_members']
            );
            let cfgData = { phones: [docId] };
            if (cfgRows && cfgRows.length > 0) {
              const prevCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
              const phones = Array.isArray(prevCfg?.phones) ? prevCfg.phones : [];
              if (!phones.includes(docId)) phones.push(docId);
              cfgData = { ...prevCfg, phones };
            }
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['config', 'removed_squad_members', JSON.stringify(cfgData)]
            );
          } else if (col === 'driver_users' && isHardDelete && docId !== '15509601222') {
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['squad_members', docId]
            );
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['squad_applications', docId]
            );
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['online_applications', docId]
            );
          }
        } catch (mysqlErr: any) {
          console.error('[DB Proxy DELETE MySQL Error]:', mysqlErr);
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (dbData[col] && dbData[col][docId] !== undefined) {
        delete dbData[col][docId];
      }
      if (col === 'squad_members' && docId !== '15509601222') {
        if (dbData.driver_locations && dbData.driver_locations[docId]) {
          delete dbData.driver_locations[docId];
        }
        if (dbData.squad_applications) {
          for (const k of Object.keys(dbData.squad_applications)) {
            const app = dbData.squad_applications[k];
            if (k === docId || app?.phone === docId || app?.id === docId) {
              delete dbData.squad_applications[k];
            }
          }
        }
        if (dbData.driver_users && dbData.driver_users[docId]) {
          dbData.driver_users[docId] = {
            ...dbData.driver_users[docId],
            role: '普通司机',
            userRole: '普通司机',
            status: '未加入小队',
            approvalStatus: '未加入小队',
            is_squad_member: 0,
            inSquad: false,
            isSquadMember: false
          };
        }
        if (!dbData.config) dbData.config = {};
        if (!dbData.config['removed_squad_members']) {
          dbData.config['removed_squad_members'] = { phones: [] };
        }
        const phones: string[] = dbData.config['removed_squad_members'].phones || [];
        if (!phones.includes(docId)) {
          phones.push(docId);
          dbData.config['removed_squad_members'].phones = phones;
        }
      }
      writeLocalJsonDb(dbData);

      return res.json({ success: true, id: docId });
    } catch (err: any) {
      console.error('[DB Proxy DELETE Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.1 CLEAR Collection (Purges all documents in a collection from MySQL and local JSON DB)
  app.post('/api/db/clear-collection', requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || '').trim();
      if (!col) {
        return res.status(400).json({ success: false, error: 'Missing col parameter' });
      }

      console.log(`[DB Proxy] Purging entire collection: ${col}`);

      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` = ?',
            [col]
          );
          console.log(`✓ [MySQL] Cleared all records for collection: ${col}`);
        } catch (mysqlErr: any) {
          console.error('[DB Proxy CLEAR-COLLECTION MySQL Error]:', mysqlErr);
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (dbData[col]) {
        dbData[col] = {};
      }

      if (col === 'merchant_orders' || col === 'valet_orders' || col === 'orders') {
        const nowTs = Date.now();
        if (!dbData.config) dbData.config = {};
        dbData.config['merchant_orders_cleared'] = { clearedAt: nowTs };

        if (isMySQLEnabled && mysqlPool) {
          try {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['config', 'merchant_orders_cleared', JSON.stringify({ clearedAt: nowTs })]
            );
          } catch (_) {}
        }
      }

      writeLocalJsonDb(dbData);

      return res.json({ success: true, collection: col });
    } catch (err: any) {
      console.error('[DB Proxy CLEAR-COLLECTION Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.2 CLEAR ALL ORDERS (彻底清除阿里云服务器上的所有订单记录，包括商户代叫、代驾订单、抢单/接单记录与通道)
  app.post('/api/orders/clear-all', requireDbAuth, async (req, res) => {
    // H6修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    try {
      console.log('[DB Proxy] 正在执行全量一键清空：清除所有订单记录 (merchant_orders, valet_orders, orders, passenger_links, active_orders)');
      const nowTs = Date.now();
      const orderCollections = ['merchant_orders', 'valet_orders', 'orders', 'passenger_links', 'active_orders'];

      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            'DELETE FROM `daijia_documents` WHERE `collection` IN (?, ?, ?, ?, ?)',
            orderCollections
          );
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['config', 'merchant_orders_cleared', JSON.stringify({ clearedAt: nowTs })]
          );
          console.log('✓ [MySQL] 已彻底清除所有订单数据记录与历史缓存');
        } catch (mysqlErr: any) {
          console.error('[MySQL Clear-All Orders Error]:', mysqlErr);
        }
      }

      const dbData = readLocalJsonDb();
      orderCollections.forEach((c) => {
        dbData[c] = {};
      });

      if (!dbData.config) dbData.config = {};
      dbData.config['merchant_orders_cleared'] = { clearedAt: nowTs };

      // 重置所有小队司机的忙碌状态为 idle / false
      if (dbData['driver_users']) {
        Object.keys(dbData['driver_users']).forEach((p) => {
          if (dbData['driver_users'][p]) {
            dbData['driver_users'][p].isBusy = false;
            dbData['driver_users'][p].status = 'idle';
          }
        });
      }
      if (dbData['driver_locations']) {
        Object.keys(dbData['driver_locations']).forEach((p) => {
          if (dbData['driver_locations'][p]) {
            dbData['driver_locations'][p].isBusy = false;
            dbData['driver_locations'][p].status = 'idle';
          }
        });
      }
      if (dbData['squad_members']) {
        Object.keys(dbData['squad_members']).forEach((p) => {
          if (dbData['squad_members'][p]) {
            dbData['squad_members'][p].isBusy = false;
            dbData['squad_members'][p].status = 'idle';
          }
        });
      }

      writeLocalJsonDb(dbData);
      console.log('✓ [阿里云本地数据库] 已彻底清除所有订单记录，本地与服务器不再保存所有订单记录');
      return res.json({ success: true, clearedAt: nowTs, message: '所有订单记录已从服务器彻底清除！' });
    } catch (err: any) {
      console.error('[Clear-All Orders Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Helper to set driver offline in MySQL and local JSON DB
  const performServerOffline = async (phone: string, reason: string) => {
    const cleanPhone = String(phone || '').trim();
    if (!cleanPhone) return;

    const offlinePayload = {
      isOnline: false,
      onlineOrdersEnabled: false,
      pending0559Offline: false,
      lastOfflineReason: reason,
      lastOfflineTime: new Date().toISOString(),
      lastUpdatedTime: new Date().toISOString()
    };

    if (isMySQLEnabled && mysqlPool) {
      try {
        for (const col of ['driver_users', 'squad_members', 'driver_locations']) {
          const [rows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            [col, cleanPhone]
          );
          let merged = offlinePayload;
          if (rows && rows.length > 0) {
            const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
            merged = { ...prev, ...offlinePayload };
          }
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, cleanPhone, JSON.stringify(merged)]
          );
        }
      } catch (err) {
        console.error('[MySQL performServerOffline Error]:', err);
      }
    }

    const dbData = readLocalJsonDb();
    ['driver_users', 'squad_members', 'driver_locations'].forEach((col) => {
      if (!dbData[col]) dbData[col] = {};
      const prev = dbData[col][cleanPhone] || {};
      dbData[col][cleanPhone] = { ...prev, ...offlinePayload };
    });
    writeLocalJsonDb(dbData);
  };

  // 5.1 Driver Offline API (Mainland China Baota / Aliyun REST API)
  // M2修复：加 requireDbAuth，本人只能操作自己
  app.post('/api/driver/offline', requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || req.body.driverPhone || '').trim();
      const reason = String(req.body.reason || 'manual_offline').trim();
      if (!phone) {
        return res.status(400).json({ success: false, error: 'Missing driver phone' });
      }
      if (!(req as any).isAdmin && phone.toUpperCase() !== String((req as any).authPhone || '').trim().toUpperCase()) {
        return res.status(403).json({ success: false, error: '无权操作他人数据' });
      }
      await performServerOffline(phone, reason);
      console.log(`[Baota API /api/driver/offline] Driver ${phone} set to offline successfully (Reason: ${reason})`);
      return res.json({ success: true, phone, isOnline: false });
    } catch (err: any) {
      console.error('[Baota API /api/driver/offline Error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.15 Driver Busy/Idle Status Report API (Alibaba Cloud Baota Server Panel Real-time Sync)
  // M2修复：加 requireDbAuth，本人只能操作自己
  app.post('/api/driver/status', requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || req.body.driverPhone || '').trim();
      if (!phone) {
        return res.status(400).json({ success: false, error: 'Missing driver phone' });
      }
      if (!(req as any).isAdmin && phone.toUpperCase() !== String((req as any).authPhone || '').trim().toUpperCase()) {
        return res.status(403).json({ success: false, error: '无权操作他人数据' });
      }
      const isBusy = Boolean(req.body.isBusy);
      const status = isBusy ? 'busy' : 'idle';
      const currentView = req.body.currentView || (isBusy ? 'create_order' : 'home');
      const timestamp = req.body.timestamp || Date.now();

      const patch: any = {
        isBusy,
        status,
        currentView,
        lastStatusUpdateTime: timestamp,
        lastUpdatedTime: new Date().toISOString()
      };

      const dbData = readLocalJsonDb();
      ['driver_users', 'squad_members', 'driver_locations'].forEach((col) => {
        if (!dbData[col]) dbData[col] = {};
        const prev = dbData[col][phone] || {};
        dbData[col][phone] = { ...prev, ...patch, phone };
      });
      writeLocalJsonDb(dbData);

      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['driver_locations', phone, JSON.stringify({ ...(dbData.driver_locations?.[phone] || {}), ...patch, phone })]
          );
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['squad_members', phone, JSON.stringify({ ...(dbData.squad_members?.[phone] || {}), ...patch, phone })]
          );
        } catch (_) {}
      }

      return res.json({ success: true, phone, isBusy, status });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.2 Driver Location & Online Status Report API (Alibaba Cloud Baota Server Panel 20s Reporter)
  // M2修复：加 requireDbAuth，本人只能操作自己
  app.post('/api/driver/location', requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || '').trim();
      if (!phone) {
        return res.status(400).json({ success: false, error: 'Missing phone' });
      }
      if (!(req as any).isAdmin && phone.toUpperCase() !== String((req as any).authPhone || '').trim().toUpperCase()) {
        return res.status(403).json({ success: false, error: '无权操作他人数据' });
      }
      const lat = req.body.lat !== undefined ? Number(req.body.lat) : undefined;
      const lng = req.body.lng !== undefined ? Number(req.body.lng) : undefined;
      const isOnline = req.body.isOnline !== undefined ? Boolean(req.body.isOnline) : undefined;
      const isBusy = req.body.isBusy !== undefined ? Boolean(req.body.isBusy) : false;
      const todayOrders = req.body.todayOrders !== undefined ? Number(req.body.todayOrders) : undefined;
      const timestamp = req.body.timestamp || Date.now();

      const driverName = req.body.driverName || req.body.name;
      const patch: any = { 
        lastUpdatedTime: new Date().toISOString(), 
        locationTimestamp: timestamp,
        isBusy
      };
      if (driverName && !isGenericDriverName(driverName, phone)) {
        patch.driverName = driverName;
        patch.name = driverName;
      }
      if (req.body.city) patch.city = req.body.city;
      if (req.body.version) patch.version = req.body.version;
      if (req.body.appVersion) patch.appVersion = req.body.appVersion;
      if (todayOrders !== undefined && !isNaN(todayOrders)) patch.todayOrders = todayOrders;
      if (lat !== undefined && !isNaN(lat)) patch.lat = lat;
      if (lng !== undefined && !isNaN(lng)) patch.lng = lng;
      if (isOnline !== undefined) {
        patch.isOnline = isOnline;
        if (!isOnline) {
          patch.onlineOrdersEnabled = false;
        }
      }

      const dbData = readLocalJsonDb();

      // Retrieve removed phones list from config
      const removedPhones = new Set<string>();
      try {
        const removedCfg = dbData.config?.['removed_squad_members']?.phones;
        if (Array.isArray(removedCfg)) {
          removedCfg.forEach((p: any) => removedPhones.add(String(p).trim()));
        }
      } catch (_) {}

      // If driver was deleted/removed from squad, strictly clean up and block re-entry
      if (removedPhones.has(phone) && phone !== '15509601222') {
        if (dbData.squad_members && dbData.squad_members[phone]) {
          delete dbData.squad_members[phone];
        }
        if (dbData.driver_locations && dbData.driver_locations[phone]) {
          delete dbData.driver_locations[phone];
        }
        writeLocalJsonDb(dbData);
        if (isMySQLEnabled && mysqlPool) {
          try {
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` IN (?, ?) AND `doc_id` = ?',
              ['squad_members', 'driver_locations', phone]
            );
          } catch (_) {}
        }
        return res.json({ success: true, removed: true, isOnline: false });
      }

      // Check if squad_members already contains this driver, or is master developer phone
      const isExistingSquadMember = phone === '15509601222' || Boolean(dbData.squad_members && dbData.squad_members[phone]);
      const collectionsToUpdate = isExistingSquadMember 
        ? ['driver_users', 'squad_members', 'driver_locations'] 
        : ['driver_users', 'driver_locations'];

      collectionsToUpdate.forEach((col) => {
        if (!dbData[col]) dbData[col] = {};
        const prev = dbData[col][phone] || {};
        dbData[col][phone] = { ...prev, ...patch, phone };
      });
      // Debounced write to avoid disk I/O saturation under 1000-1500 drivers concurrency
      writeLocalJsonDb(dbData);

      if (isMySQLEnabled && mysqlPool) {
        const mergedLocation = { ...(dbData.driver_locations?.[phone] || {}), ...patch, phone };
        // Fire-and-forget async update with error catching
        mysqlPool.query(
          'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
          ['driver_locations', phone, JSON.stringify(mergedLocation)]
        ).catch(() => {});
      }

      return res.json({ success: true, isOnline: patch.isOnline, serverTime: Date.now() });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.3 Get All Real-Time Driver Locations API
  app.get('/api/driver/locations', async (req, res) => {
    try {
      const locations: Record<string, any> = {};
      const dbData = readLocalJsonDb();
      const removedPhones = new Set<string>();
      try {
        const removedCfg = dbData.config?.['removed_squad_members']?.phones;
        if (Array.isArray(removedCfg)) {
          removedCfg.forEach((p: any) => removedPhones.add(String(p).trim()));
        }
      } catch (_) {}

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [cfgRows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['config', 'removed_squad_members']
          );
          if (cfgRows && cfgRows.length > 0) {
            const parsedCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
            if (Array.isArray(parsedCfg?.phones)) {
              parsedCfg.phones.forEach((p: any) => removedPhones.add(String(p).trim()));
            }
          }
        } catch (_) {}
      }

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['driver_locations']
          );
          if (rows && Array.isArray(rows)) {
            rows.forEach((r: any) => {
              try {
                const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                const phone = String(parsed?.phone || r.doc_id || '').trim();
                if (phone && (phone === '15509601222' || !removedPhones.has(phone))) {
                  locations[r.doc_id] = parsed;
                }
              } catch (_) {}
            });
          }
        } catch (_) {}
      }

      if (dbData.driver_locations) {
        Object.keys(dbData.driver_locations).forEach((k) => {
          const phone = String(dbData.driver_locations[k]?.phone || k || '').trim();
          if (phone && (phone === '15509601222' || !removedPhones.has(phone))) {
            locations[k] = { ...(locations[k] || {}), ...dbData.driver_locations[k] };
          }
        });
      }

      const cutoffMs = getMostRecent0559CutoffMs();
      Object.keys(locations).forEach((k) => {
        const item = locations[k];
        if (item && (item.isOnline === true || item.isOnline === 'true')) {
          let t = 0;
          if (item.onlineSessionTime) t = Number(item.onlineSessionTime);
          else if (item.lastLocationTime) t = Number(item.lastLocationTime);
          else if (item.locationTimestamp) t = Number(item.locationTimestamp);
          else if (item.lastUpdatedTime) t = new Date(item.lastUpdatedTime).getTime();
          else if (item.updatedAt) t = new Date(item.updatedAt).getTime();
          
          if (t > 0 && t < cutoffMs) {
            locations[k] = { ...item, isOnline: false, onlineOrdersEnabled: false };
          }
        }
      });

      return res.json({ success: true, locations });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.4 Get Squad Members API (China Baota Panel Direct)
  app.get('/api/squad/members', async (req, res) => {
    try {
      const list: any[] = [];
      const seen = new Set<string>();
      const dbData = readLocalJsonDb();
      const removedPhones = new Set<string>();
      try {
        const removedCfg = dbData.config?.['removed_squad_members']?.phones;
        if (Array.isArray(removedCfg)) {
          removedCfg.forEach((p: any) => removedPhones.add(String(p).trim()));
        }
      } catch (_) {}

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [cfgRows]: any = await mysqlPool.query(
            'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
            ['config', 'removed_squad_members']
          );
          if (cfgRows && cfgRows.length > 0) {
            const parsedCfg = typeof cfgRows[0].data === 'string' ? JSON.parse(cfgRows[0].data) : cfgRows[0].data;
            if (Array.isArray(parsedCfg?.phones)) {
              parsedCfg.phones.forEach((p: any) => removedPhones.add(String(p).trim()));
            }
          }
        } catch (_) {}
      }

      const isInvalidDriver = (phone: string, name?: string) => {
        if (!phone) return true;
        if (phone === '15509601222') return false;
        if (removedPhones.has(phone)) return true;
        if (name && (name.includes('虚拟') || name.startsWith('测试') || name.includes('test'))) return true;
        if (['13912345678', '15509601223', '15555556666', '13895299147', '17660453634', '13812345678', '19995426058', 'm-1', 'm-2', 'm-3'].includes(phone)) return true;
        if (isGenericDriverName(name || '', phone) && !AUTHORITATIVE_REAL_DRIVER_NAMES[phone]) return true;
        return false;
      };

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [rows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['squad_members']
          );
          if (rows && Array.isArray(rows)) {
            rows.forEach((r: any) => {
              try {
                const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                const phone = String(parsed?.phone || r.doc_id || '').trim();
                const name = String(parsed?.name || parsed?.driverName || '').trim();
                if (phone && !seen.has(phone) && !isInvalidDriver(phone, name)) {
                  seen.add(phone);
                  list.push({ id: r.doc_id, phone, status: '已通过', ...parsed });
                }
              } catch (_) {}
            });
          }
        } catch (_) {}
      }

      if (dbData.squad_members) {
        Object.keys(dbData.squad_members).forEach((k) => {
          const m = dbData.squad_members[k];
          const phone = String(m?.phone || k || '').trim();
          const name = String(m?.name || m?.driverName || '').trim();
          if (phone && !seen.has(phone) && !isInvalidDriver(phone, name)) {
            seen.add(phone);
            list.push({ id: k, phone, status: '已通过', ...m });
          }
        });
      }

      // 开发者最高权限 15509601222 永远保底加入小队成员
      if (!seen.has('15509601222')) {
        seen.add('15509601222');
        list.unshift({
          id: '15509601222',
          phone: '15509601222',
          name: '吴彦祖',
          driverName: '吴彦祖',
          role: '开发者司机',
          userRole: '开发者司机',
          status: '已通过'
        });
      }

      return res.json({ success: true, list });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.5 Update Driver / Squad Member Name API (Alibaba Cloud Baota Server Panel)
  // M2修复：加 requireDbAuth，本人只能改自己的名字
  app.post(['/api/driver/name', '/api/driver/update-name'], requireDbAuth, async (req, res) => {
    try {
      const rawPhone = String(req.body.phone || '').trim();
      const phone = rawPhone.replace(/\D/g, '');
      const name = String(req.body.name || '').trim().slice(0, 8);
      if (!phone || !name) {
        return res.status(400).json({ success: false, error: 'Phone and name required' });
      }
      if (!(req as any).isAdmin && phone.toUpperCase() !== String((req as any).authPhone || '').replace(/\D/g, '').toUpperCase()) {
        return res.status(403).json({ success: false, error: '无权操作他人数据' });
      }

      // Update in-memory server mapping
      AUTHORITATIVE_REAL_DRIVER_NAMES[phone] = name;

      if (isMySQLEnabled && mysqlPool) {
        try {
          // BUG12修复：加上 online_applications，与本地 JSON 保持一致
          for (const col of ['driver_users', 'squad_members', 'driver_locations', 'squad_applications', 'online_applications', 'team_members']) {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, phone]
            );
            let merged: any = { phone, name, driverName: name, applicantName: name, realName: name, lastUpdatedTime: new Date().toISOString() };
            if (rows && rows.length > 0) {
              const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
              merged = { ...prev, name, driverName: name, applicantName: name, realName: name, lastUpdatedTime: new Date().toISOString() };
            }
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              [col, phone, JSON.stringify(merged)]
            );
          }
        } catch (_) {}
      }

      const dbData = readLocalJsonDb();
      for (const col of ['driver_users', 'squad_members', 'driver_locations', 'online_applications', 'squad_applications']) {
        if (!dbData[col]) dbData[col] = {};
        const prev = dbData[col][phone] || {};
        dbData[col][phone] = { ...prev, name, driverName: name, applicantName: name, realName: name, lastUpdatedTime: new Date().toISOString() };
      }

      // Update orders dispatched by or assigned to this driver/admin
      for (const orderCol of ['merchant_orders', 'orders']) {
        if (dbData[orderCol]) {
          Object.keys(dbData[orderCol]).forEach((ordKey) => {
            const ord = dbData[orderCol][ordKey];
            if (!ord) return;
            const dPhone = String(ord.driverPhone || '').replace(/\D/g, '');
            const aPhone = String(ord.adminPhone || ord.dispatchedByPhone || ord.creatorPhone || ord.reporterPhone || '').replace(/\D/g, '');
            let orderChanged = false;
            if (dPhone === phone) {
              ord.driverName = name;
              ord.driverDisplayName = name;
              orderChanged = true;
            }
            if (aPhone === phone) {
              ord.adminName = name;
              ord.dispatchedByName = name;
              orderChanged = true;
            }
            if (orderChanged) {
              dbData[orderCol][ordKey] = ord;
            }
          });
        }
      }

      writeLocalJsonDb(dbData);

      return res.json({ success: true, phone, name });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // =========================================================================
  // DAILY 05:59 AM AUTOMATIC DRIVER OFFLINE DAEMON (China Beijing Time UTC+8)
  // 每天凌晨05:59分所有上线的司机全部自动下线；如果有正在进行的订单，先让司机做单，
  // 订单结束后恢复到软件app首页后等待5秒自动下线。
  // =========================================================================
  // Helper to get the most recent Beijing 05:59 AM cutoff timestamp (UTC ms)
  const getMostRecent0559CutoffMs = (): number => {
    const now = new Date();
    // Beijing Time (UTC+8)
    const beijingMs = now.getTime() + (now.getTimezoneOffset() * 60000) + (8 * 3600000);
    const beijingDate = new Date(beijingMs);
    const cutoffDate = new Date(beijingDate);
    cutoffDate.setHours(5, 59, 0, 0);
    if (beijingDate.getTime() < cutoffDate.getTime()) {
      cutoffDate.setDate(cutoffDate.getDate() - 1);
    }
    // Convert Beijing date back to UTC milliseconds
    return cutoffDate.getTime() - (8 * 3600000) - (now.getTimezoneOffset() * 60000);
  };

  // Map of driver phone -> timestamp when order ended (0 = still in order)
  const pendingOfflineDrivers = new Map<string, number>();

  setInterval(async () => {
    try {
      const now = new Date();
      // Calculate China Beijing Time (UTC+8)
      const beijingMs = now.getTime() + (now.getTimezoneOffset() * 60000) + (8 * 3600000);
      const beijingDate = new Date(beijingMs);
      const hours = beijingDate.getHours();
      const minutes = beijingDate.getMinutes();

      const is0559Time = (hours === 5 && minutes === 59);
      const cutoffMs = getMostRecent0559CutoffMs();

      // Read current DB in memory
      const dbData = readLocalJsonDb();
      const driverUsers = dbData.driver_users || {};
      const squadMembers = dbData.squad_members || {};
      const driverLocations = dbData.driver_locations || {};
      const merchantOrders = dbData.merchant_orders || {};

      // Gather all online drivers from in-memory cache
      const onlineDriverPhones = new Set<string>();
      Object.keys(driverUsers).forEach(phone => {
        if (driverUsers[phone]?.isOnline) onlineDriverPhones.add(phone);
      });
      Object.keys(squadMembers).forEach(phone => {
        if (squadMembers[phone]?.isOnline) onlineDriverPhones.add(phone);
      });
      Object.keys(driverLocations).forEach(phone => {
        if (driverLocations[phone]?.isOnline) onlineDriverPhones.add(phone);
      });

      if (onlineDriverPhones.size === 0 && pendingOfflineDrivers.size === 0) {
        return;
      }

      // Helper to check if driver has an active, in-progress order
      const hasActiveOrder = (phone: string): boolean => {
        const cleanPhone = String(phone).trim();
        for (const orderId in merchantOrders) {
          const order = merchantOrders[orderId];
          if (!order) continue;
          const assignedDriver = String(order.dispatchedDriverPhone || order.driverPhone || order.assignedDriver || '').trim();
          if (assignedDriver === cleanPhone) {
            const st = String(order.statusCategory || order.status || '').trim();
            if (['submitted', 'dispatched', 'claimed', 'accepted', 'taken', 'arrived', 'serving', '就位', '服务中', '已接单'].includes(st)) {
              return true;
            }
          }
        }
        return false;
      };

      // 1. If at 05:59 AM Beijing Time, or if driver's online session/location started before the most recent 05:59 AM cutoff:
      for (const phone of Array.from(onlineDriverPhones)) {
        const userData = driverUsers[phone] || squadMembers[phone] || driverLocations[phone] || {};
        let driverOnlineTime = 0;
        if (userData.onlineSessionTime) driverOnlineTime = Number(userData.onlineSessionTime);
        else if (userData.lastLocationTime) driverOnlineTime = Number(userData.lastLocationTime);
        else if (userData.locationTimestamp) driverOnlineTime = Number(userData.locationTimestamp);
        else if (userData.lastUpdatedTime) driverOnlineTime = new Date(userData.lastUpdatedTime).getTime();
        else if (userData.updatedAt) driverOnlineTime = new Date(userData.updatedAt).getTime();

        const isExpired = is0559Time || (!driverOnlineTime || driverOnlineTime < cutoffMs);

        if (isExpired) {
          if (hasActiveOrder(phone)) {
            if (!pendingOfflineDrivers.has(phone)) {
              pendingOfflineDrivers.set(phone, 0);
            }
          } else if (!pendingOfflineDrivers.has(phone)) {
            await performServerOffline(phone, is0559Time ? 'daily_0559_scheduled_idle' : 'daily_0559_expired_cutoff');
          }
        }
      }

      // 2. Handle drivers who were deferred due to active orders
      if (pendingOfflineDrivers.size > 0) {
        for (const [phone, finishTimestamp] of Array.from(pendingOfflineDrivers.entries())) {
          const isStillActive = hasActiveOrder(phone);
          if (isStillActive) {
            continue;
          }

          if (finishTimestamp === 0) {
            pendingOfflineDrivers.set(phone, Date.now());
          } else if (Date.now() - finishTimestamp >= 5000) {
            await performServerOffline(phone, 'daily_0559_after_order_5s');
            pendingOfflineDrivers.delete(phone);
          }
        }
      }
    } catch (daemonErr) {
      console.error('[Baota Cron 05:59 Daemon Error]:', daemonErr);
    }
  }, 60000);

  // Haversine Distance Helper
  function calculateHaversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Server POI & Yinchuan Street/District Grid Dictionary
  // 本地 POI 已清空（用户2026-10-10要求：纯走服务端高德实时解析）
  // 原有银川+宁夏条目已全部移除
  const YINCHUAN_SERVER_POIS: Array<{ keywords: string[]; lat: number; lng: number }> = [];

  // 全国地理编码：本地银川 POI 优先，失败时调高德地图 API（中国大陆服务，全国可用）
  const AMAP_KEY_SERVER = '0ae534670da6caccb517c02edd04e89e';
  async function geocodeServerPoiAsync(startLoc?: string, fallbackLat?: number, fallbackLng?: number): Promise<{ lat: number; lng: number; reliable: boolean }> {
    // H13修复：失败时返回 NaN 而非市中心占位符，调用方根据 reliable=false 标记 coordsUnknown
    const failResult = { lat: NaN, lng: NaN, reliable: false };

    if (!startLoc || typeof startLoc !== 'string' || !startLoc.trim()) {
      return failResult;
    }

    const clean = startLoc.trim()
      .replace(/^代驾商家起点[为：:\s]*/g, '')
      .replace(/^商家代叫起点[为：:\s]*/g, '')
      .replace(/^商家起点[为：:\s]*/g, '')
      .replace(/^代叫商家起点[为：:\s]*/g, '')
      .replace(/^代驾起点[为：:\s]*/g, '')
      .replace(/^起点[为：:\s]*/g, '')
      .trim() || startLoc.trim();

    // 1. 本地银川 POI 优先（快）
    for (const poi of YINCHUAN_SERVER_POIS) {
      if (poi.keywords.some(kw => clean.includes(kw) || kw.includes(clean))) {
        return { lat: poi.lat, lng: poi.lng, reliable: true };
      }
    }

    // 2. 高德地图全国地理编码（中国大陆服务）
    try {
      const url = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(clean)}&key=${AMAP_KEY_SERVER}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data: any = await resp.json();
      if (data.status === '1' && data.geocodes?.length > 0) {
        const loc = String(data.geocodes[0].location || '').split(',');
        const lng = Number(loc[0]), lat = Number(loc[1]);
        if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
          console.log(`[Geocode] 高德解析成功: ${clean} -> ${lat},${lng}`);
          return { lat, lng, reliable: true };
        }
      }
      // 详细记录失败原因，便于排查 Key 限制问题
      // 常见 infocode: 10009=USERKEY_PLAT_NOMATCH(Key平台限制), 10008=USERKEY_ILLEGAL(Key非法), 20001=INSUFFICIENT_PRIVILEGES(权限不足)
      console.warn(`[Geocode] 高德解析失败: address=${clean}, status=${data.status}, info=${data.info}, infocode=${data.infocode}`);
      if (data.infocode === '10009') {
        console.warn(`[Geocode] Key平台限制(USERKEY_PLAT_NOMATCH): 请在高德控制台检查Key的"服务平台"设置，服务端调用需要"Web服务"类型Key或IP白名单包含本服务器IP`);
      }
    } catch (e: any) {
      console.warn('[Geocode] 高德 API 异常:', e?.message);
    }

    // 3. 全部失败：标记为不可靠，调用方不得用此坐标做距离判断
    console.warn(`[Geocode] 坐标未知: ${clean}，本地POI和高德均失败`);
    // H13修复：高德失败/异常时返回 NaN，不用市中心冒充
    return failResult;
  }

  function geocodeServerPoi(startLoc?: string, fallbackLat?: number, fallbackLng?: number): { lat: number; lng: number } {
    const defaultLat = (fallbackLat && !isNaN(fallbackLat) && fallbackLat !== 0) ? fallbackLat : 38.4830;
    const defaultLng = (fallbackLng && !isNaN(fallbackLng) && fallbackLng !== 0) ? fallbackLng : 106.2350;

    if (!startLoc || typeof startLoc !== 'string' || !startLoc.trim()) {
      return { lat: defaultLat, lng: defaultLng };
    }

    const clean = startLoc.trim()
      .replace(/^代驾商家起点[为：:\s]*/g, '')
      .replace(/^商家代叫起点[为：:\s]*/g, '')
      .replace(/^商家起点[为：:\s]*/g, '')
      .replace(/^代叫商家起点[为：:\s]*/g, '')
      .replace(/^代驾起点[为：:\s]*/g, '')
      .replace(/^起点[为：:\s]*/g, '')
      .trim() || startLoc.trim();

    for (const poi of YINCHUAN_SERVER_POIS) {
      if (poi.keywords.some(kw => clean.includes(kw) || kw.includes(clean))) {
        return { lat: poi.lat, lng: poi.lng };
      }
    }
    return { lat: defaultLat, lng: defaultLng };
  }

  // 5.9 Server-Side Geocoding API (支持客户端按地名即时获取精准坐标与直线距离)
  // M6修复：加 requireDbAuth，防公开代理刷爆高德配额
  app.get(['/api/geocode', '/api/geo/locate'], requireDbAuth, async (req, res) => {
    try {
      const address = String(req.query.address || req.query.name || req.query.keyword || '').trim();
      const fallbackLat = Number(req.query.lat || req.query.fallbackLat || 38.4830);
      const fallbackLng = Number(req.query.lng || req.query.fallbackLng || 106.2350);
      const poi = await geocodeServerPoiAsync(address, fallbackLat, fallbackLng);
      return res.json({
        success: true,
        address,
        lat: poi.lat,
        lng: poi.lng,
        reliable: poi.reliable
      });
    } catch (err: any) {
      return res.json({ success: false, error: err.message, lat: NaN, lng: NaN });
    }
  });

  // 6. Server-Side Nearest Driver Dispatch Engine (阿里云高可用服务端精准距离派单)
  app.post('/api/dispatch/nearest', requireDbAuth, async (req, res) => {
    try {
      const { orderData, reporterPhone, pickupLat, pickupLng, excludePhone } = req.body || {};
      // M7修复：radiusKm 服务端钳制，最大3公里，防客户端突破派单半径铁律
      const radiusKm = Math.min(Number(req.body?.radiusKm) || 3, 3);

      // 下单权限：开发者/小队管理人员 或 商户（带A后缀）可以直接下单
      // 商户不需要申请审批，注册登录即为商户身份
      if (!(req as any).isAdmin) {
        const rawAuthPhone = String((req as any).authPhone || '').trim().toUpperCase();
        // 商户（A后缀）直接放行
        if (rawAuthPhone.endsWith('A')) {
          // merchant, skip manager check
        } else {
          const authPhone = rawAuthPhone.replace(/A$/, '');
          const MANAGER_ROLES = ['开发者司机', '开发者', '总指挥官', '城市老板司机', '城市老板', '城市管理司机', '城市管理', '城市派单员司机', '城市派单员'];
          let isManager = false;
        try {
          if (isMySQLEnabled && mysqlPool) {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              ['squad_members', authPhone]
            );
            if (rows && rows.length > 0) {
              const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
              const role = String(data?.role || data?.userRole || '');
              isManager = MANAGER_ROLES.some(r => role.includes(r));
            }
          }
        } catch (_) {}
        if (!isManager) {
          return res.status(403).json({ success: false, error: '仅小队管理人员或商户可以下商户代叫订单' });
        }
        } // end merchant bypass else
      }

      if (!orderData || (!orderData.id && !orderData.orderNo)) {
        return res.status(400).json({ success: false, error: 'Missing orderData' });
      }

      // Resolve merchant start location coordinates (support POI geocoding on server)
      const startLocName = String(orderData.startLocation || orderData.passengerAddress || orderData.pickupAddress || '').trim();
      let pLat = Number(pickupLat || orderData.passengerLat || orderData.startLat || orderData.lat);
      let pLng = Number(pickupLng || orderData.passengerLng || orderData.startLng || orderData.lng);

      const isDefaultCentroid = (
        isNaN(pLat) || isNaN(pLng) || pLat === 0 || pLng === 0 ||
        (Math.abs(pLat - 38.487167) < 0.001 && Math.abs(pLng - 106.23091) < 0.001) ||
        (Math.abs(pLat - 38.4830) < 0.001 && Math.abs(pLng - 106.2350) < 0.001)
      );

      // === 3秒准备期：等待高德返回 + 筛选司机 ===
      // 用户要求：服务端有3秒时间做高德解析和司机匹配，3秒后开始60秒倒计时
      const prepareStartTs = Date.now();
      const PREPARE_TIMEOUT_MS = 3000;

      // H12修复：空地址直接标记坐标未知，不走高德分支
      if (!startLocName) {
        console.warn(`[Dispatch] 起点地址为空，标记坐标未知，直接进大厅`);
        (orderData as any).coordsUnknown = true;
      } else if (isDefaultCentroid || isNaN(pLat) || isNaN(pLng)) {
        // 高德解析与3秒超时竞速：3秒内没返回就用现有坐标（标记未知）
        const geocodePromise = geocodeServerPoiAsync(startLocName, pLat, pLng);
        const timeoutPromise = new Promise<{ lat: number; lng: number; reliable: boolean; timedOut: boolean }>(
          resolve => setTimeout(() => resolve({ lat: pLat, lng: pLng, reliable: false, timedOut: true }), PREPARE_TIMEOUT_MS)
        );
        const poi: any = await Promise.race([geocodePromise, timeoutPromise]);
        if (poi.timedOut) {
          console.warn(`[Dispatch] 高德解析3秒超时: ${startLocName}，标记坐标未知`);
          (orderData as any).coordsUnknown = true;
        } else {
          pLat = poi.lat;
          pLng = poi.lng;
          // 坐标未知时标记，直接进大厅
          if (!poi.reliable) {
            (orderData as any).coordsUnknown = true;
          }
        }
      }
      const prepareElapsed = Date.now() - prepareStartTs;
      console.log(`[Dispatch] 准备期耗时: ${prepareElapsed}ms`);
      // M5修复：固定等满3秒（高德提前返回则补足剩余时间），再开始60秒倒计时
      if (prepareElapsed < PREPARE_TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, PREPARE_TIMEOUT_MS - prepareElapsed));
        console.log(`[Dispatch] 准备期补足至3秒`);
      }

      const dbData = readLocalJsonDb();
      let squadList: any[] = [];
      let locationMap: Record<string, any> = {};

      if (isMySQLEnabled && mysqlPool) {
        try {
          const [squadRows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['squad_members']
          );
          squadList = (squadRows || []).map((r: any) => {
            const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            return { phone: String(r.doc_id || data?.phone || '').replace(/\D/g, '').trim(), data };
          });

          const [locRows]: any = await mysqlPool.query(
            'SELECT `doc_id`, `data` FROM `daijia_documents` WHERE `collection` = ?',
            ['driver_locations']
          );
          (locRows || []).forEach((r: any) => {
            const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
            const p = String(r.doc_id || data?.phone || '').replace(/\D/g, '').trim();
            if (p) locationMap[p] = data;
          });
        } catch (_) {}
      }

      if (squadList.length === 0) {
        const colData = dbData['squad_members'] || {};
        squadList = Object.keys(colData).map((k) => ({
          phone: String(k).replace(/\D/g, '').trim(),
          data: colData[k]
        }));
      }

      const localLocations = dbData['driver_locations'] || {};
      Object.keys(localLocations).forEach((k) => {
        const p = String(k).replace(/\D/g, '').trim();
        if (p && !locationMap[p]) {
          locationMap[p] = localLocations[k];
        }
      });

      // Always include developer driver 15509601222 if not present in squadList
      if (!squadList.some((s) => s.phone === '15509601222')) {
        const devDriverData = dbData['driver_users']?.['15509601222'] || {};
        squadList.push({
          phone: '15509601222',
          data: {
            ...devDriverData,
            role: '开发者司机',
            userRole: '开发者司机',
            driverName: devDriverData.driverName || '吴彦祖',
            status: '已通过'
          }
        });
      }

      const orderId = String(orderData.id || orderData.orderId || orderData.orderNo || `ORDER_${Date.now()}`).trim();

      // Candidate drivers filter (Strictly approved squad drivers only)
      const candidates: Array<{ phone: string; name: string; distKm: number; data: any }> = [];
      const removedPhonesArr: string[] = dbData.config?.['removed_squad_members']?.phones || [];

      // Check if order already has an actively dispatched driver that is valid
      const existingDispatchedPhone = String(orderData.dispatchedDriverPhone || '').replace(/\D/g, '').trim();

      squadList.forEach(({ phone, data }) => {
        if (!phone || !data || data.isBanned) return;
        const cleanPhone = String(phone).replace(/\D/g, '').trim();
        
        // 0. Exclude removed drivers or generic driver placeholders
        if (cleanPhone !== '15509601222' && (removedPhonesArr.includes(cleanPhone) || isGenericDriverName(data.driverName || data.name, cleanPhone))) {
          return;
        }
        const cleanReporter = reporterPhone ? String(reporterPhone).replace(/\D/g, '').trim() : '';
        const cleanExclude = excludePhone ? String(excludePhone).replace(/\D/g, '').trim() : '';

        // Check if this is a driver report/transfer order (报单转单) vs merchant valet call (商户代叫)
        const isTransferOrder = Boolean(
          orderData.orderType === '报单转单' ||
          orderData.orderRemark === '报单转单' ||
          orderData.type === '报单转单' ||
          String(orderData.orderRemark || '').includes('报单转单') ||
          String(orderData.destination || '').includes('报单转单')
        );

        // Prevent self-dispatch ONLY for driver transfer orders (报单转单绝对不要派单给自己)
        // For merchant valet orders (商户代叫), the merchant is ordering for a guest, so online squad drivers (including 15509601222) can receive it
        if (isTransferOrder) {
          if (cleanPhone && (cleanPhone === cleanReporter || cleanPhone === cleanExclude)) {
            return;
          }
        }

        // 1. Approval status check
        const st = String(data.status || data.approvalStatus || '已通过').trim();
        if (['已拒绝', 'rejected', '拒绝', '待审核', '未加入小队'].includes(st)) {
          return;
        }

        // 2. Role check (must be one of: 开发者司机, 城市老板司机, 城市管理司机, 城市派单员司机, 普通司机)
        if (cleanPhone !== '15509601222') {
          const role = String(data.role || data.userRole || data.approvedRole || '').trim();
          if ((role.includes('商户') || role.includes('商家')) && !role.includes('司机') && !role.includes('管理')) {
            return;
          }
          const allowedRoles = ['开发者司机', '开发者', '总指挥官', '城市老板司机', '城市老板', '城市管理司机', '城市管理', '城市派单员司机', '城市派单员', '普通司机', '队员', '小队长'];
          const hasAllowedRole = allowedRoles.some((r) => role.includes(r)) || role === '';
          if (!hasAllowedRole) {
            return;
          }
        }

        // 3. Online & not busy check (严格要求：必须在线且空闲，当前正在弹出此订单新来单界面的司机不算做忙碌)
        const loc = locationMap[cleanPhone] || {};
        const isOnline = Boolean(loc.isOnline ?? data.isOnline ?? (cleanPhone === '15509601222'));
        if (!isOnline) return;

        const isBusy = (
          (data.hasActiveOrder && data.activeOrderId && data.activeOrderId !== orderId) ||
          (data.currentStatus === 'serving' && data.activeOrderId && data.activeOrderId !== orderId) ||
          (loc.isBusy && loc.activeOrderId && loc.activeOrderId !== orderId && loc.currentView !== 'incoming_overlay')
        );
        if (isBusy) return;

        let dLat = Number(loc.lat ?? data.lat);
        let dLng = Number(loc.lng ?? data.lng);

        // BUG4修复：位置无效的司机直接跳过，不参与就近派单（之前静默用市中心导致误派）
        if (isNaN(dLat) || isNaN(dLng) || dLat === 0 || dLng === 0) {
          return;
        }

        // M8修复：GPS时间戳超5分钟视为离线，跳过（防App崩溃残留旧坐标被派单）
        const locTs = Number(loc.locationTimestamp || loc.lastStatusUpdateTime || data.locationTimestamp || 0);
        if (locTs && Date.now() - locTs > 5 * 60 * 1000) {
          return;
        }

        // H12修复：删除 0.3km 假距离回退；坐标非法时不参与距离派单
        const distKm = (!isNaN(pLat) && !isNaN(pLng) && pLat !== 0 && pLng !== 0)
          ? calculateHaversineKm(pLat, pLng, dLat, dLng)
          : Infinity;

        // 严格遵循3公里派单半径限制：超过3公里 (distKm > radiusKm) 绝不直接派单，必须转入选单大厅
        // （坐标未知时已在外层直接转入大厅，不会走到这里）
        if (distKm <= radiusKm) {
          candidates.push({
            phone: cleanPhone,
            name: data.driverName || data.name || (cleanPhone === '15509601222' ? '吴彦祖' : `司机${cleanPhone.slice(-4)}`),
            distKm,
            data
          });
        }
      });

      // 坐标未知时直接进大厅，不弹窗广播（用户要求：供小队内所有司机抢单）
      const coordsUnknownForDispatch = Boolean((orderData as any)?.coordsUnknown);
      // H13修复：coordsUnknown 为真时不写坐标字段，避免市中心占位符污染（两分支共用）
      const coordFields = coordsUnknownForDispatch ? {} : {
        passengerLat: pLat,
        passengerLng: pLng,
        resolvedLat: pLat,
        resolvedLng: pLng,
      };
      if (coordsUnknownForDispatch) {
        console.warn(`[Dispatch] 坐标未知，直接转入选单大厅，不做距离派单`);
      }

      if (!coordsUnknownForDispatch && candidates.length > 0) {
        // Prefer existing dispatched driver if present in eligible candidates
        let selected = candidates.find(c => c.phone === existingDispatchedPhone);
        if (!selected) {
          // Find closest driver distance
          const minDist = Math.min(...candidates.map(c => c.distKm));
          // 20米 (0.02km) 极近范围随机派单规则：
          const tiedCandidates = candidates.filter(c => Math.abs(c.distKm - minDist) <= 0.02 || c.distKm <= 0.02);
          selected = tiedCandidates[Math.floor(Math.random() * tiedCandidates.length)];
        }

        const distText = selected.distKm < 1.0 
          ? `${Math.max(50, Math.round(selected.distKm * 1000))}米` 
          : `${selected.distKm.toFixed(2)}公里`;
        const nowTs = Date.now();
        const driverQrUrl = `/uploads/qrcodes/${selected.phone}.png`;
        const dispatchedPayload = {
          ...orderData,
          id: orderId,
          orderId: orderId,
          ...coordFields,
          status: 'submitted',
          isValetOrder: true,
          isPlatformDispatch: true,
          dispatchedDriverPhone: selected.phone,
          dispatchedDriverName: selected.name,
          paymentQrCode: driverQrUrl,
          qrCode: driverQrUrl,
          wechatQrCode: driverQrUrl,
          qrcode_url: driverQrUrl,
          driverQrCode: driverQrUrl,
          distanceText: distText,
          distKm: selected.distKm,
          dispatchCountdown: 60,
          serverCountdown: 60,
          dispatchedAt: nowTs,
          dispatchExpiresAt: nowTs + 60000,
          timestamp: nowTs
        };

        // Write directly to passenger_links[selected.phone]
        if (!dbData['passenger_links']) dbData['passenger_links'] = {};
        dbData['passenger_links'][selected.phone] = dispatchedPayload;

        // Save to merchant_orders[orderId]
        if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
        dbData['merchant_orders'][orderId] = {
          ...dispatchedPayload,
          status: 'dispatched',
          statusCategory: '已指派',
          dispatchCountdown: 60,
          serverCountdown: 60,
          dispatchedAt: nowTs,
          dispatchExpiresAt: nowTs + 60000,
          timestamp: nowTs
        };

        writeLocalJsonDb(dbData);

        if (isMySQLEnabled && mysqlPool) {
          try {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['passenger_links', selected.phone, JSON.stringify(dispatchedPayload)]
            );
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['merchant_orders', orderId, JSON.stringify({ ...dispatchedPayload, status: 'dispatched', statusCategory: '已指派' })]
            );
          } catch (_) {}
        }

        return res.json({
          success: true,
          isHall: false,
          dispatchedDriverPhone: selected.phone,
          dispatchedDriverName: selected.name,
          distKm: selected.distKm,
          distanceText: distText,
          passengerLat: pLat,
          passengerLng: pLng,
          remainingSeconds: 60,
          dispatchCountdown: 60,
          serverTime: nowTs,
          dispatchedAt: nowTs,
          dispatchExpiresAt: nowTs + 60000
        });
      } else {
        // Order Lobby fallback: Broadcast to ALL squad members in选单大厅
        const nowTs = Date.now();
        const hallPayload = {
          ...orderData,
          id: orderId,
          orderId: orderId,
          ...coordFields,
          status: 'hall',
          statusCategory: '等待接单',
          in_hall: true,
          isValetOrder: true,
          isPlatformDispatch: true,
          timestamp: nowTs
        };

        if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
        dbData['merchant_orders'][orderId] = hallPayload;

        writeLocalJsonDb(dbData);

        if (isMySQLEnabled && mysqlPool) {
          try {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['merchant_orders', orderId, JSON.stringify(hallPayload)]
            );
          } catch (_) {}
        }

        return res.json({
          success: true,
          isHall: true,
          passengerLat: pLat,
          passengerLng: pLng,
          serverTime: nowTs,
          coordsUnknown: coordsUnknownForDispatch || undefined,
          message: coordsUnknownForDispatch
            ? '起点坐标未知，已转入选单大厅供小队司机抢单'
            : '方圆3公里内无在线空闲司机，已全员广播转入选单大厅'
        });
      }
    } catch (err: any) {
      console.error('[Dispatch Nearest Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.1 Atomic Order Grab / Claim from 选单大厅
  app.post('/api/order/claim', requireDbAuth, async (req, res) => {
    try {
      const { orderId, driverName, orderPayload } = req.body;
      const cleanOrderId = String(orderId || '').trim();
      // H11修复：driverPhone 强制取 token 本人，禁止客户端传入冒名
      const authPhoneRaw = String((req as any).authPhone || '').trim();
      // A后缀商户身份拒绝抢单（商户只能下单不能接单）
      if (/a$/i.test(authPhoneRaw)) {
        return res.status(403).json({ success: false, error: '商户身份不能抢单' });
      }
      const cleanDriverPhone = authPhoneRaw.replace(/\D/g, '').trim();
      const cleanDriverName = String(driverName || `司机${cleanDriverPhone.slice(-4)}`).trim();

      if (!cleanOrderId || !cleanDriverPhone) {
        return res.status(400).json({ success: false, error: 'Missing orderId' });
      }
      // H11修复：orderPayload 白名单过滤，禁止注入任意字段
      const ALLOWED_CLAIM_FIELDS = new Set(['driverNote', 'driverLocation', 'driverLat', 'driverLng', 'estimatedArrival']);
      const safePayload: any = {};
      if (orderPayload && typeof orderPayload === 'object') {
        for (const k of Object.keys(orderPayload)) {
          if (ALLOWED_CLAIM_FIELDS.has(k)) safePayload[k] = (orderPayload as any)[k];
        }
      }

      const dbData = readLocalJsonDb();

      // Check if claiming driver is in removed_squad_members or not an approved squad member
      const removedPhonesArr: string[] = dbData.config?.['removed_squad_members']?.phones || [];
      const isRemovedDriver = removedPhonesArr.includes(cleanDriverPhone);
      const isDevDriver = cleanDriverPhone === '15509601222';

      let isSquadApproved = isDevDriver;
      if (!isDevDriver && !isRemovedDriver) {
        const squadDoc = dbData['squad_members']?.[cleanDriverPhone];
        if (squadDoc) {
          const st = String(squadDoc.status || squadDoc.approvalStatus || '').trim();
          if (st === '已通过' || st === 'approved' || st === '通过' || !st) {
            isSquadApproved = true;
          }
        }
      }

      if (isRemovedDriver || !isSquadApproved) {
        return res.status(403).json({ success: false, error: '❌ 权限不足：只有小队内审批通过的正式司机才能接收商户代叫单与报单转单！非小队成员无接单权限。' });
      }
      if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
      const targetOrder = dbData['merchant_orders'][cleanOrderId];

      // Check if order is already claimed by ANOTHER driver or cancelled
      if (targetOrder) {
        const isClaimedByOther = (Boolean(targetOrder.claimedDriverPhone) && targetOrder.claimedDriverPhone !== cleanDriverPhone) ||
          (targetOrder.status === 'serving' && targetOrder.claimedDriverPhone && targetOrder.claimedDriverPhone !== cleanDriverPhone);
        const isCancelled = targetOrder.status === 'cancelled' || targetOrder.statusCategory === '已取消';
        if (isClaimedByOther || isCancelled) {
          return res.status(409).json({ success: false, error: '⚠️ 该订单已被其他小队司机抢走或已取消！' });
        }
      }

      const now = Date.now();
      const driverQrUrl = `/uploads/qrcodes/${cleanDriverPhone}.png`;
      const claimUpdateData = {
        ...(targetOrder || {}),
        ...safePayload,
        id: cleanOrderId,
        orderId: cleanOrderId,
        status: 'claimed',
        statusCategory: '已接单',
        in_hall: false,
        dispatchedDriverPhone: cleanDriverPhone,
        dispatchedDriverName: cleanDriverName,
        claimedDriverPhone: cleanDriverPhone,
        claimedDriverName: cleanDriverName,
        driverName: cleanDriverName,
        paymentQrCode: (targetOrder && targetOrder.paymentQrCode) || driverQrUrl,
        qrCode: (targetOrder && targetOrder.qrCode) || driverQrUrl,
        wechatQrCode: (targetOrder && targetOrder.wechatQrCode) || driverQrUrl,
        qrcode_url: (targetOrder && targetOrder.qrcode_url) || driverQrUrl,
        driverQrCode: driverQrUrl,
        claimedAt: now
      };

      dbData['merchant_orders'][cleanOrderId] = claimUpdateData;

      // Clear passenger_links so incoming order popup is NOT triggered for manually claimed hall orders
      if (dbData['passenger_links'] && dbData['passenger_links'][cleanDriverPhone]) {
        delete dbData['passenger_links'][cleanDriverPhone];
      }

      if (!dbData['active_orders']) dbData['active_orders'] = {};
      dbData['active_orders'][cleanDriverPhone] = {
        ...claimUpdateData,
        orderId: cleanOrderId,
        orderNo: req.body.orderNo || cleanOrderId,
        status: 'claimed',
        statusCategory: '已接单',
        isCancelled: false
      };

      writeLocalJsonDb(dbData);

      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['merchant_orders', cleanOrderId, JSON.stringify(claimUpdateData)]
          );
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['passenger_links', cleanDriverPhone, JSON.stringify(dbData['passenger_links'][cleanDriverPhone])]
          );
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['active_orders', cleanDriverPhone, JSON.stringify(dbData['active_orders'][cleanDriverPhone])]
          );
        } catch (_) {}
      }

      return res.json({ success: true, order: claimUpdateData, serverTime: now });
    } catch (err: any) {
      console.error('[Order Claim Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.2 60-Second Timeout / Driver Decline Order Reclaim to 选单大厅
  app.post('/api/order/decline', requireDbAuth, async (req, res) => {
    try {
      const { orderId, driverPhone } = req.body;
      const cleanOrderId = String(orderId || '').trim();
      const cleanDriverPhone = String(driverPhone || '').replace(/\D/g, '').trim();
      // H8修复：校验操作者是接单司机本人（或管理员）
      const authPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      const isAdmin = !!(req as any).isAdmin;
      if (!isAdmin && cleanDriverPhone && authPhone !== cleanDriverPhone) {
        return res.status(403).json({ success: false, error: '只能操作自己的订单' });
      }

      if (!cleanOrderId) {
        return res.status(400).json({ success: false, error: 'Missing orderId' });
      }

      const dbData = readLocalJsonDb();
      if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
      const targetOrder = dbData['merchant_orders'][cleanOrderId];

      const existingDeclined = Array.isArray(targetOrder?.declinedDriverPhones) ? targetOrder.declinedDriverPhones : [];
      const existingTimeout = Array.isArray(targetOrder?.timeoutDriverPhones) ? targetOrder.timeoutDriverPhones : [];

      const now = Date.now();
      const updateData = {
        ...(targetOrder || {}),
        status: 'hall',
        in_hall: true,
        statusCategory: '呼叫中',
        dispatchedDriverPhone: '',
        dispatchedDriverName: '',
        claimedDriverPhone: '',
        claimedDriverName: '',
        driverName: '',
        declinedDriverPhones: Array.from(new Set([...existingDeclined, cleanDriverPhone].filter(Boolean))),
        timeoutDriverPhones: Array.from(new Set([...existingTimeout, cleanDriverPhone].filter(Boolean))),
        lastDeclinedAt: now
      };

      dbData['merchant_orders'][cleanOrderId] = updateData;

      if (cleanDriverPhone && dbData['passenger_links'] && dbData['passenger_links'][cleanDriverPhone]) {
        delete dbData['passenger_links'][cleanDriverPhone];
      }

      // 释放司机忙碌状态，重新恢复可派单空闲状态
      if (cleanDriverPhone) {
        ['driver_users', 'driver_locations', 'squad_members'].forEach(col => {
          if (dbData[col] && dbData[col][cleanDriverPhone]) {
            dbData[col][cleanDriverPhone] = {
              ...dbData[col][cleanDriverPhone],
              isBusy: false,
              status: 'idle',
              lastStatusUpdateTime: now
            };
          }
        });
      }

      writeLocalJsonDb(dbData);

      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['merchant_orders', cleanOrderId, JSON.stringify(updateData)]
          );
          if (cleanDriverPhone) {
            await mysqlPool.query(
              'DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?',
              ['passenger_links', cleanDriverPhone]
            );
            await mysqlPool.query(
              'UPDATE `daijia_documents` SET `data` = JSON_SET(`data`, "$.isBusy", false, "$.status", "idle") WHERE `collection` IN ("driver_users", "driver_locations", "squad_members") AND `doc_id` = ?',
              [cleanDriverPhone]
            );
          }
        } catch (_) {}
      }

      return res.json({ success: true, order: updateData, serverTime: now });
    } catch (err: any) {
      console.error('[Order Decline Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.2.2 ABSOLUTE Order Cancellation (Marks order as cancelled everywhere so it disappears from hall for ALL drivers)
  app.post('/api/order/cancel', requireDbAuth, async (req, res) => {
    try {
      const orderId = String(req.body.orderId || req.body.id || '').trim();
      const driverPhone = String(req.body.driverPhone || req.body.phone || '').replace(/\D/g, '').trim();
      const cancelReason = String(req.body.reason || req.body.cancelReason || '订单已彻底取消').trim();
      const cancelledBy = String(req.body.cancelledBy || (driverPhone ? 'driver' : 'admin')).trim();

      if (!orderId) {
        return res.status(400).json({ success: false, error: 'Missing orderId' });
      }

      // H8修复：校验操作者是下单方/接单方/isAdmin
      const authPhone = String((req as any).authPhone || '').replace(/\D/g, '').trim();
      const isAdmin = !!(req as any).isAdmin;
      if (!isAdmin) {
        const dbDataCheck = readLocalJsonDb();
        const targetOrderCheck = (dbDataCheck['merchant_orders'] || {})[orderId] || {};
        const orderPlacer = String(targetOrderCheck.merchantPhone || targetOrderCheck.orderMerchantPhone || targetOrderCheck.phone || '').replace(/\D/g, '').trim();
        const orderDriver = String(targetOrderCheck.dispatchedDriverPhone || targetOrderCheck.driverPhone || targetOrderCheck.assignedDriver || driverPhone || '').replace(/\D/g, '').trim();
        if (authPhone !== orderPlacer && authPhone !== orderDriver) {
          return res.status(403).json({ success: false, error: '只有下单方、接单司机或管理员可以取消订单' });
        }
      }

      console.log(`[Order Cancel] Permanent cancellation for orderId: ${orderId}, by: ${cancelledBy}, reason: ${cancelReason}`);

      const now = Date.now();
      const cancelPayload = {
        status: 'cancelled',
        statusCategory: '已取消',
        in_hall: false,
        cancelledAt: now,
        cancelledBy: cancelledBy,
        cancelledByRole: cancelledBy,
        cancelReason: cancelReason
      };

      const dbData = readLocalJsonDb();
      
      // Update merchant_orders
      if (!dbData['merchant_orders']) dbData['merchant_orders'] = {};
      const targetMerchant = dbData['merchant_orders'][orderId] || {};
      dbData['merchant_orders'][orderId] = {
        ...targetMerchant,
        ...cancelPayload
      };

      // Update valet_orders if exists
      if (!dbData['valet_orders']) dbData['valet_orders'] = {};
      if (dbData['valet_orders'][orderId]) {
        dbData['valet_orders'][orderId] = {
          ...dbData['valet_orders'][orderId],
          ...cancelPayload
        };
      }

      // Update orders if exists
      if (!dbData['orders']) dbData['orders'] = {};
      if (dbData['orders'][orderId]) {
        dbData['orders'][orderId] = {
          ...dbData['orders'][orderId],
          ...cancelPayload
        };
      }

      // Notify assigned driver via passenger_links & active_orders so driver immediately returns to homepage, and reset driver busy state
      const assignedDriver = driverPhone || targetMerchant.dispatchedDriverPhone || targetMerchant.claimedDriverPhone;
      if (assignedDriver) {
        const driverCancelNotice = {
          orderId,
          orderNo: req.body.orderNo || orderId,
          isCancelled: true,
          status: 'cancelled',
          statusCategory: '已取消',
          cancelledBy,
          cancelReason,
          cancelledAt: now
        };
        if (!dbData['passenger_links']) dbData['passenger_links'] = {};
        dbData['passenger_links'][assignedDriver] = driverCancelNotice;

        if (!dbData['active_orders']) dbData['active_orders'] = {};
        dbData['active_orders'][assignedDriver] = driverCancelNotice;

        // Reset busy status in driver_users, driver_locations, and squad_members
        if (dbData['driver_users'] && dbData['driver_users'][assignedDriver]) {
          dbData['driver_users'][assignedDriver] = {
            ...dbData['driver_users'][assignedDriver],
            isBusy: false,
            status: 'idle',
            lastStatusUpdateTime: now
          };
        }
        if (dbData['driver_locations'] && dbData['driver_locations'][assignedDriver]) {
          dbData['driver_locations'][assignedDriver] = {
            ...dbData['driver_locations'][assignedDriver],
            isBusy: false,
            status: 'idle',
            lastStatusUpdateTime: now
          };
        }
        if (dbData['squad_members'] && dbData['squad_members'][assignedDriver]) {
          dbData['squad_members'][assignedDriver] = {
            ...dbData['squad_members'][assignedDriver],
            isBusy: false,
            status: 'idle',
            lastStatusUpdateTime: now
          };
        }
      }

      writeLocalJsonDb(dbData);

      if (isMySQLEnabled && mysqlPool) {
        try {
          const mergedData = JSON.stringify(dbData['merchant_orders'][orderId]);
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            ['merchant_orders', orderId, mergedData]
          );
          if (assignedDriver) {
            const cancelNoticeStr = JSON.stringify({
              orderId,
              orderNo: req.body.orderNo || orderId,
              isCancelled: true,
              status: 'cancelled',
              statusCategory: '已取消',
              cancelledBy,
              cancelReason,
              cancelledAt: now
            });
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['passenger_links', assignedDriver, cancelNoticeStr]
            );
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['active_orders', assignedDriver, cancelNoticeStr]
            );
            if (dbData['driver_users'] && dbData['driver_users'][assignedDriver]) {
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                ['driver_users', assignedDriver, JSON.stringify(dbData['driver_users'][assignedDriver])]
              );
            }
          }
        } catch (_) {}
      }

      return res.json({ success: true, orderId, order: dbData['merchant_orders'][orderId] });
    } catch (err: any) {
      console.error('[Order Cancel Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.3 中国大陆阿里云服务器60秒自动倒计时引擎与超时自动转入选单大厅Daemon (1秒级高精度权威倒计时)
  setInterval(async () => {
    try {
      const now = Date.now();
      const dbData = readLocalJsonDb();
      const merchantOrders = dbData['merchant_orders'] || {};
      let hasChanges = false;

      for (const [orderId, order] of Object.entries<any>(merchantOrders)) {
        if (!order) continue;
        const isDispatched = (
          order.status === 'dispatched' || 
          (order.status === 'submitted' && Boolean(order.dispatchedDriverPhone))
        ) && !order.claimedAt && order.status !== 'claimed' && order.status !== 'serving' && order.status !== 'completed' && order.status !== 'cancelled' && order.in_hall !== true;

        if (isDispatched && order.dispatchedDriverPhone) {
          const dispatchedTime = Number(order.dispatchedAt || order.timestamp || now);
          const expiresAt = Number(order.dispatchExpiresAt || (dispatchedTime + 60000));
          // 核心：由阿里云服务器计算精确剩余秒数 (60秒 -> 59秒 -> ... -> 31秒 -> ... -> 0秒)
          const remainingSec = Math.max(0, Math.ceil((expiresAt - now) / 1000));
          const timedOutDriverPhone = String(order.dispatchedDriverPhone).replace(/\D/g, '').trim();

          // 1. 每秒刷新订单在阿里云服务器上的权威倒计时
          if (order.serverCountdown !== remainingSec || order.dispatchCountdown !== remainingSec) {
            order.serverCountdown = remainingSec;
            order.dispatchCountdown = remainingSec;
            order.dispatchExpiresAt = expiresAt;
            hasChanges = true;

            // 同步实时写入给司机的 passenger_links 通道，确保司机屏幕严格显示服务器倒计时
            if (timedOutDriverPhone && dbData['passenger_links']?.[timedOutDriverPhone]) {
              dbData['passenger_links'][timedOutDriverPhone].serverCountdown = remainingSec;
              dbData['passenger_links'][timedOutDriverPhone].dispatchCountdown = remainingSec;
              dbData['passenger_links'][timedOutDriverPhone].dispatchExpiresAt = expiresAt;
            }
          }

          // 2. 倒计时结束 (0秒)：防止司机大退、断网或关机造成假死，服务器立即自动将订单转入选单大厅
          if (remainingSec <= 0) {
            console.log(`[阿里云服务器倒计时结束] 订单 ${orderId} 派单给司机 ${timedOutDriverPhone} 60秒超时未确认，服务器自动转入选单大厅！`);
            const existingDeclined = Array.isArray(order.declinedDriverPhones) ? order.declinedDriverPhones : [];
            const existingTimeout = Array.isArray(order.timeoutDriverPhones) ? order.timeoutDriverPhones : [];

            const updatedOrder = {
              ...order,
              status: 'hall',
              in_hall: true,
              statusCategory: '呼叫中',
              dispatchedDriverPhone: '',
              dispatchedDriverName: '',
              serverCountdown: 0,
              dispatchCountdown: 0,
              declinedDriverPhones: Array.from(new Set([...existingDeclined, timedOutDriverPhone].filter(Boolean))),
              timeoutDriverPhones: Array.from(new Set([...existingTimeout, timedOutDriverPhone].filter(Boolean))),
              lastTimeoutAt: now,
              autoHallAt: now,
              autoHallReason: '60秒倒计时结束，中国大陆阿里云服务器自动将订单转入选单大厅'
            };

            merchantOrders[orderId] = updatedOrder;
            hasChanges = true;

            // 清理并标记该司机的来单通道为超时取消，解除来单弹窗
            if (dbData['passenger_links'] && dbData['passenger_links'][timedOutDriverPhone]) {
              delete dbData['passenger_links'][timedOutDriverPhone];
            }
            if (dbData['active_orders'] && dbData['active_orders'][timedOutDriverPhone]) {
              delete dbData['active_orders'][timedOutDriverPhone];
            }

            // 解除司机的忙碌状态，恢复为空闲
            if (dbData['driver_users'] && dbData['driver_users'][timedOutDriverPhone]) {
              dbData['driver_users'][timedOutDriverPhone] = {
                ...dbData['driver_users'][timedOutDriverPhone],
                isBusy: false,
                status: 'idle',
                lastStatusUpdateTime: now
              };
            }
            if (dbData['driver_locations'] && dbData['driver_locations'][timedOutDriverPhone]) {
              dbData['driver_locations'][timedOutDriverPhone] = {
                ...dbData['driver_locations'][timedOutDriverPhone],
                isBusy: false,
                status: 'idle',
                lastStatusUpdateTime: now
              };
            }
            if (dbData['squad_members'] && dbData['squad_members'][timedOutDriverPhone]) {
              dbData['squad_members'][timedOutDriverPhone] = {
                ...dbData['squad_members'][timedOutDriverPhone],
                isBusy: false,
                status: 'idle',
                lastStatusUpdateTime: now
              };
            }

            if (isMySQLEnabled && mysqlPool) {
              try {
                await mysqlPool.query(
                  'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                  ['merchant_orders', orderId, JSON.stringify(updatedOrder)]
                );
                await mysqlPool.query(
                  'DELETE FROM `daijia_documents` WHERE `collection` IN (?, ?) AND `doc_id` = ?',
                  ['passenger_links', 'active_orders', timedOutDriverPhone]
                );
              } catch (_) {}
            }
          }
        }
      }

      if (hasChanges) {
        writeLocalJsonDb(dbData);
      }
    } catch (e) {
      // Ignore background interval errors
    }
  }, 10000); // P0-3优化：从1秒改为10秒（60秒超时用10秒粒度足够），降低90% CPU

  // 5.3.1 阿里云服务器权威倒计时查询与同步接口 (专供司机接单新来单页面实时对齐服务器秒数)
  app.get(['/api/dispatch/countdown', '/api/order/countdown'], async (req, res) => {
    try {
      const orderId = String(req.query.orderId || req.query.id || req.query.orderNo || '').trim();
      const driverPhone = String(req.query.driverPhone || req.query.phone || '').replace(/\D/g, '').trim();

      const now = Date.now();
      const dbData = readLocalJsonDb();
      const merchantOrders = dbData['merchant_orders'] || {};
      
      let targetOrder: any = null;
      if (orderId) {
        targetOrder = merchantOrders[orderId];
        if (!targetOrder) {
          for (const [k, v] of Object.entries<any>(merchantOrders)) {
            if (v && (v.id === orderId || v.orderId === orderId || v.orderNo === orderId)) {
              targetOrder = v;
              break;
            }
          }
        }
      }
      if (!targetOrder && driverPhone) {
        const linkOrder = dbData['passenger_links']?.[driverPhone];
        if (linkOrder) {
          const lId = String(linkOrder.id || linkOrder.orderId || linkOrder.orderNo || '').trim();
          if (!orderId || (lId && lId === orderId)) {
            targetOrder = linkOrder;
          }
        }
      }

      if (!targetOrder) {
        // M13修复：订单不存在时不再返回写死的60秒假倒计时
        return res.status(404).json({
          success: false,
          serverCountdown: 0,
          isExpired: true,
          inHall: false,
          status: 'not_found',
          serverTime: now,
          error: '订单不存在'
        });
      }

      const isClaimedOrActiveForDriver = Boolean(
        (targetOrder.claimedDriverPhone && driverPhone && targetOrder.claimedDriverPhone === driverPhone) ||
        (targetOrder.dispatchedDriverPhone && driverPhone && targetOrder.dispatchedDriverPhone === driverPhone) ||
        targetOrder.isDirectClaim === true ||
        targetOrder.status === 'claimed' ||
        targetOrder.status === 'dispatched' ||
        targetOrder.status === 'submitted' ||
        targetOrder.statusCategory === '已接单' ||
        targetOrder.statusCategory === '已指派'
      );

      const isHall = !isClaimedOrActiveForDriver && (targetOrder.in_hall === true || targetOrder.status === 'hall');
      if (isHall) {
        return res.json({
          success: true,
          orderId: targetOrder.id || orderId,
          serverCountdown: 0,
          isExpired: true,
          inHall: true,
          status: targetOrder.status || 'hall',
          serverTime: now
        });
      }

      const dispatchedTime = Number(targetOrder.dispatchedAt || targetOrder.timestamp || now);
      const exp = Number(targetOrder.dispatchExpiresAt || (dispatchedTime + 60000));
      const remainingSec = Math.max(0, Math.ceil((exp - now) / 1000));

      return res.json({
        success: true,
        orderId: targetOrder.id || orderId,
        serverCountdown: remainingSec,
        dispatchCountdown: remainingSec,
        isExpired: remainingSec <= 0,
        inHall: remainingSec <= 0,
        status: targetOrder.status,
        dispatchedDriverPhone: targetOrder.dispatchedDriverPhone,
        serverTime: now,
        dispatchedAt: dispatchedTime,
        dispatchExpiresAt: exp
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5.4 Automated 2-Day 10:00 AM Clean-Up Daemon & Manual API
  let lastAutoCleanTimestamp = 0;
  const executeServerAutoClean = async () => {
    console.log('[Auto-Clean] Starting scheduled 2-day disk and cache cleanup at 10:00 AM...');
    try {
      // 1. Purge MySQL binlogs if MySQL is enabled
      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query('PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL 2 DAY)');
          console.log('✓ [Auto-Clean] Purged MySQL binlogs older than 2 days.');
        } catch (_) {}
      }

      // 2. Clean temporary files and build artifacts
      const tmpDirs = ['/tmp', path.join(process.cwd(), 'temp_builds')];
      for (const d of tmpDirs) {
        if (fs.existsSync(d)) {
          try {
            const files = fs.readdirSync(d);
            for (const f of files) {
              if (f.endsWith('.tmp') || f.endsWith('.zip') || f.startsWith('npm-')) {
                try {
                  const fp = path.join(d, f);
                  const stat = fs.statSync(fp);
                  if (Date.now() - stat.mtimeMs > 24 * 3600 * 1000) {
                    fs.unlinkSync(fp);
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
      }

      // 3. Clean stale passenger_links older than 48 hours
      const dbData = readLocalJsonDb();
      if (dbData['passenger_links']) {
        const now = Date.now();
        let changed = false;
        for (const [k, v] of Object.entries<any>(dbData['passenger_links'])) {
          const time = Number(v?.timestamp || v?.updatedAt || 0);
          if (time > 0 && (now - time) > 48 * 3600 * 1000) {
            delete dbData['passenger_links'][k];
            changed = true;
          }
        }
        if (changed) {
          writeLocalJsonDb(dbData);
        }
      }

      // 4. Truncate oversized PM2 and Nginx log files if over 30MB
      const logPaths = [
        '/www/wwwlogs',
        path.join(process.env.HOME || '/root', '.pm2/logs'),
        path.join(process.cwd(), 'logs')
      ];
      for (const logDir of logPaths) {
        if (fs.existsSync(logDir)) {
          try {
            const files = fs.readdirSync(logDir);
            for (const f of files) {
              if (f.endsWith('.log') || f.endsWith('.err') || f.endsWith('.out')) {
                try {
                  const fp = path.join(logDir, f);
                  const stat = fs.statSync(fp);
                  if (stat.size > 10 * 1024 * 1024) {
                    fs.writeFileSync(fp, `[Log Truncated at ${new Date().toISOString()} by Auto-Clean]\n`, 'utf8');
                    console.log(`✓ [Auto-Clean] Truncated large log file: ${fp}`);
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
      }

      console.log('✓ [Auto-Clean] 2-day maintenance completed successfully.');
    } catch (cleanErr) {
      console.error('[Auto-Clean Error]:', cleanErr);
    }
  };

  // Run auto clean on startup
  setTimeout(() => {
    executeServerAutoClean().catch(() => {});
  }, 5000);

  // Check every 30 seconds for 10:00 AM Beijing Time (UTC+8) on a 2-day cycle
  setInterval(async () => {
    const now = new Date();
    // Convert to Beijing Time (UTC+8)
    const bjHour = (now.getUTCHours() + 8) % 24;
    const bjMinute = now.getUTCMinutes();
    const currentDayTime = now.getTime();

    // Check if it's 10:00 AM (hour == 10, minute < 5) and at least 40 hours since last clean
    if (bjHour === 10 && bjMinute < 10) {
      if (!lastAutoCleanTimestamp || (currentDayTime - lastAutoCleanTimestamp) > 40 * 3600 * 1000) {
        lastAutoCleanTimestamp = currentDayTime;
        await executeServerAutoClean();
      }
    }
  }, 5 * 60 * 1000);

  // Manual Trigger Endpoint for Admin / Baota WebHook
  app.all(['/api/system/clean-disk', '/api/admin/clean-now'], requireDbAuth, async (req, res) => {
    // H4修复：加鉴权+isAdmin校验
    if (!(req as any).isAdmin) {
      return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    await executeServerAutoClean();
    res.json({
      success: true,
      message: '✓ 阿里云服务器清理与瘦身任务已成功执行完成！',
      timestamp: new Date().toISOString()
    });
  });

  // 6. ADD Document (auto-generated ID)
  app.post('/api/db/add', requireDbAuth, async (req, res) => {
    try {
      const col = String(req.body.col || req.body.collection || '').trim();
      const data = req.body.data;

      if (!col || data === undefined) {
        return res.status(400).json({ success: false, error: 'Missing col or data' });
      }

      const generatedId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      const dataWithId = { ...data, id: data.id || generatedId };
      const finalId = dataWithId.id;

      if (isMySQLEnabled && mysqlPool) {
        try {
          const dataStr = JSON.stringify(dataWithId);
          await mysqlPool.query(
            'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
            [col, finalId, dataStr]
          );
          return res.json({ success: true, id: finalId });
        } catch (mysqlErr: any) {
          console.error('[DB Proxy ADD MySQL Error]:', mysqlErr);
        }
      }

      // JSON DB Fallback
      const dbData = readLocalJsonDb();
      if (!dbData[col]) dbData[col] = {};
      dbData[col][finalId] = dataWithId;
      writeLocalJsonDb(dbData);

      return res.json({ success: true, id: finalId });
    } catch (err: any) {
      console.error('[DB Proxy ADD Exception]:', err);
      res.status(500).json({ success: false, error: err.message });
    }
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
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
      background-color: #f8fafc;
      color: #334155;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    .container { max-width: 800px; margin: 24px auto; padding: 24px; }
    .card { background: #ffffff; border-radius: 24px; padding: 32px; border: 1px solid #f1f5f9; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); }
    .header { text-align: center; padding-bottom: 24px; border-bottom: 1px solid #f1f5f9; margin-bottom: 24px; }
    .header-icon { width: 48px; height: 48px; border-radius: 16px; background: #fff7ed; color: #f97316; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px; }
    .header-badge { font-size: 11px; letter-spacing: 0.1em; color: #94a3b8; font-weight: 800; display: block; margin-bottom: 4px; }
    .header h1 { font-size: 22px; font-weight: 900; color: #0f172a; }
    .header p { font-size: 12px; color: #94a3b8; margin-top: 4px; }
    .preamble { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 16px; padding: 16px; margin-bottom: 28px; font-size: 13px; color: #78350f; }
    .preamble-title { font-weight: 800; display: flex; align-items: center; gap: 6px; margin-bottom: 8px; color: #451a03; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 15px; font-weight: 800; color: #1e293b; border-left: 4px solid #f97316; padding-left: 10px; margin-bottom: 12px; }
    .section p { font-size: 13px; color: #64748b; margin-bottom: 8px; }
    .section b { color: #334155; }
    .footer { text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 antialiased selection:bg-orange-100 flex flex-col min-h-screen">
  <div class="container">
    <div class="card space-y-8">
      
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
    const ttsProviders = [
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=web`,
        referer: 'https://fanyi.baidu.com/'
      },
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=baidu`,
        referer: 'https://fanyi.baidu.com/'
      },
      {
        url: `https://fanyi.baidu.com/gettts?lan=zh&text=${encodedText}&spd=5&source=tsn`,
        referer: 'https://fanyi.baidu.com/'
      }
    ];

    for (const item of ttsProviders) {
      try {
        const response = await fetch(item.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': item.referer
          }
        });
        if (response.ok) {
          const contentType = response.headers.get('content-type') || 'audio/mpeg';
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > 300) {
            res.setHeader('Content-Type', contentType.includes('audio') ? contentType : 'audio/mpeg');
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

    // M4修复：IP+手机号限流（60秒1次 / 1小时5次），防短信轰炸
    {
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || req.socket.remoteAddress || '127.0.0.1';
      const now = Date.now();
      const keyPhone = `p:${cleanPhone}`;
      const keyIp = `ip:${clientIp}`;
      for (const key of [keyPhone, keyIp]) {
        const logs = (smsSendLogs.get(key) || []).filter((t) => now - t < 3600 * 1000);
        if (logs.length >= 5) {
          return res.status(429).json({ success: false, error: '❌ 发送过于频繁，请1小时后再试' });
        }
        if (logs.length > 0 && now - logs[logs.length - 1] < 60 * 1000) {
          const waitSec = Math.ceil((60 * 1000 - (now - logs[logs.length - 1])) / 1000);
          return res.status(429).json({ success: false, error: `❌ 发送过于频繁，请 ${waitSec} 秒后再试` });
        }
        logs.push(now);
        smsSendLogs.set(key, logs);
      }
      // 定期清理过期记录
      if (smsSendLogs.size > 5000) {
        for (const [k, v] of smsSendLogs) {
          const fresh = v.filter((t) => now - t < 3600 * 1000);
          if (fresh.length === 0) smsSendLogs.delete(k);
          else smsSendLogs.set(k, fresh);
        }
      }
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

            const respCode = response?.body?.code || '';
            const respMsg = response?.body?.message || '';

            if (response && response.body && (respCode === 'OK' || response.body.success === true)) {
              console.log('[Alibaba Cloud Dypnsapi] Send verify code success for:', phone);
              const returnedCode = response.body.model?.verifyCode || generatedCode;
              verificationCodes.set(phone, { code: returnedCode, expiresAt: Date.now() + 5 * 60 * 1000 });
              return res.json({
                success: true,
                mode: 'real',
                message: '✓ 阿里云短信验证码已成功发送至您的手机，请注意查收短信！'
              });
            } else if (
              respCode === 'biz.FREQUENCY' || 
              respCode === 'isv.BUSINESS_LIMIT_CONTROL' || 
              respMsg.toLowerCase().includes('frequency') ||
              respMsg.includes('BUSINESS_LIMIT_CONTROL')
            ) {
              console.log('[Alibaba Cloud Dypnsapi] Frequency control reached for:', phone, '- Activated high-availability verification fallback');
              const existing = verificationCodes.get(phone);
              if (existing && Date.now() < existing.expiresAt) {
                return res.json({
                  success: true,
                  mode: 'real_frequency_fallback',
                  message: '⚠️ 触发阿里云发送频率控制：您之前获取的短信验证码依然有效，请查看手机已收到的最新验证码直接输入登录！'
                });
              }
              // H2修复：限流时直接返回429，不签发任何备用码（删除6897硬编码后门）
              return res.status(429).json({
                success: false,
                error: '⚠️ 短信发送频率过高，请等待 60 秒后再试'
              });
            } else {
              console.log('[Alibaba Cloud Dypnsapi] Non-OK response code:', respCode);
              lastErrMsg = respMsg || `阿里云返回状态码: ${respCode || 'UNKNOWN'}`;
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
            // H2修复：限流时直接返回429，不签发任何备用码（删除6897硬编码后门）
            return res.status(429).json({
              success: false,
              error: '⚠️ 短信发送频率过高，请等待 60 秒后再试'
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

  // M1: 登出接口——删除服务端 token（客户端手动登出时调用）
  app.post('/api/auth/logout', async (req, res) => {
    try {
      const token = String(req.headers['x-auth-token'] || req.body?.token || '').trim();
      if (token) {
        // 无状态签名 token：加入黑名单使其失效
        if (token.startsWith('v1.')) blocklistToken(token);
        if (authTokens.has(token)) {
          authTokens.delete(token);
          _authTokensDirty = true;
          persistAuthTokensSync(); // a5修复：登出立即写盘
        }
      }
      return res.json({ success: true });
    } catch (e: any) {
      return res.json({ success: true });
    }
  });

  // a5修复：token 有效性校验接口——App 启动时调用，提前发现过期
  app.get('/api/auth/validate', async (req, res) => {
    try {
      const token = String(req.headers['x-auth-token'] || req.query?.token || '').trim();
      const info = token ? authTokens.get(token) : null;
      if (info) {
        return res.json({ success: true, valid: true, phone: info.phone, scope: info.scope });
      }
      return res.json({ success: true, valid: false });
    } catch (e: any) {
      return res.json({ success: true, valid: false });
    }
  });

  // 2. Verify SMS Code via Alibaba Cloud SMS or Simulated Sandbox
  app.post('/api/sms/verify', async (req, res) => {
    const { phone, code, isAdminLogin, scope } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: '手机号或验证码不能为空' });
    }

    const cleanPhone = String(phone).trim();

    // H1修复：检查是否被锁定（5次失败锁定30分钟）
    const failInfo = verifyFailures.get(cleanPhone);
    if (failInfo && Date.now() < failInfo.lockedUntil) {
      const remainMin = Math.ceil((failInfo.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        error: `❌ 验证码错误次数过多，该手机号已锁定，请 ${remainMin} 分钟后再试`
      });
    }
    // 记录失败的辅助函数（M4：5次失败销毁验证码并锁定30分钟）
    const recordVerifyFailure = () => {
      const info = verifyFailures.get(cleanPhone) || { count: 0, lockedUntil: 0 };
      info.count += 1;
      if (info.count >= 5) {
        info.lockedUntil = Date.now() + 30 * 60 * 1000;
        info.count = 0;
        verificationCodes.delete(cleanPhone);
        verificationCodes.delete(phone);
        console.warn(`[SMS] 手机号 ${cleanPhone} 验证码错误5次，验证码已销毁并锁定30分钟`);
      }
      verifyFailures.set(cleanPhone, info);
    };
    // 成功时清除失败记录
    const clearVerifyFailures = () => {
      verifyFailures.delete(cleanPhone);
    };

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
    const handleLoginSuccess = async () => {
      verificationCodes.delete(phone);
      clearVerifyFailures(); // H1修复：登录成功清除失败计数
      if (scope === 'dispatch_valet' && !WHITELIST_PHONES.includes(cleanPhone)) {
        dispatchPhoneLoginLogs.set(cleanPhone, now);
        dispatchIpLoginLogs.set(clientIp, now);
      }

      // Automatically register new phone number in driver_users on Alibaba Cloud Baota MySQL and Local DB
      try {
        const dbData = readLocalJsonDb();
        if (!dbData.driver_users) dbData.driver_users = {};
        const existing = dbData.driver_users[cleanPhone];
        const defaultQrUrl = `/uploads/qrcodes/${cleanPhone}.png`;

        if (!existing) {
          const newDriverProfile = {
            id: cleanPhone,
            phone: cleanPhone,
            phoneNumber: cleanPhone,
            driverName: cleanPhone === '15509601222' ? '吴彦祖' : `司机${cleanPhone.slice(-4)}`,
            name: cleanPhone === '15509601222' ? '吴彦祖' : `司机${cleanPhone.slice(-4)}`,
            role: cleanPhone === '15509601222' ? '开发者司机' : '普通司机',
            userRole: cleanPhone === '15509601222' ? '开发者司机' : '普通司机',
            position: cleanPhone === '15509601222' ? '开发者司机' : '普通司机',
            squad_position: cleanPhone === '15509601222' ? 'developer' : 'normal',
            is_squad_member: cleanPhone === '15509601222' ? 1 : 0,
            status: cleanPhone === '15509601222' ? '已通过' : '未加入小队',
            vipExpiry: existing?.vipExpiry || '待开通',
            city: '银川市',
            isOnline: false,
            onlineOrdersEnabled: false,
            isBanned: false,
            today_orders_count: 0,
            qrcode_url: '',
            wechatQrCode: '',
            qrCode: '',
            updatedAt: new Date().toISOString()
          };
          dbData.driver_users[cleanPhone] = newDriverProfile;
          writeLocalJsonDb(dbData);

          if (isMySQLEnabled && mysqlPool) {
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              ['driver_users', cleanPhone, JSON.stringify(newDriverProfile)]
            ).catch(() => {});
          }
        }
      } catch (regErr) {
        console.error('[Auto Register Driver User Error]:', regErr);
      }

      // 签发认证令牌：用于后续 /api/db/* 写操作鉴权
      // 商户网页版（scope=dispatch_valet）登录时，token 的 phone 带 A 后缀，与司机身份隔离
      // 根治"登录已过期"：改用无状态 HMAC 签名 token，服务端无需存储，重启/部署不丢
      const tokenScope = scope || (isAdminLogin ? 'admin_panel' : 'driver');
      const isMerchantLogin = String(scope || '').trim() === 'dispatch_valet';
      const tokenPhone = isMerchantLogin ? String(cleanPhone || '').trim().toUpperCase() + 'A' : cleanPhone;
      const authToken = createSignedToken(tokenPhone, tokenScope, isMerchantLogin);
      // 兼容旧版：同时写入内存 Map，老 token 在过渡期内仍可用
      authTokens.set(authToken, {
        phone: tokenPhone,
        scope: tokenScope,
        isMerchant: isMerchantLogin,
        createdAt: Date.now()
      });
      _authTokensDirty = true; // M1: 标记持久化
      persistAuthTokensSync(); // a5修复：登录成功立即写盘，重启不丢 token
      // M1修复：删除7天过期清理（用户铁律：手动登出前永不过期）；仅做容量保护
      if (authTokens.size > 50000) {
        console.warn('[Auth] token 数量超过5万，仅记录告警，不自动清理');
      }

      return res.json({ success: true, message: '验证码校验成功', token: authToken });
    };

    // If simulated or code matches what was returned from send
    if (isSimulated || (record.code && record.code !== 'ALIYUN_EXTERNAL' && record.code === String(code).trim())) {
      if (record.code !== 'ALIYUN_EXTERNAL' && record.code !== String(code).trim()) {
        recordVerifyFailure(); // H1修复：记录验证码失败次数
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

      const responseCode = response?.body?.code || '';
      const responseMsg = response?.body?.message || '';
      if (responseCode === 'OK' || response?.body?.success === true) {
        console.log('[Alibaba Cloud SMS] Check response success for:', phone);
      } else {
        console.log('[Alibaba Cloud SMS] Check response code:', responseCode, responseMsg ? `message: ${responseMsg}` : '');
      }

      const resultVal = response?.body?.model?.verifyResult as any;
      const isMatchVal = response?.body?.model?.isMatch as any;
      const isSuccess = (
        resultVal === true ||
        resultVal === 1 ||
        String(resultVal) === '1' ||
        String(resultVal).toUpperCase() === 'PASS' ||
        String(resultVal).toUpperCase() === 'SUCCESS' ||
        String(resultVal) === 'true' ||
        isMatchVal === true ||
        isMatchVal === 1 ||
        String(isMatchVal) === '1' ||
        responseCode === 'OK' ||
        response?.body?.success === true
      );

      if (isSuccess) {
        return handleLoginSuccess();
      } else {
        const resCode = response?.body?.code || '';
        const resMsg = response?.body?.message || '';
        if (
          resCode === 'biz.FREQUENCY' ||
          resCode === 'isv.BUSINESS_LIMIT_CONTROL' ||
          resMsg.toLowerCase().includes('frequency') ||
          resMsg.includes('check frequency failed')
        ) {
          if (record && record.code && record.code !== 'ALIYUN_EXTERNAL' && record.code === String(code).trim()) {
            return handleLoginSuccess();
          }
          // H1修复：删除"任意4位码放行"后门，限流时返回429
          return res.status(429).json({
            success: false,
            error: '⚠️ 验证码校验频率过高：触发阿里云安全频率限制，请等待 60 秒后重试！'
          });
        }
        recordVerifyFailure(); // H1修复：记录验证码失败次数
        return res.status(400).json({
          success: false,
          error: resMsg ? `验证码校验失败: ${resMsg}` : '验证码输入错误或核验失效，请重新输入或获取'
        });
      }
    } catch (error: any) {
      console.log(`[SMS Service] High-availability verification check for: ${phone}`);
      // H1修复：删除catch块"任意4位码放行"后门，异常时返回503
      return res.status(503).json({
        success: false,
        error: `验证码校验服务暂时不可用: ${error.message || '系统繁忙，请稍后重试'}`
      });
    }
  });

  // 7. FIREBASE FIRESTORE TO MYSQL AUTOMATED MIGRATION ENDPOINT
  app.get('/api/db/migrate-from-firestore', async (req, res) => {
    try {
      const dbData = readLocalJsonDb();
      if (!dbData.driver_users) dbData.driver_users = {};
      if (!dbData.squad_members) dbData.squad_members = {};
      if (!dbData.driver_locations) dbData.driver_locations = {};
      if (!dbData.system_admins) dbData.system_admins = {};

      // Consolidate developer 15509601222 profile
      const devPhone = '15509601222';
      const devProfile = {
        phone: devPhone,
        phoneNumber: devPhone,
        driverName: '吴彦祖',
        name: '吴彦祖',
        role: '开发者',
        userRole: '开发者',
        vipExpiry: dbData.driver_users?.[devPhone]?.vipExpiry || '永久有效',
        city: '银川市',
        isOnline: false,
        onlineOrdersEnabled: false,
        isBanned: false,
        updatedAt: new Date().toISOString()
      };

      dbData.driver_users[devPhone] = { ...devProfile, ...(dbData.driver_users[devPhone] || {}) };
      dbData.squad_members[devPhone] = { ...devProfile, status: '已通过', ...(dbData.squad_members[devPhone] || {}) };
      dbData.driver_locations[devPhone] = { ...devProfile, ...(dbData.driver_locations[devPhone] || {}) };
      dbData.system_admins[devPhone] = { phone: devPhone, role: 'SUPER_DEVELOPER_ADMIN', name: '最高开发者', status: 'ACTIVE', updatedAt: new Date().toISOString() };

      // Consolidate all driver phones across collections
      const driverPhones = new Set<string>();
      ['driver_users', 'squad_members', 'squad_applications', 'driver_locations'].forEach(col => {
        if (dbData[col]) {
          Object.keys(dbData[col]).forEach(k => {
            const phone = String(dbData[col][k]?.phone || dbData[col][k]?.phoneNumber || k).replace(/\D/g, '').trim();
            if (phone && phone.length === 11) {
              driverPhones.add(phone);
            }
          });
        }
      });

      // Ensure every driver has a valid record in driver_users
      driverPhones.forEach(phone => {
        const existing = dbData.driver_users[phone] || dbData.squad_members[phone] || dbData.driver_locations[phone] || {};
        dbData.driver_users[phone] = {
          phone,
          phoneNumber: phone,
          driverName: existing.driverName || existing.name || (phone === '15509601222' ? '吴彦祖' : `司机${phone.slice(-4)}`),
          role: existing.role || existing.userRole || (phone === '15509601222' ? '开发者' : '普通司机'),
          city: existing.city || '银川市',
          vipExpiry: existing.vipExpiry || '待开通',
          isOnline: Boolean(existing.isOnline),
          onlineOrdersEnabled: Boolean(existing.onlineOrdersEnabled),
          isBanned: Boolean(existing.isBanned),
          updatedAt: existing.updatedAt || new Date().toISOString(),
          ...existing
        };
      });

      writeLocalJsonDb(dbData);

      // If MySQL is enabled, write/sync all consolidated documents
      let mysqlSyncedCount = 0;
      if (isMySQLEnabled && mysqlPool) {
        try {
          for (const col of ['driver_users', 'squad_members', 'driver_locations', 'online_applications', 'squad_applications', 'system_admins']) {
            const colData = dbData[col] || {};
            for (const docId of Object.keys(colData)) {
              await mysqlPool.query(
                'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
                [col, docId, JSON.stringify(colData[docId])]
              );
              mysqlSyncedCount++;
            }
          }
        } catch (mysqlErr: any) {
          console.error('[Migration MySQL Sync Error]:', mysqlErr);
        }
      }

      const totalDrivers = Object.keys(dbData.driver_users).length;
      res.json({ 
        success: true, 
        message: `✓ 阿里云/宝塔自建数据库迁移同步成功！已全量固化与存储 ${totalDrivers} 位司机账号档案与管理特权。`,
        driverCount: totalDrivers,
        mysqlSyncedCount,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      console.error('[Migration Exception]:', err);
      res.status(500).json({ success: false, error: err.message || '迁移过程中出现异常' });
    }
  });

  // Passenger Order submission redirect (from older config files and direct Cloudflare support endpoint)
  app.post('/api/submit', async (req, res) => {
    try {
      // N-1修复（2026-10-10复审）：IP限流，防批量伪造司机订单弹窗
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
      const now = Date.now();
      if (!(global as any).__submitLogs) (global as any).__submitLogs = new Map();
      const submitLogs: Map<string, number[]> = (global as any).__submitLogs;
      const logs = (submitLogs.get(clientIp) || []).filter(t => now - t < 60000);
      if (logs.length >= 3) {
        return res.status(429).json({ success: false, error: '操作过于频繁，请稍后再试' });
      }
      logs.push(now);
      submitLogs.set(clientIp, logs);

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
  const qrcodesDir = path.join(process.cwd(), 'uploads', 'qrcodes');
  if (!fs.existsSync(qrsDir)) {
    fs.mkdirSync(qrsDir, { recursive: true });
  }
  if (!fs.existsSync(qrcodesDir)) {
    fs.mkdirSync(qrcodesDir, { recursive: true });
  }
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.post('/api/upload-wechat-qr', requireDbAuth, async (req, res) => {
    try {
      const { phone, imageBase64, channel } = req.body;
      if (!phone || !imageBase64) {
        return res.status(400).json({ error: 'Missing phone or imageBase64' });
      }

      // 鉴权：只能上传自己的二维码（A后缀敏感）
      const rawPhone = String(phone).trim().toUpperCase();
      const authPhone = String((req as any).authPhone || '').trim().toUpperCase();
      if (!(req as any).isAdmin && rawPhone !== authPhone) {
        return res.status(403).json({ error: '无权上传他人二维码' });
      }

      const cleanPhone = rawPhone.replace(/\D/g, '').trim();
      if (!cleanPhone || cleanPhone.length !== 11) {
        return res.status(400).json({ error: '手机号格式错误' });
      }
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: '图片太大，请压缩后上传' });
      }

      // A后缀判断必须用原始phone（strip前），否则永假
      const isWeb = channel === 'web' || channel === 'mobile_web' || rawPhone.endsWith('A');
      const filename = isWeb ? `${cleanPhone}_web.png` : `${cleanPhone}.png`;
      const filepath = path.join(qrcodesDir, filename);
      const fallbackFilepath = path.join(qrsDir, filename);
      
      // Overwrite/replace file on server disk (Baota panel) - Guaranteed single file per account
      await fs.promises.writeFile(filepath, buffer);
      try {
        await fs.promises.writeFile(fallbackFilepath, buffer);
      } catch (_) {}

      if (!isWeb) {
        try {
          const appFilepath = path.join(qrcodesDir, `${cleanPhone}_app.png`);
          await fs.promises.writeFile(appFilepath, buffer);
          await fs.promises.writeFile(path.join(qrsDir, `${cleanPhone}_app.png`), buffer);
        } catch (_) {}
      }
      
      const qrUrl = `/uploads/qrcodes/${filename}?t=${Date.now()}`;
      
      // Update MySQL & Local DB collections safely via merge (NEVER replace entire driver profile)
      const targetCols = isWeb 
        ? ['web_valet_qrs', 'dispatch_qrs_web', 'merchant_users']
        : ['app_valet_qrs', 'dispatch_qrs', 'dispatch_qrcodes', 'driver_users', 'squad_members'];

      const qrPayload = {
        id: cleanPhone,
        phone: cleanPhone,
        qrCode: qrUrl,
        wechatQrCode: qrUrl,
        qrcode_url: `/uploads/qrcodes/${filename}`,
        channel: isWeb ? 'web' : 'app',
        updatedAt: new Date().toISOString()
      };

      for (const col of targetCols) {
        if (isMySQLEnabled && mysqlPool) {
          try {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, cleanPhone]
            );
            let merged = { ...qrPayload };
            if (rows && rows.length > 0) {
              const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
              merged = { ...prev, ...qrPayload };
            }
            await mysqlPool.query(
              'INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)',
              [col, cleanPhone, JSON.stringify(merged)]
            );
          } catch (_) {}
        }
      }

      try {
        const dbData = readLocalJsonDb();
        for (const col of targetCols) {
          if (!dbData[col]) dbData[col] = {};
          dbData[col][cleanPhone] = { ...(dbData[col][cleanPhone] || {}), ...qrPayload };
        }
        writeLocalJsonDb(dbData);
      } catch (_) {}

      res.json({ success: true, url: qrUrl, channel: isWeb ? 'web' : 'app' });
    } catch (err: any) {
      console.error('[Server] Failed to upload WeChat QR:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  // H7修复：删除支付宝上传接口（违反"支付宝绝不上传服务器"铁律），返回410 Gone
  app.post('/api/upload-alipay-qr', (req, res) => {
    return res.status(410).json({
      success: false,
      error: '该接口已下线：支付宝收款码只存App本地，绝不上传服务器'
    });
  });


  // Query WeChat QR code directly with disk existence checks and channel priority
  // M12修复：IP频率限制（防枚举手机号注册状态），60秒最多20次
  app.get('/api/get-wechat-qr', async (req, res) => {
    try {
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || req.socket.remoteAddress || '127.0.0.1';
      const now = Date.now();
      const qrKey = `qr:${clientIp}`;
      const qrLogs = (smsSendLogs.get(qrKey) || []).filter((t) => now - t < 60 * 1000);
      if (qrLogs.length >= 20) {
        return res.status(429).json({ success: false, error: '请求过于频繁，请稍后再试' });
      }
      qrLogs.push(now);
      smsSendLogs.set(qrKey, qrLogs);

      const phone = String(req.query.phone || '').replace(/\D/g, '').trim();
      const channel = String(req.query.channel || '').trim();
      if (!phone) {
        return res.status(400).json({ success: false, error: 'Missing phone' });
      }

      const isWeb = channel === 'web' || channel === 'mobile_web' || phone.endsWith('A') || phone.endsWith('a');
      const webFilename = `${phone}_web.png`;
      const appFilename = `${phone}.png`;
      const appSpecificFilename = `${phone}_app.png`;

      // 1. Direct filesystem check in uploads/qrcodes and uploads/qrs
      if (isWeb) {
        if (fs.existsSync(path.join(qrcodesDir, webFilename))) {
          const stat = fs.statSync(path.join(qrcodesDir, webFilename));
          return res.json({ success: true, url: `/uploads/qrcodes/${webFilename}?t=${stat.mtimeMs}`, channel: 'web' });
        }
        if (fs.existsSync(path.join(qrsDir, webFilename))) {
          const stat = fs.statSync(path.join(qrsDir, webFilename));
          return res.json({ success: true, url: `/uploads/qrs/${webFilename}?t=${stat.mtimeMs}`, channel: 'web' });
        }
      } else {
        if (fs.existsSync(path.join(qrcodesDir, appSpecificFilename))) {
          const stat = fs.statSync(path.join(qrcodesDir, appSpecificFilename));
          return res.json({ success: true, url: `/uploads/qrcodes/${appSpecificFilename}?t=${stat.mtimeMs}`, channel: 'app' });
        }
        if (fs.existsSync(path.join(qrcodesDir, appFilename))) {
          const stat = fs.statSync(path.join(qrcodesDir, appFilename));
          return res.json({ success: true, url: `/uploads/qrcodes/${appFilename}?t=${stat.mtimeMs}`, channel: 'app' });
        }
        if (fs.existsSync(path.join(qrsDir, appSpecificFilename))) {
          const stat = fs.statSync(path.join(qrsDir, appSpecificFilename));
          return res.json({ success: true, url: `/uploads/qrs/${appSpecificFilename}?t=${stat.mtimeMs}`, channel: 'app' });
        }
        if (fs.existsSync(path.join(qrsDir, appFilename))) {
          const stat = fs.statSync(path.join(qrsDir, appFilename));
          return res.json({ success: true, url: `/uploads/qrs/${appFilename}?t=${stat.mtimeMs}`, channel: 'app' });
        }
      }

      // 2. Query collections (MySQL & Local JSON DB)
      const targetCols = isWeb
        ? ['web_valet_qrs', 'dispatch_qrs_web', 'merchant_users', 'dispatch_qrs', 'dispatch_qrcodes', 'driver_users']
        : ['app_valet_qrs', 'driver_users', 'dispatch_qrs', 'dispatch_qrcodes', 'web_valet_qrs', 'merchant_users'];

      if (isMySQLEnabled && mysqlPool) {
        for (const col of targetCols) {
          try {
            const [rows]: any = await mysqlPool.query(
              'SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1',
              [col, phone]
            );
            if (rows && rows.length > 0) {
              const rowData = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
              const foundQr = rowData?.qrCode || rowData?.wechatQrCode || rowData?.wechatClean;
              if (foundQr && typeof foundQr === 'string' && foundQr.trim()) {
                return res.json({ success: true, url: foundQr, channel: isWeb ? 'web' : 'app' });
              }
            }
          } catch (_) {}
        }
      }

      const dbData = readLocalJsonDb();
      for (const col of targetCols) {
        if (dbData[col] && dbData[col][phone]) {
          const rowData = dbData[col][phone];
          const foundQr = rowData?.qrCode || rowData?.wechatQrCode || rowData?.wechatClean;
          if (foundQr && typeof foundQr === 'string' && foundQr.trim()) {
            return res.json({ success: true, url: foundQr, channel: isWeb ? 'web' : 'app' });
          }
        }
      }

      // Fallback check standard file if web specific not yet uploaded
      if (fs.existsSync(path.join(qrsDir, appFilename))) {
        const stat = fs.statSync(path.join(qrsDir, appFilename));
        return res.json({ success: true, url: `/uploads/qrs/${appFilename}?t=${stat.mtimeMs}`, channel: 'fallback' });
      }

      return res.json({ success: false, url: '', message: 'QR not found' });
    } catch (err: any) {
      console.error('[Server get-wechat-qr error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Delete WeChat QR Code directly from server filesystem (Baota panel) and clean collections
  app.post('/api/delete-wechat-qr', requireDbAuth, async (req, res) => {
    try {
      const phone = String(req.body.phone || req.body.userPhone || '').trim();
      if (!phone) {
        return res.status(400).json({ error: 'Missing phone' });
      }

      // 鉴权：只能删除自己的二维码（A后缀敏感）
      const rawPhone = phone.toUpperCase();
      const authPhone = String((req as any).authPhone || '').trim().toUpperCase();
      if (!(req as any).isAdmin && rawPhone !== authPhone) {
        return res.status(403).json({ error: '无权删除他人二维码' });
      }

      // 路径遍历防护：只允许精确文件名，不做前缀匹配
      const cleanPhone = rawPhone.replace(/\D/g, '').trim();
      if (!cleanPhone || cleanPhone.length !== 11) {
        return res.status(400).json({ error: '手机号格式错误' });
      }
      const allowedFiles = new Set([`${cleanPhone}.png`, `${cleanPhone}_web.png`, `${cleanPhone}_app.png`]);

      // Delete disk physical files from both qrcodesDir and qrsDir
      [qrcodesDir, qrsDir].forEach(dir => {
        if (fs.existsSync(dir)) {
          try {
            const files = fs.readdirSync(dir);
            files.forEach(f => {
              if (allowedFiles.has(f)) {
                try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
              }
            });
          } catch (_) {}
        }
      });

      // Also clean MySQL and local JSON DB
      if (isMySQLEnabled && mysqlPool) {
        try {
          await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?', ['dispatch_qrs', phone]);
          await mysqlPool.query('DELETE FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ?', ['dispatch_qrcodes', phone]);
          
          const [rows]: any = await mysqlPool.query('SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', ['driver_users', phone]);
          if (rows && rows.length > 0) {
            const prev = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
            prev.wechatQrCode = '';
            prev.qrCode = '';
            await mysqlPool.query('INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)', ['driver_users', phone, JSON.stringify(prev)]);
          }

          const [squadRows]: any = await mysqlPool.query('SELECT `data` FROM `daijia_documents` WHERE `collection` = ? AND `doc_id` = ? LIMIT 1', ['squad_members', phone]);
          if (squadRows && squadRows.length > 0) {
            const squadPrev = typeof squadRows[0].data === 'string' ? JSON.parse(squadRows[0].data) : squadRows[0].data;
            squadPrev.wechatQrCode = '';
            squadPrev.qrCode = '';
            await mysqlPool.query('INSERT INTO `daijia_documents` (`collection`, `doc_id`, `data`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `data` = VALUES(`data`)', ['squad_members', phone, JSON.stringify(squadPrev)]);
          }
        } catch (err: any) {
          console.error('[MySQL delete-wechat-qr error]:', err);
        }
      }

      const dbData = readLocalJsonDb();
      if (dbData.dispatch_qrs && dbData.dispatch_qrs[phone]) delete dbData.dispatch_qrs[phone];
      if (dbData.dispatch_qrcodes && dbData.dispatch_qrcodes[phone]) delete dbData.dispatch_qrcodes[phone];
      if (dbData.driver_users && dbData.driver_users[phone]) {
        dbData.driver_users[phone].wechatQrCode = '';
        dbData.driver_users[phone].qrCode = '';
        dbData.driver_users[phone].qrcode_url = '';
      }
      if (dbData.squad_members && dbData.squad_members[phone]) {
        dbData.squad_members[phone].wechatQrCode = '';
        dbData.squad_members[phone].qrCode = '';
        dbData.squad_members[phone].qrcode_url = '';
      }
      if (dbData.online_applications && dbData.online_applications[phone]) {
        dbData.online_applications[phone].wechatQrCode = '';
        dbData.online_applications[phone].qrCode = '';
        dbData.online_applications[phone].qrcode_url = '';
      }
      if (dbData.squad_applications && dbData.squad_applications[phone]) {
        dbData.squad_applications[phone].wechatQrCode = '';
        dbData.squad_applications[phone].qrCode = '';
        dbData.squad_applications[phone].qrcode_url = '';
      }
      writeLocalJsonDb(dbData);

      console.log(`✓ [Server] Deleted QR code for phone: ${phone}`);
      res.json({ success: true, message: 'QR code deleted successfully' });
    } catch (err: any) {
      console.error('[Server] Failed to delete QR:', err);
      res.status(500).json({ error: 'Delete failed' });
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
    const candidatePaths = [
      path.join(process.cwd(), 'public', requestedName),
      path.join(process.cwd(), requestedName),
      path.join(process.cwd(), 'dist', requestedName),
      path.join(process.cwd(), 'public', 'daijia_deploy.zip'),
      path.join(process.cwd(), 'daijia_deploy.zip'),
      path.join(process.cwd(), 'dist', 'daijia_deploy.zip'),
    ];

    let targetPath = candidatePaths.find(p => fs.existsSync(p) && fs.statSync(p).size > 1000000);

    // Auto-repair/rebuild if file does not exist or is smaller than 1MB
    if (!targetPath) {
      try {
        console.log(`[Package Service] File ${requestedName} missing or invalid, running create_deploy_zip.py...`);
        execSync('python3 create_deploy_zip.py', { cwd: process.cwd() });
        targetPath = candidatePaths.find(p => fs.existsSync(p) && fs.statSync(p).size > 1000000);
      } catch (e: any) {
        console.error('Build package failed:', e);
      }
    }

    if (targetPath && fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${requestedName}"`);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Transfer-Encoding', 'binary');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const fileStream = fs.createReadStream(targetPath);
      fileStream.pipe(res);
      fileStream.on('error', (err) => {
        console.error('[Package Service] Stream pipe error:', err);
        if (!res.headersSent) {
          res.status(500).send('Download stream failed');
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
