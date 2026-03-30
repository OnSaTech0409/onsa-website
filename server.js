/**
 * SERVER.JS - API Gateway y Servidor WebSockets Multi-Tenant
 * Punto de entrada principal para el backend SaaS de OnSaTech.
 */

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';

import { startSession, getSessionStatus, logoutSession, togglePauseSession } from './SessionManager.js';
import { getConfig, setConfig, getAdminByEmail, registrarNuevoCliente, validarIPRegistro } from './database.js';

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const JWT_SECRET = 'onsatech_secreto_super_seguro_2026';

// --- 1. CONFIGURACIÓN DE WEBSOCKETS (AISLAMIENTO) ---
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.on('connection', (socket) => {
    const tenantId = socket.handshake.query.tenantId;
    if (tenantId) {
        socket.join(tenantId);
        console.log(`🔌 [Socket] Cliente web conectado al Tenant: ${tenantId}`);
        const estadoActual = getSessionStatus(tenantId);
        socket.emit('status-update', { state: estadoActual });
    } else {
        console.log("⚠️ [Socket] Conexión rechazada: Falta tenantId");
        socket.disconnect();
    }
});

// --- 2. MIDDLEWARES GLOBALES ---
app.use(cors());
app.use(express.json());

// Exponer archivos estáticos dinámicamente
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public'))); 

// --- 3. MIDDLEWARE DE SEGURIDAD (EL CADENERO JWT) ---
const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Acceso denegado. Se requiere token.' });
    }

    try {
        const usuarioDecodificado = jwt.verify(token, JWT_SECRET);
        req.tenantId = usuarioDecodificado.tenantId; // Inyectamos el ID seguro
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Token inválido o expirado.' });
    }
};

// --- 4. CONFIGURACIÓN DE ALMACENAMIENTO DINÁMICO (MULTER) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // req.tenantId ya viene seguro gracias a verificarToken
        const dir = path.join(__dirname, 'uploads', `tenant_${req.tenantId}`);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        const idOpcion = req.query.id || 'global';
        cb(null, `opcion_${idOpcion}_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });


// ==========================================
// --- 5. ENRUTADOR DE PÁGINAS (FRONTEND) ---
// ==========================================

// Ruta raíz: Sirve la Landing Page oficial de OnSaTech
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Rutas de conveniencia (Redirigen si el usuario escribe la URL sin el .html)
app.get('/login', (req, res) => res.redirect('/iniciosesion.html'));
app.get('/registro', (req, res) => res.redirect('/registro.html'));
app.get('/planes', (req, res) => res.redirect('/planes.html'));
app.get('/panel', (req, res) => res.redirect('/panelcontrol.html'));


// ==========================================
// --- 6. RUTAS PÚBLICAS (API sin Cadenero) ---
// ==========================================

// Ruta para INICIAR SESIÓN
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = getAdminByEmail(email);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });
        }

        const token = jwt.sign(
            { email: user.email, tenantId: user.tenantId }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );

        res.json({ success: true, token, tenantId: user.tenantId });
    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// Ruta para REGISTRAR NUEVOS CLIENTES
app.post('/api/registro', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Correo y contraseña son obligatorios' });
    }

    // Bloqueo por Huella Digital (IP)
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    if (!validarIPRegistro(clientIp)) {
        console.log(`🚨 Bloqueo Anti-Spam: Múltiples registros desde IP ${clientIp}`);
        return res.status(429).json({ success: false, message: 'Límite de cuentas gratuitas excedido para esta red.' });
    }

    // Verificamos que el correo no esté robado o duplicado
    const usuarioExistente = getAdminByEmail(email);
    if (usuarioExistente) {
        return res.status(409).json({ success: false, message: 'Este correo ya tiene una cuenta registrada.' });
    }

    try {
        // Generamos un ID de inquilino único (ej. onsa_a1b2c3d4)
        const nuevoTenantId = 'onsa_' + Math.random().toString(36).substring(2, 10);

        // Insertamos al cliente en SQLite con sus 7 días de prueba
        await registrarNuevoCliente(email, password, nuevoTenantId);

        console.log(`🎉 Nuevo cliente registrado: ${email} [Tenant: ${nuevoTenantId}]`);
        
        // Respondemos con éxito para que el frontend lo mande a Iniciar Sesión
        res.json({ 
            success: true, 
            message: 'Cuenta creada con éxito. Redirigiendo...'
        });
    } catch (error) {
        console.error("Error en registro:", error);
        res.status(500).json({ success: false, message: 'Error interno al crear la cuenta.' });
    }
});


// ==========================================
// --- 7. RUTAS PROTEGIDAS (API con Cadenero) ---
// ==========================================

app.get('/api/config', verificarToken, (req, res) => {
    const config = getConfig(req.tenantId, 'bot_config') || {};
    res.json(config);
});

app.post('/api/config', verificarToken, (req, res) => {
    setConfig(req.tenantId, 'bot_config', req.body);
    res.json({ success: true, message: 'Configuración guardada en la nube' });
});

app.post('/api/toggle-bot', verificarToken, async (req, res) => {
    const { accion } = req.body;
    
    if (accion === 'desvincular') {
        await logoutSession(req.tenantId);
        io.to(req.tenantId).emit('status-update', { state: 'desconectado' });
        res.json({ success: true, status: 'desconectado' });
    } 
    else if (accion === 'pausar') {
        const nuevoEstado = togglePauseSession(req.tenantId, true);
        io.to(req.tenantId).emit('status-update', { state: nuevoEstado });
        res.json({ success: true, status: nuevoEstado });
    } 
    else if (accion === 'reanudar') {
        const nuevoEstado = togglePauseSession(req.tenantId, false);
        io.to(req.tenantId).emit('status-update', { state: nuevoEstado });
        res.json({ success: true, status: nuevoEstado });
    } 
    else {
        startSession(req.tenantId, io);
        res.json({ success: true, status: 'iniciando' });
    }
});

app.post('/api/upload', verificarToken, upload.single('imagen'), (req, res) => {
    res.json({ 
        success: true, 
        ruta: `/uploads/tenant_${req.tenantId}/${req.file.filename}` 
    });
});

// --- 8. ARRANQUE DEL SERVIDOR ---
server.listen(PORT, () => {
    console.log(`🚀 [Gateway] Servidor SaaS OnSaTech corriendo en puerto ${PORT}`);
    console.log(`🌐 Listo para recibir conexiones multi-tenant.`);
});