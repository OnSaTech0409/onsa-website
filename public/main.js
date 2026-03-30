/**
 * MAIN.JS - Arquitectura Front-end OnSaTech
 * Unifica la lógica de la Landing Page (Pública) y el Panel SaaS (Privado).
 */

// ============================================================================
// 1. LÓGICA DE LA LANDING PAGE (PÚBLICA)
// ============================================================================

const initLandingPage = () => {
    // Controlador del menú móvil
    const mobileMenu = document.getElementById('mobile-menu');
    const navList = document.getElementById('nav-list');

    if (mobileMenu && navList) {
        mobileMenu.addEventListener('click', () => {
            navList.classList.toggle('active');
        });
    }

    // Motor de animaciones (Scroll Reveal)
    function reveal() {
        var reveals = document.querySelectorAll('.reveal');
        var windowHeight = window.innerHeight;
        var elementVisible = 120; // Distancia en píxeles antes de aparecer

        for (var i = 0; i < reveals.length; i++) {
            var elementTop = reveals[i].getBoundingClientRect().top;
            if (elementTop < windowHeight - elementVisible) {
                reveals[i].classList.add('active');
            }
        }
    }

    // Solo escuchar el scroll si hay elementos reveal en la pantalla actual
    if (document.querySelectorAll('.reveal').length > 0) {
        window.addEventListener('scroll', reveal);
        reveal(); // Ejecutar al inicio
    }
};

// ============================================================================
// 2. LÓGICA DEL PANEL SAAS (PRIVADA Y PROTEGIDA)
// ============================================================================

let tenantId = localStorage.getItem('tenantId');
let authToken = localStorage.getItem('authToken');
let socket = null; 

// --- HERRAMIENTAS GLOBALES SAAS ---
const notificar = (mensaje, tipo = 'info') => {
    const bg = tipo === 'success' ? '#10b981' : tipo === 'error' ? '#ef4444' : '#3b82f6';
    if(typeof Toastify !== 'undefined') {
        Toastify({ text: mensaje, duration: 3000, gravity: "top", position: "right", style: { background: bg, borderRadius: "6px" } }).showToast();
    } else {
        alert(mensaje); // Respaldo por si no carga la librería
    }
};

const fetchAPI = async (endpoint, options = {}) => {
    const headers = options.headers || {};
    headers['x-tenant-id'] = tenantId;
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(endpoint, { ...options, headers });
    
    if (response.status === 401 || response.status === 403) {
        cerrarSesion();
        throw new Error("Sesión expirada o no autorizada");
    }
    
    if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
    return response.json();
};

// --- AUTENTICACIÓN ---
const procesarLogin = async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!email || !password) return notificar("Ingresa correo y contraseña", "error");

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (data.success) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('tenantId', data.tenantId);
            // 🔥 REDIRECCIÓN MÁGICA: Del login al panel de control
            window.location.href = '/panelcontrol.html'; 
        } else {
            notificar(data.message, "error");
        }
    } catch (e) {
        notificar("Error de conexión con el servidor", "error");
    }
};

const cerrarSesion = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('tenantId');
    window.location.href = '/iniciosesion.html';
};

// --- LÓGICA DEL WIZARD DE REGISTRO ---
const irAlPaso = (numeroPaso) => {
    const paso1 = document.getElementById('paso-1');
    const paso2 = document.getElementById('paso-2');
    const emailInput = document.getElementById('reg-email');
    const subtitulo = document.getElementById('dinamic-subtitle');
    const btnBack = document.getElementById('btn-back');

    if (numeroPaso === 2) {
        const emailVal = emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        if (!emailVal || !emailRegex.test(emailVal)) {
            notificar("Ingresa un correo electrónico válido", "error");
            emailInput.focus();
            return;
        }

        document.getElementById('display-email').innerText = emailVal;
        
        paso1.classList.remove('active');
        paso1.classList.add('previous');
        
        setTimeout(() => {
            paso2.classList.add('active');
            btnBack.classList.remove('hidden');
            subtitulo.innerText = "Casi listo. Protege tu nueva cuenta empresarial.";
            document.getElementById('reg-password').focus();
        }, 100);

    } else {
        paso2.classList.remove('active');
        
        setTimeout(() => {
            paso1.classList.remove('previous');
            paso1.classList.add('active');
            btnBack.classList.add('hidden');
            subtitulo.innerText = "Despliega tu asistente IA y automatiza tus ventas. Obtén 7 días de prueba sin tarjeta.";
        }, 100);
    }
};

