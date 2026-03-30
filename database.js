/**
 * DATABASE.JS - Módulo de Persistencia SaaS Multi-Tenant
 * Motor: better-sqlite3 (Modo WAL)
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';    

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbDir = path.join(__dirname, 'data');
const dbPath = path.join(dbDir, 'onsatech_saas.sqlite');

if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
console.log(`💾 [DB] Conectada en modo WAL: ${dbPath}`);

// --- MIGRACIONES SILENCIOSAS ---
// Actualizamos la tabla de usuarios existente sin perder datos
try { db.exec("ALTER TABLE admin_users ADD COLUMN estado TEXT DEFAULT 'trial'"); } catch(e){}
try { db.exec("ALTER TABLE admin_users ADD COLUMN fecha_registro INTEGER"); } catch(e){}
try { db.exec("ALTER TABLE admin_users ADD COLUMN plan_expira INTEGER"); } catch(e){}
// 🔥 NUEVO: Preparamos la tubería para Stripe
try { db.exec("ALTER TABLE admin_users ADD COLUMN stripe_customer_id TEXT"); } catch(e){}
try { db.exec("ALTER TABLE admin_users ADD COLUMN stripe_subscription_id TEXT"); } catch(e){}

// --- ESQUEMA MULTI-TENANT ---
db.exec(`
    CREATE TABLE IF NOT EXISTS sesiones (
        tenantId TEXT,
        telefono TEXT,
        timestamp INTEGER,
        muted INTEGER DEFAULT 0,
        PRIMARY KEY (tenantId, telefono)
    );

    CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenantId TEXT,
        fecha TEXT,
        telefono TEXT,
        accion TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_tenant ON logs(tenantId);

    CREATE TABLE IF NOT EXISTS configuraciones (
        tenantId TEXT,
        clave TEXT,
        valor TEXT,
        PRIMARY KEY (tenantId, clave)
    );

    CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenantId TEXT,
        telefono TEXT,
        fecha TEXT,
        categoria TEXT,
        estado TEXT DEFAULT 'pendiente'
    );

    CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        tenantId TEXT,
        estado TEXT DEFAULT 'trial',
        fecha_registro INTEGER,
        plan_expira INTEGER,
        stripe_customer_id TEXT,      -- 🔥 ID del cliente en Stripe
        stripe_subscription_id TEXT   -- 🔥 ID de la suscripción activa
    );

    -- ESTRATEGIA 1: Bloqueo de N° de WhatsApp
    CREATE TABLE IF NOT EXISTS whatsapp_registrados (
        telefono TEXT PRIMARY KEY,
        tenantId TEXT,
        fecha_vinculacion INTEGER
    );

    -- ESTRATEGIA 4: Rastreo de IPs
    CREATE TABLE IF NOT EXISTS ip_registros (
        ip TEXT PRIMARY KEY,
        intentos INTEGER DEFAULT 1,
        ultimo_registro INTEGER
    );
`);

// --- CONTROLADORES DEL BOT (EXISTENTES) ---
export const getUsuario = (tenantId, telefono) => {
    try { return db.prepare('SELECT * FROM sesiones WHERE tenantId = ? AND telefono = ?').get(tenantId, telefono); } 
    catch (e) { return null; }
};

export const upsertUsuario = (tenantId, telefono, timestamp, muted = 0) => {
    try {
        return db.prepare(`
            INSERT INTO sesiones (tenantId, telefono, timestamp, muted) VALUES (?, ?, ?, ?)
            ON CONFLICT(tenantId, telefono) DO UPDATE SET timestamp = excluded.timestamp, muted = excluded.muted
        `).run(tenantId, telefono, timestamp, muted);
    } catch (e) { console.error(`❌ [DB] upsertUsuario:`, e.message); }
};

export const registrarLog = (tenantId, telefono, accion) => {
    try {
        const fecha = new Date().toLocaleString('es-MX');
        const telLimpio = telefono.replace('@c.us', '').replace('@s.whatsapp.net', '');
        return db.prepare('INSERT INTO logs (tenantId, fecha, telefono, accion) VALUES (?, ?, ?, ?)').run(tenantId, fecha, telLimpio, accion);
    } catch (e) { console.error(`❌ [DB] registrarLog:`, e.message); }
};

export const getConfig = (tenantId, clave) => {
    try {
        const row = db.prepare('SELECT valor FROM configuraciones WHERE tenantId = ? AND clave = ?').get(tenantId, clave);
        return row ? JSON.parse(row.valor) : null;
    } catch (e) { return null; }
};

export const setConfig = (tenantId, clave, valor) => {
    try {
        return db.prepare(`
            INSERT INTO configuraciones (tenantId, clave, valor) VALUES (?, ?, ?)
            ON CONFLICT(tenantId, clave) DO UPDATE SET valor = excluded.valor
        `).run(tenantId, clave, JSON.stringify(valor));
    } catch (e) { console.error(`❌ [DB] setConfig:`, e.message); }
};

// --- CONTROLADORES DE AUTENTICACIÓN SAAS ---
export const getAdminByEmail = (email) => {
    try { return db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email); } 
    catch (e) { return null; }
};

export const getAdminByTenant = (tenantId) => {
    try { return db.prepare('SELECT * FROM admin_users WHERE tenantId = ?').get(tenantId); } 
    catch (e) { return null; }
};

const initSuperAdmin = async () => {
    try {
        const { count } = db.prepare('SELECT COUNT(*) as count FROM admin_users').get();
        if (count === 0) {
            const salt = await bcrypt.genSalt(10);
            // 🔥 ADVERTENCIA: En producción, usar variables de entorno (process.env.ADMIN_PASS)
            const defaultPass = 'admin123'; 
            const hash = await bcrypt.hash(defaultPass, salt); 
            
            const expira = Date.now() + (1000 * 60 * 60 * 24 * 365 * 70); 
            
            db.prepare('INSERT INTO admin_users (email, password, tenantId, estado, fecha_registro, plan_expira) VALUES (?, ?, ?, ?, ?, ?)')
              .run('admin@onsatech.com.mx', hash, 'onsa_dev_01', 'pagado', Date.now(), expira);
            console.log('🔐 Bóveda sellada. SuperAdmin creado.');
            console.log(`⚠️ IMPORTANTE: Recuerda cambiar la contraseña del SuperAdmin en producción.`);
        } else {
            console.log(`✅ Seguridad activa: La base de datos contiene ${count} administrador(es).`);
        }
    } catch (e) {}
};
initSuperAdmin();

// --- NUEVOS CONTROLADORES DE SEGURIDAD Y ABUSO ---

export const registrarNuevoCliente = async (email, passwordTexto, tenantId) => {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(passwordTexto, salt);
    
    const ahora = Date.now();
    const expira = ahora + (7 * 24 * 60 * 60 * 1000); 
    
    return db.prepare('INSERT INTO admin_users (email, password, tenantId, estado, fecha_registro, plan_expira) VALUES (?, ?, ?, ?, ?, ?)')
             .run(email, hash, tenantId, 'trial', ahora, expira);
};

export const validarIPRegistro = (ip) => {
    const ahora = Date.now();
    const unDia = 24 * 60 * 60 * 1000;
    
    const registro = db.prepare('SELECT * FROM ip_registros WHERE ip = ?').get(ip);
    
    if (!registro) {
        db.prepare('INSERT INTO ip_registros (ip, intentos, ultimo_registro) VALUES (?, 1, ?)').run(ip, ahora);
        return true; 
    }
    
    if ((ahora - registro.ultimo_registro) > unDia) {
        db.prepare('UPDATE ip_registros SET intentos = 1, ultimo_registro = ? WHERE ip = ?').run(ahora, ip);
        return true; 
    }
    
    if (registro.intentos >= 2) {
        return false; 
    }
    
    db.prepare('UPDATE ip_registros SET intentos = intentos + 1, ultimo_registro = ? WHERE ip = ?').run(ahora, ip);
    return true;
};

export const registrarWhatsAppVinculado = (telefono, tenantId) => {
    const telLimpio = telefono.split(':')[0]; 
    try {
        db.prepare('INSERT INTO whatsapp_registrados (telefono, tenantId, fecha_vinculacion) VALUES (?, ?, ?)')
          .run(telLimpio, tenantId, Date.now());
    } catch (e) {
        db.prepare('UPDATE whatsapp_registrados SET tenantId = ?, fecha_vinculacion = ? WHERE telefono = ?')
          .run(tenantId, Date.now(), telLimpio);
    }
};

export const verificarAbusoWhatsApp = (telefono, tenantIdActual) => {
    const telLimpio = telefono.split(':')[0];
    const registro = db.prepare('SELECT tenantId FROM whatsapp_registrados WHERE telefono = ?').get(telLimpio);
    
    if (registro && registro.tenantId !== tenantIdActual) {
        return true; 
    }
    return false; 
};  