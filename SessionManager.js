/**
 * SESSIONMANAGER.JS - Orquestador Multi-Tenant de Baileys
 * Gestiona múltiples conexiones de WhatsApp simultáneas en un solo proceso Node.
 */

import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getUsuario, upsertUsuario, registrarLog, getConfig, getAdminByTenant, verificarAbusoWhatsApp, registrarWhatsAppVinculado } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. ESTADOS GLOBALES DEL SERVIDOR ---
export const sessions = new Map(); 
const cooldowns = new Map();

// --- 2. INICIALIZADOR DE INQUILINOS (TENANTS) ---
export const startSession = async (tenantId, io) => {
    console.log(`🚀 [Tenant: ${tenantId}] Iniciando contenedor de sesión...`);

    const admin = getAdminByTenant(tenantId);
    if (admin && admin.estado !== 'pagado' && Date.now() > admin.plan_expira) {
        console.log(`🚫 [Tenant: ${tenantId}] Plan expirado. Bloqueando inicio.`);
        sessions.set(tenantId, { sock: null, status: 'expirado', isPaused: false });
        io.to(tenantId).emit('status-update', { state: 'expirado' });
        return; 
    }

    const authFolder = path.join(__dirname, 'auth_info', `tenant_${tenantId}`);
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        logger: pino({ level: 'silent' }),
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    });

    sessions.set(tenantId, { sock, status: 'iniciando', isPaused: false });

    // --- 3. CICLO DE VIDA DE LA CONEXIÓN ---
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                const qrImage = await qrcode.toDataURL(qr);
                io.to(tenantId).emit('qr-code', { qr: qrImage });
            } catch (err) {
                console.error(`❌ [Tenant: ${tenantId}] Error dibujando QR:`, err.message);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`🛑 [Tenant: ${tenantId}] Desconectado. Razón: ${statusCode}`);

            // Código 401 = Logged Out
            if (statusCode === 401) {
                console.log(`⚠️ [Tenant: ${tenantId}] Sesión cerrada. Borrando credenciales de forma segura...`);
                
                setTimeout(() => {
                    try {
                        if (fs.existsSync(authFolder)) {
                            fs.rmSync(authFolder, { recursive: true, force: true });
                        }
                    } catch (e) {
                        console.log(`⚠️ Aviso menor: Windows bloqueó el borrado de la carpeta del tenant ${tenantId}.`);
                    }
                }, 2000);

                sessions.delete(tenantId);
                io.to(tenantId).emit('status-update', { state: 'desconectado' });
            } else {
                console.log(`🔄 [Tenant: ${tenantId}] Intentando reconexión...`);
                setTimeout(() => startSession(tenantId, io), 5000);
            }
        }

        if (connection === 'open') {
            const telefonoConectado = sock.user.id; 
            
            // 🔥 ESTRATEGIA 1: Candado Antifraude (Reciclaje de Número)
            if (verificarAbusoWhatsApp(telefonoConectado, tenantId)) {
                console.log(`🚨 [Tenant: ${tenantId}] ABUSO DETECTADO...`);
                sessions.get(tenantId).status = 'bloqueado'; 
                io.to(tenantId).emit('status-update', { state: 'bloqueado' });
                await sock.logout(); 
                return;
            }

            registrarWhatsAppVinculado(telefonoConectado, tenantId);

            console.log(`✅ [Tenant: ${tenantId}] Bot en línea y autenticado.`);
            sessions.get(tenantId).status = 'listo';
            io.to(tenantId).emit('status-update', { state: 'listo' });
            registrarLog(tenantId, 'SISTEMA', 'Bot conectado a la nube');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- 4. INTERCEPTOR DE MENSAJES ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sessionActiva = sessions.get(tenantId);
        if (sessionActiva && sessionActiva.isPaused) {
            console.log(`⏸️ [Tenant: ${tenantId}] Bot pausado. Ignorando mensaje.`);
            return;
        }

        const sender = msg.key.remoteJid;
        if (sender.includes('@g.us') || sender === 'status@broadcast') return;

        // 🔥 CAPA ANTI-SPAM
        const cooldownKey = `${tenantId}_${sender}`;
        const tiempoActual = Date.now();
        const ultimoMensaje = cooldowns.get(cooldownKey) || 0;

        if ((tiempoActual - ultimoMensaje) < 3000) {
            console.log(`🛡️ [Tenant: ${tenantId}] Spam bloqueado de ${sender}`);
            return;
        }
        cooldowns.set(cooldownKey, tiempoActual);

        const textoIn = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const textoCompleto = textoIn.toLowerCase().trim();
        const matchNumero = textoIn.match(/\d+/); 
        const numeroDetectado = matchNumero ? matchNumero[0] : null;

        console.log(`📩 [Tenant: ${tenantId}] Msg de ${sender}: ${textoIn}`);

        let usr = getUsuario(tenantId, sender) || { timestamp: 0, muted: 0 };
        if (usr.muted === 1) return;

        const config = getConfig(tenantId, 'bot_config') || {};
        const opciones = config.opciones || [];
        const reglasIA = config.reglasIA || [];

        const construirMenu = () => {
            let m = (config.mensajeCabecera || "👇 Opciones:") + "\n\n";
            opciones.forEach(op => m += `${op.id}️⃣ ${op.titulo}\n`);
            if (config.mensajePieMenu) m += "\n" + config.mensajePieMenu;
            return m;
        };

        const simularEscribiendo = async (texto = "") => {
            await sock.sendPresenceUpdate('composing', sender);
            const tiempo = Math.min(1500 + (texto.length * 40), 5000);
            await new Promise(r => setTimeout(r, tiempo));
            await sock.sendPresenceUpdate('paused', sender);
        };

        const enviarSecuenciaMultimedia = async (secuencia = []) => {
            if (!secuencia || secuencia.length === 0) return;

            console.log(`🆕 [Tenant: ${tenantId}] Enviando secuencia de bienvenida (${secuencia.length} burbujas)...`);

            for (const paso of secuencia) {
                if (paso.imagenes && paso.imagenes.length > 0) {
                    for (const filename of paso.imagenes) {
                        const rutaFisica = path.join(__dirname, 'uploads', `tenant_${tenantId}`, filename);
                        if (fs.existsSync(rutaFisica)) {
                            try {
                                await sock.sendMessage(sender, { image: fs.readFileSync(rutaFisica) });
                                await new Promise(r => setTimeout(r, 600)); 
                            } catch (e) { console.error(`❌ Error media saludo tenant ${tenantId}:`, e.message); }
                        } else { console.warn(`⚠️ Archivo de saludo no encontrado tenant ${tenantId}: ${filename}`); }
                    }
                }

                if (paso.texto) {
                    await simularEscribiendo(paso.texto);
                    await sock.sendMessage(sender, { text: paso.texto });
                }
            }
        };

        // ==========================================
        // REGLA 1: NUEVA SESIÓN
        // ==========================================
        if ((Date.now() - usr.timestamp) > (10 * 1000)) {
            console.log(`🆕 [Tenant: ${tenantId}] Nueva sesión iniciada para ${sender}`);
            upsertUsuario(tenantId, sender, Date.now(), 0);
            
            if (config.secuenciaBienvenida && config.secuenciaBienvenida.length > 0) {
                await enviarSecuenciaMultimedia(config.secuenciaBienvenida);
            }
            
            await sock.sendMessage(sender, { text: construirMenu() });
            return;
        }

        // ==========================================
        // REGLA 2: MOTOR DE BÚSQUEDA
        // ==========================================
        let match = null;
        
        if (numeroDetectado) match = opciones.find(op => op.id === numeroDetectado);
        if (!match) match = opciones.find(op => op.id === textoCompleto);
        if (!match) {
            for (const r of reglasIA) {
                const ks = (r.palabrasClave || "").split('\n').map(k => k.trim().toLowerCase()).filter(k=>k);
                if (ks.some(k => textoCompleto.includes(k))) { match = r; break; }
            }
        }

        if (match) {
            upsertUsuario(tenantId, sender, Date.now(), match.silenciar ? 1 : 0);
            
            if (match.imagenes && match.imagenes.length > 0) {
                console.log(`📸 [Tenant: ${tenantId}] Enviando galería (${match.imagenes.length} fotos)...`);
                for (const filename of match.imagenes) {
                    const rutaFisica = path.join(__dirname, 'uploads', `tenant_${tenantId}`, filename);
                    if (fs.existsSync(rutaFisica)) {
                        try {
                            await sock.sendMessage(sender, { image: fs.readFileSync(rutaFisica) });
                            await new Promise(r => setTimeout(r, 600)); 
                        } catch (e) { console.error(`❌ Error enviando media tenant ${tenantId}:`, e.message); }
                    } else { console.warn(`⚠️ Archivo no encontrado tenant ${tenantId}: ${filename}`); }
                }
            }

            await simularEscribiendo(match.respuesta);
            await sock.sendMessage(sender, { text: match.respuesta });

            if (match.id && config.mensajeGlobal && match.usarGlobal) {
                await new Promise(r => setTimeout(r, 800));
                await sock.sendMessage(sender, { text: config.mensajeGlobal });
            }

            if (match.silenciar) {
                const esVenta = ["pedido", "compra", "precio", "cotizar"].some(p => match.respuesta.toLowerCase().includes(p));
                io.to(tenantId).emit('nuevo-ticket', {
                    telefono: sender.replace('@s.whatsapp.net', ''),
                    fecha: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
                    categoria: esVenta ? 'venta' : 'soporte'
                });
                registrarLog(tenantId, sender, "Derivado a atención humana");
            }
            return;
        }

        // ==========================================
        // REGLA 3: COMANDO "MENU"
        // ==========================================
        if (textoCompleto === 'menu' || textoCompleto === 'menú') {
            await simularEscribiendo();
            await sock.sendMessage(sender, { text: construirMenu() });
            upsertUsuario(tenantId, sender, Date.now(), usr.muted);
            return;
        }

        upsertUsuario(tenantId, sender, Date.now(), usr.muted);
    });
};

// --- 5. CONTROLADORES EXTERNOS ---
export const getSessionStatus = (tenantId) => {
    return sessions.get(tenantId)?.status || 'desconectado';
};

export const togglePauseSession = (tenantId, estadoPausa) => {
    const session = sessions.get(tenantId);
    if (session) {
        session.isPaused = estadoPausa;
        session.status = estadoPausa ? 'pausado' : 'listo';
        return session.status;
    }
    return 'desconectado';
};

export const logoutSession = async (tenantId) => {
    const session = sessions.get(tenantId);
    if (session) {
        await session.sock.logout();
    }
};