const crearCuenta = async () => {
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const btn = document.getElementById('btn-registro');

    if (password.length < 6) return notificar("La contraseña debe tener al menos 6 caracteres", "error");

    btn.innerHTML = '<i class="ph-bold ph-spinner-gap" style="animation: spin 1s linear infinite;"></i> Creando entorno...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/registro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await res.json();

        if (data.success) {
            notificar(data.message, "success");
            // 🔥 RUTA CORREGIDA: Mandamos al usuario al archivo de inicio de sesión correcto
            setTimeout(() => { window.location.href = '/iniciosesion.html'; }, 2000);
        } else {
            notificar(data.message, "error");
            btn.innerHTML = 'Crear cuenta <i class="ph-bold ph-check"></i>';
            btn.disabled = false;
        }
    } catch (e) {
        notificar("Error de red. Verifica tu conexión.", "error");
        btn.innerHTML = 'Crear cuenta <i class="ph-bold ph-check"></i>';
        btn.disabled = false;
    }
};

// Función global para cerrar el menú (usada en el HTML)
window.closeMenu = () => {
    const navList = document.getElementById('nav-list');
    if(navList) navList.classList.remove('active');
};

// --- CONTROL DE VISTAS DEL PANEL ---
const DOM = {
    vistas: null, ui: null, qrImage: null, badgeStatus: null
};

const inicializarDOM = () => {
    DOM.vistas = { dashboard: document.getElementById('vista-dashboard'), configuracion: document.getElementById('vista-configuracion') };
    DOM.ui = {
        loading: document.getElementById('ui-loading'),
        qr: document.getElementById('ui-qr'),
        online: document.getElementById('ui-online'),
        paused: document.getElementById('ui-paused'),
        offline: document.getElementById('ui-offline'),
        blocked: document.getElementById('ui-blocked')
    };
    DOM.qrImage = document.getElementById('qr-image');
    DOM.badgeStatus = document.getElementById('badge-status');
};

const cambiarVista = (vistaId) => {
    Object.values(DOM.vistas).forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    DOM.vistas[vistaId].classList.remove('hidden');
    event.currentTarget.classList.add('active');

    if (vistaId === 'configuracion') cargarConfiguracion();
};

const cambiarTabConfig = (panelId, btnElement) => {
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(panelId).classList.add('active');
    btnElement.classList.add('active');
};

// --- MOTOR DE WHATSAPP (SOCKETS) ---
let cuentaBloqueada = false;

const configurarEventosSocket = () => {
    socket.on('status-update', (data) => {
        if (cuentaBloqueada) return; 

        Object.values(DOM.ui).forEach(el => el.classList.add('hidden'));

        switch (data.state) {
            case 'iniciando':
                DOM.ui.loading.classList.remove('hidden');
                DOM.badgeStatus.innerText = 'INICIANDO';
                DOM.badgeStatus.style.background = '#f59e0b';
                break;
            case 'listo':
                DOM.ui.online.classList.remove('hidden');
                DOM.badgeStatus.innerText = 'EN LÍNEA';
                DOM.badgeStatus.style.background = '#10b981';
                break;
            case 'pausado': 
                DOM.ui.paused.classList.remove('hidden');
                DOM.badgeStatus.innerText = 'PAUSADO';
                DOM.badgeStatus.style.background = '#f59e0b';
                break;
            case 'bloqueado': 
                cuentaBloqueada = true; 
                DOM.ui.blocked.classList.remove('hidden'); 
                DOM.badgeStatus.innerText = 'PRUEBA AGOTADA';
                DOM.badgeStatus.style.background = '#ef4444'; 
                notificar("Número de WhatsApp rechazado por seguridad", "error");
                break;
            default:
                DOM.ui.offline.classList.remove('hidden');
                DOM.badgeStatus.innerText = 'DESCONECTADO';
                DOM.badgeStatus.style.background = '#64748b';
                break;
        }
    });

    socket.on('qr-code', (data) => {
        if (cuentaBloqueada) return; 

        Object.values(DOM.ui).forEach(el => el.classList.add('hidden'));
        DOM.ui.qr.classList.remove('hidden');
        DOM.qrImage.src = data.qr; 
        
        DOM.badgeStatus.innerText = 'ESPERANDO ESCANEO';
        DOM.badgeStatus.style.background = '#f59e0b';
    });
};

const toggleMotorBot = async (accion) => {
    try {
        DOM.ui.offline.classList.add('hidden');
        DOM.ui.online.classList.add('hidden');
        DOM.ui.loading.classList.remove('hidden');

        await fetchAPI('/api/toggle-bot', {
            method: 'POST',
            body: JSON.stringify({ accion })
        });
    } catch (e) {
        notificar("Error al comunicarse con el servidor", "error");
        socket.emit('request-status'); 
    }
};

// --- CREADORES Y LÓGICA DE CONFIGURACIÓN DOM ---

const cargarConfiguracion = async () => {
    try {
        const config = await fetchAPI('/api/config');
        
        document.getElementById('contenedor-saludos').innerHTML = '';
        document.getElementById('contenedor-opciones').innerHTML = '';
        document.getElementById('contenedor-reglas').innerHTML = '';

        const cabeceraInput = document.getElementById('inp-cabecera');
        if (cabeceraInput) cabeceraInput.value = config.mensajeCabecera || '';

        let secuenciaTotal = [];
        if (config.saludoInicial) {
            const primerPaso = typeof config.saludoInicial === 'string' 
                ? { texto: config.saludoInicial, imagenes: [] }
                : config.saludoInicial; 
            secuenciaTotal.push(primerPaso);
        }
        
        if (config.secuenciaBienvenida && config.secuenciaBienvenida.length > 0) {
            secuenciaTotal = [...secuenciaTotal, ...config.secuenciaBienvenida];
        }

        if (secuenciaTotal.length > 0) {
            secuenciaTotal.forEach(paso => agregarSaludoDOM(paso.texto, paso.imagenes));
        } else {
            agregarSaludoDOM();
        }

        if (config.opciones) config.opciones.forEach(op => agregarOpcionDOM(op.id, op.titulo, op.respuesta, op.silenciar, op.imagenes));
        if (config.reglasIA) config.reglasIA.forEach(r => agregarReglaDOM(r.palabrasClave, r.respuesta, r.silenciar));
    } catch (e) {
        notificar("No se pudo cargar la configuración", "error");
    }
};

const guardarConfiguracion = async () => {
    const payload = {
        saludoInicial: "", 
        secuenciaBienvenida: [],
        mensajeCabecera: document.getElementById('inp-cabecera')?.value || '',
        opciones: [],
        reglasIA: []
    };

    document.querySelectorAll('.item-saludo').forEach(item => {
        const txt = item.querySelector('.inp-saludo-burbuja').value.trim();
        const imagenes = [];
        item.querySelectorAll('.galeria-item').forEach(img => imagenes.push(img.dataset.filename));

        if (txt || imagenes.length > 0) {
            payload.secuenciaBienvenida.push({ texto: txt, imagenes: imagenes });
        }
    });

    document.querySelectorAll('.item-opcion').forEach(item => {
        const id = item.querySelector('.inp-id').value.trim();
        const titulo = item.querySelector('.inp-titulo').value.trim();
        if (id && titulo) {
            const imagenes = [];
            item.querySelectorAll('.galeria-item').forEach(img => imagenes.push(img.dataset.filename));
            payload.opciones.push({ id, titulo, imagenes, respuesta: item.querySelector('.inp-respuesta').value, silenciar: item.querySelector('.inp-silenciar').checked });
        }
    });

    document.querySelectorAll('.item-regla').forEach(item => {
        const palabrasClave = item.querySelector('.inp-palabras').value.trim();
        if (palabrasClave) payload.reglasIA.push({ palabrasClave, respuesta: item.querySelector('.inp-respuesta').value, silenciar: item.querySelector('.inp-silenciar').checked });
    });

    try {
        await fetchAPI('/api/config', { method: 'POST', body: JSON.stringify(payload) });
        notificar("Configuración guardada en la nube", "success");
    } catch (e) {
        notificar("Error al guardar", "error");
    }
};

const crearBotonEliminar = (elemento) => {
    const btn = document.createElement('button'); btn.className = 'btn btn-danger'; btn.innerHTML = '<i class="ph ph-trash"></i>';
    btn.onclick = () => elemento.remove(); return btn;
};

const crearItemGaleria = (filename) => {
    const div = document.createElement('div');
    div.className = 'galeria-item';
    div.dataset.filename = filename; 
    div.style = 'position: relative; width: 60px; height: 60px; border: 1px solid #334155; border-radius: 4px; overflow: hidden;';
    
    div.innerHTML = `
        <img src="/uploads/tenant_${tenantId}/${filename}" style="width: 100%; height: 100%; object-fit: cover;">
        <button class="btn-del-img" style="position: absolute; top: 0; right: 0; background: rgba(0,0,0,0.5); border: none; color: white; cursor: pointer; padding: 2px;">×</button>
    `;
    div.querySelector('.btn-del-img').onclick = () => div.remove();
    return div;
};

const agregarSaludoDOM = (texto = '', imagenes = []) => {
    const div = document.createElement('div');
    div.className = 'item-saludo';
    div.style = 'border: 1px solid #334155; padding: 15px; margin-bottom: 15px; border-radius: 6px; background: #0f172a;';
    
    const burbujaId = 'sal_' + Math.random().toString(36).substring(7); 
    div.dataset.burbujaId = burbujaId; 
    const inputId = 'file-' + burbujaId; 

    div.innerHTML = `
        <div style="display: flex; gap: 10px; margin-bottom: 10px; align-items: flex-start;">
            <div style="flex: 1;">
                <textarea class="inp-saludo-burbuja" rows="2" placeholder="Escribe un mensaje de saludo...">${texto}</textarea>
            </div>
            ${crearBotonEliminar(div).outerHTML} 
        </div>

        <div style="border-top: 1px solid #334155; padding-top: 10px;">
            <div class="galeria-grid" style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;"></div>
            <input type="file" id="${inputId}" class="hidden" accept="image/*" multiple onchange="subirImagenSaludo(this)">
            <label for="${inputId}" class="btn btn-sm btn-primary" style="cursor: pointer; padding: 6px 10px; font-size: 0.8rem;">
                <i class="ph ph-plus"></i> Añadir Foto (Opcional)
            </label>
        </div>
    `;
    
    div.querySelector('.btn-danger').onclick = () => div.remove();
    
    const galleryGrid = div.querySelector('.galeria-grid');
    if (imagenes && imagenes.length > 0) {
        imagenes.forEach(filename => galleryGrid.appendChild(crearItemGaleria(filename)));
    }
    
    document.getElementById('contenedor-saludos').appendChild(div);
};

const subirImagenSaludo = async (input) => {
    if (!input.files || input.files.length === 0) return;
    const burbujaCard = input.closest('.item-saludo');
    const idValor = burbujaCard.dataset.burbujaId; 
    const archivos = Array.from(input.files); 

    notificar(`Subiendo ${archivos.length} imagen(es) a la nube...`, "info");

    for (const file of archivos) {
        const formData = new FormData();
        formData.append('imagen', file);
        try {
            const res = await fetchAPI(`/api/upload?id=${idValor}`, { method: 'POST', body: formData });
            if (res.success) {
                const filename = res.ruta.split('/').pop();
                burbujaCard.querySelector('.galeria-grid').appendChild(crearItemGaleria(filename));
            }
        } catch (e) {
            notificar(`Error al subir la imagen: ${file.name}`, "error");
        }
    }
    notificar("Carga multimedia completada", "success");
    input.value = ""; 
};

const agregarOpcionDOM = (id = '', titulo = '', respuesta = '', silenciar = false, imagenes = []) => {
    const div = document.createElement('div'); div.className = 'item-opcion'; div.style = 'border: 1px solid #334155; padding: 15px; margin-bottom: 15px; border-radius: 6px; background: #0f172a;';
    const inputId = 'file-' + Math.random().toString(36).substring(7); 
    
    div.innerHTML = `
        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
            <div style="width: 80px;"><label>N°</label><input type="text" class="inp-id" value="${id}" placeholder="Ej: 1"></div>
            <div style="flex: 1;"><label>Título en el menú</label><input type="text" class="inp-titulo" value="${titulo}" placeholder="Ej: Ventas"></div>
        </div>
        <div style="margin-bottom: 10px;"><label>Respuesta del bot</label><textarea class="inp-respuesta" rows="2">${respuesta}</textarea></div>
        
        <div style="border-top: 1px solid #334155; padding-top: 10px; margin-bottom: 10px;">
            <label style="display: block; margin-bottom: 5px;">Galería de Imágenes (Opcional)</label>
            <div class="galeria-grid" style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;"></div>
            
            <input type="file" id="${inputId}" class="hidden" accept="image/*" multiple onchange="subirImagenOpcion(this, '${id}')">
            <label for="${inputId}" class="btn btn-sm btn-primary" style="cursor: pointer; padding: 6px 10px; font-size: 0.8rem;"><i class="ph ph-plus"></i> Subir Foto</label>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="color: #ef4444; font-weight: bold; cursor: pointer;"><input type="checkbox" class="inp-silenciar" ${silenciar ? 'checked' : ''}> 🔕 Pausar bot</label>
        </div>
    `;
    
    const divActions = div.querySelector('div:last-child');
    divActions.appendChild(crearBotonEliminar(div));
    
    const galleryGrid = div.querySelector('.galeria-grid');
    if (imagenes && imagenes.length > 0) {
        imagenes.forEach(filename => galleryGrid.appendChild(crearItemGaleria(filename)));
    }
    
    document.getElementById('contenedor-opciones').appendChild(div);
};

const subirImagenOpcion = async (input, opcionId) => {
    if (!input.files || input.files.length === 0) return;
    const opCard = input.closest('.item-opcion');
    const idValor = opCard.querySelector('.inp-id').value.trim();
    if (!idValor) { 
        notificar("🛑 Escribe el número de opción primero para vincular las imágenes", "error"); 
        input.value = ""; 
        return; 
    }

    const archivos = Array.from(input.files);
    notificar(`Subiendo ${archivos.length} imagen(es) a la nube...`, "info");

    for (const file of archivos) {
        const formData = new FormData();
        formData.append('imagen', file);
        try {
            const res = await fetchAPI(`/api/upload?id=${idValor}`, { method: 'POST', body: formData });
            if (res.success) {
                const filename = res.ruta.split('/').pop(); 
                opCard.querySelector('.galeria-grid').appendChild(crearItemGaleria(filename));
            }
        } catch (e) { 
            notificar(`Error al subir la imagen: ${file.name}`, "error"); 
        }
    }
    notificar("Carga multimedia completada", "success");
    input.value = ""; 
};

const agregarReglaDOM = (palabras = '', respuesta = '', silenciar = false) => {
    const div = document.createElement('div');
    div.className = 'item-regla';
    div.style = 'border: 1px solid #334155; padding: 15px; margin-bottom: 15px; border-radius: 6px; background: #0f172a;';

    div.innerHTML = `
        <div style="margin-bottom: 10px;">
            <label>Palabras clave (una por línea)</label>
            <textarea class="inp-palabras" rows="2" placeholder="Ej: precio\ncosto\ncotización">${palabras}</textarea>
        </div>
        <div style="margin-bottom: 10px;">
            <label>Respuesta del bot</label>
            <textarea class="inp-respuesta" rows="2">${respuesta}</textarea>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="color: #ef4444; font-weight: bold; cursor: pointer;">
                <input type="checkbox" class="inp-silenciar" ${silenciar ? 'checked' : ''}> 🔕 Pausar bot y alertar a humano
            </label>
        </div>
    `;

    div.querySelector('div:last-child').appendChild(crearBotonEliminar(div));
    document.getElementById('contenedor-reglas').appendChild(div);
};

// ============================================================================
// 3. ARRANQUE INTELIGENTE (EL CEREBRO DEL SISTEMA)
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // 1. Siempre iniciamos la lógica pública (por si estamos en la Landing Page)
    initLandingPage();

    // 2. Averiguamos en qué página estamos para evitar errores
    const currentPath = window.location.pathname;
    const isLogin = currentPath.includes('iniciosesion.html');
    const isPanel = currentPath.includes('panelcontrol.html');

    // 3. Protección de Rutas Privadas
    if (isPanel) {
        if (!authToken || !tenantId) {
            // Un intruso intentó entrar directo al panel. Lo mandamos al login.
            window.location.href = '/iniciosesion.html';
        } else {
            // El usuario tiene llave. Encendemos el panel y conectamos WhatsApp.
            inicializarDOM();
            document.getElementById('display-tenant').innerText = tenantId;
            socket = io({ query: { tenantId } });
            configurarEventosSocket();
        }
    }

    // 4. Protección de Rutas Públicas (Login)
    if (isLogin) {
        if (authToken && tenantId) {
            // Si el usuario ya inició sesión e intenta ir al login, lo mandamos al panel.
            window.location.href = '/panelcontrol.html';
        }
    }
});