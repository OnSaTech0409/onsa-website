/**
 * SCRIPT.JS - Frontend Nativo SaaS
 * Diseñado para operar exclusivamente con el backend multi-tenant.
 */

// --- 1. GESTIÓN DE SEGURIDAD (JWT & LOGIN) ---
let tenantId = localStorage.getItem('tenantId');
let authToken = localStorage.getItem('authToken');
let socket = null; // El socket se conectará solo si el login es exitoso

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
            // Guardamos el pase de seguridad en el navegador
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('tenantId', data.tenantId);
            window.location.reload(); // Recargamos para arrancar el panel
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
    window.location.reload();
};

// --- 2. COMUNICACIÓN BASE (API & SOCKETS) ---

const fetchAPI = async (endpoint, options = {}) => {
    const headers = options.headers || {};
    headers['x-tenant-id'] = tenantId;
    
    // Inyectamos el Token JWT en cada petición que hagamos al servidor
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(endpoint, { ...options, headers });
    
    // Si el servidor rechaza el token (expirado o falso), cerramos la sesión
    if (response.status === 401 || response.status === 403) {
        cerrarSesion();
        throw new Error("Sesión expirada o no autorizada");
    }
    
    if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
    return response.json();
};

// --- ARRANQUE CONDICIONAL DEL SISTEMA ---
document.addEventListener('DOMContentLoaded', () => {
    if (!authToken || !tenantId) {
        // MODO BLOQUEADO: Muestra login, oculta panel
        document.getElementById('vista-login').classList.remove('hidden');
        document.querySelector('.sidebar').classList.add('hidden');
        document.querySelector('.main-content').classList.add('hidden');
    } else {
        // MODO DESBLOQUEADO: Conecta socket y arranca panel
        document.getElementById('display-tenant').innerText = tenantId;
        
        socket = io({ query: { tenantId } });
        configurarEventosSocket(); // Inicializamos la escucha del bot
    }
});
// --- 3. MANEJO DE ESTADOS DE INTERFAZ ---
const DOM = {
    vistas: { dashboard: document.getElementById('vista-dashboard'), configuracion: document.getElementById('vista-configuracion') },
    ui: {
        loading: document.getElementById('ui-loading'),
        qr: document.getElementById('ui-qr'),
        online: document.getElementById('ui-online'),
        paused: document.getElementById('ui-paused'), // <--- AÑADIR ESTA LÍNEA
        offline: document.getElementById('ui-offline'),
        blocked: document.getElementById('ui-blocked')
    },
    qrImage: document.getElementById('qr-image'),
    badgeStatus: document.getElementById('badge-status')
};

const cambiarVista = (vistaId) => {
    Object.values(DOM.vistas).forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    DOM.vistas[vistaId].classList.remove('hidden');
    event.currentTarget.classList.add('active');

    if (vistaId === 'configuracion') cargarConfiguracion();
};

const notificar = (mensaje, tipo = 'info') => {
    const bg = tipo === 'success' ? '#10b981' : tipo === 'error' ? '#ef4444' : '#3b82f6';
    Toastify({ text: mensaje, duration: 3000, gravity: "top", position: "right", style: { background: bg, borderRadius: "6px" } }).showToast();
};

// --- CONTROLADOR DE PESTAÑAS DE CONFIGURACIÓN ---
const cambiarTabConfig = (panelId, btnElement) => {
    // 1. Ocultar todos los paneles y quitar 'active' de todos los botones
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    // 2. Mostrar el panel seleccionado y marcar su botón
    document.getElementById(panelId).classList.add('active');
    btnElement.classList.add('active');
};

// --- 4. CONTROLADOR DEL MOTOR BAILEYS ---
// --- 4. CONTROLADOR DEL MOTOR BAILEYS ---
let cuentaBloqueada = false; // 🔥 EL ESCUDO: Memoria del navegador

const configurarEventosSocket = () => {
    
    // 1. Escuchar actualizaciones de estado generales
    socket.on('status-update', (data) => {
        // 🔥 SI EL ESCUDO ESTÁ ACTIVO, IGNORAMOS CUALQUIER OTRA ORDEN (COMO "DESCONECTADO")
        if (cuentaBloqueada) return; 

        // Ocultar todas las interfaces de estado
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
                cuentaBloqueada = true; // 🔥 ACTIVAMOS EL ESCUDO
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

    // 2. Escuchar específicamente la llegada del QR
    socket.on('qr-code', (data) => {
        if (cuentaBloqueada) return; // 🔥 Protegemos el QR también

        // Ocultamos la rueda de carga
        Object.values(DOM.ui).forEach(el => el.classList.add('hidden'));
        
        // Mostramos el contenedor del QR
        DOM.ui.qr.classList.remove('hidden');
        
        // Atrapamos la imagen que mandó el backend y la inyectamos en el HTML
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
        socket.emit('request-status'); // Forzar recarga de estado real
    }
};

// --- 5. LÓGICA DE CONFIGURACIÓN Y CONSTRUCTOR DINÁMICO (SaaS Multimedia) ---

const cargarConfiguracion = async () => {
    try {
        const config = await fetchAPI('/api/config');
        
        // Limpiar contenedores
        document.getElementById('contenedor-saludos').innerHTML = '';
        document.getElementById('contenedor-opciones').innerHTML = '';
        document.getElementById('contenedor-reglas').innerHTML = '';

        // Cargar Cabecera
        const cabeceraInput = document.getElementById('inp-cabecera');
        if (cabeceraInput) cabeceraInput.value = config.mensajeCabecera || '';

        // 🔥 ACTUALIZADO: Cargar Burbujas de Saludo (Saludo Inicial + Secuencia)
        // Ahora tratamos al 'saludoInicial' como el primer paso de la secuencia multimedia
        let secuenciaTotal = [];
        if (config.saludoInicial) {
            // Si el saludo antiguo era texto, lo convertimos a objeto
            const primerPaso = typeof config.saludoInicial === 'string' 
                ? { texto: config.saludoInicial, imagenes: [] }
                : config.saludoInicial; // Si ya era objeto con imágenes
            secuenciaTotal.push(primerPaso);
        }
        
        if (config.secuenciaBienvenida && config.secuenciaBienvenida.length > 0) {
            secuenciaTotal = [...secuenciaTotal, ...config.secuenciaBienvenida];
        }

        // Renderizar burbujas
        if (secuenciaTotal.length > 0) {
            secuenciaTotal.forEach(paso => agregarSaludoDOM(paso.texto, paso.imagenes));
        } else {
            // Si no hay nada guardado, mostramos al menos una burbuja vacía
            agregarSaludoDOM();
        }

        // Renderizar opciones guardadas (incluyendo imágenes)
        if (config.opciones) {
            config.opciones.forEach(op => agregarOpcionDOM(op.id, op.titulo, op.respuesta, op.silenciar, op.imagenes));
        }

        // Renderizar reglas IA
        if (config.reglasIA) {
            config.reglasIA.forEach(r => agregarReglaDOM(r.palabrasClave, r.respuesta, r.silenciar));
        }
    } catch (e) {
        notificar("No se pudo cargar la configuración", "error");
    }
};

const guardarConfiguracion = async () => {
    // 🔥 Reestructuración: Usaremos 'secuenciaBienvenida' como el único array multimedia
    const payload = {
        saludoInicial: "", // Lo mantendremos vacío por compatibilidad
        secuenciaBienvenida: [],
        mensajeCabecera: document.getElementById('inp-cabecera')?.value || '',
        opciones: [],
        reglasIA: []
    };

    // 🔥 Extraer Burbujas de Saludo Multimedia
    document.querySelectorAll('.item-saludo').forEach(item => {
        const txt = item.querySelector('.inp-saludo-burbuja').value.trim();
        
        // Recolectar nombres de archivos desde los data-attributes de la galería
        const imagenes = [];
        item.querySelectorAll('.galeria-item').forEach(img => imagenes.push(img.dataset.filename));

        if (txt || imagenes.length > 0) {
            payload.secuenciaBienvenida.push({
                texto: txt,
                imagenes: imagenes // Guardamos la lista de archivos
            });
        }
    });

    // Extraer Opciones
    document.querySelectorAll('.item-opcion').forEach(item => {
        const id = item.querySelector('.inp-id').value.trim();
        const titulo = item.querySelector('.inp-titulo').value.trim();
        if (id && titulo) {
            const imagenes = [];
            item.querySelectorAll('.galeria-item').forEach(img => imagenes.push(img.dataset.filename));
            payload.opciones.push({ id, titulo, imagenes, respuesta: item.querySelector('.inp-respuesta').value, silenciar: item.querySelector('.inp-silenciar').checked });
        }
    });

    // Extraer Reglas IA
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

// --- GENERADORES DE INTERFAZ (DOM) ---

const crearBotonEliminar = (elemento) => {
    const btn = document.createElement('button'); btn.className = 'btn btn-danger'; btn.innerHTML = '<i class="ph ph-trash"></i>';
    btn.onclick = () => elemento.remove(); return btn;
};

// 🔥 ACTUALIZADO: Se añade un data-index oculto para identificar a qué burbuja pertenece la foto
const agregarSaludoDOM = (texto = '', imagenes = []) => {
    const div = document.createElement('div');
    div.className = 'item-saludo';
    div.style = 'border: 1px solid #334155; padding: 15px; margin-bottom: 15px; border-radius: 6px; background: #0f172a;';
    
    // Generamos un ID aleatorio corto para esta burbuja (ej. sal_a1b2c)
    const burbujaId = 'sal_' + Math.random().toString(36).substring(7); 
    div.dataset.burbujaId = burbujaId; // Lo guardamos en el div

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

// 🔥 NUEVO: Helper para subir imagen de saludo a la API
// 🔥 ACTUALIZADO: Envía el ID único de la burbuja a la API
// 🔥 ACTUALIZADO: Helper para subir MÚLTIPLES imágenes de saludo
const subirImagenSaludo = async (input) => {
    if (!input.files || input.files.length === 0) return;

    const burbujaCard = input.closest('.item-saludo');
    const idValor = burbujaCard.dataset.burbujaId; 
    const archivos = Array.from(input.files); // Convertimos a Array para procesar todos

    notificar(`Subiendo ${archivos.length} imagen(es) a la nube...`, "info");

    for (const file of archivos) {
        const formData = new FormData();
        formData.append('imagen', file);

        try {
            const res = await fetchAPI(`/api/upload?id=${idValor}`, {
                method: 'POST',
                body: formData
            });

            if (res.success) {
                const filename = res.ruta.split('/').pop();
                burbujaCard.querySelector('.galeria-grid').appendChild(crearItemGaleria(filename));
            }
        } catch (e) {
            notificar(`Error al subir la imagen: ${file.name}`, "error");
        }
    }
    
    notificar("Carga multimedia completada", "success");
    input.value = ""; // Limpiar el input para permitir subir más luego
};

// 🔥 NUEVO: Generador de ítems de galería visual
const crearItemGaleria = (filename) => {
    const div = document.createElement('div');
    div.className = 'galeria-item';
    div.dataset.filename = filename; // Guardamos la referencia para salvarla luego
    div.style = 'position: relative; width: 60px; height: 60px; border: 1px solid #334155; border-radius: 4px; overflow: hidden;';
    
    // Mostramos la imagen usando la ruta aislada por inquilino
    div.innerHTML = `
        <img src="/uploads/tenant_${tenantId}/${filename}" style="width: 100%; height: 100%; object-fit: cover;">
        <button class="btn-del-img" style="position: absolute; top: 0; right: 0; background: rgba(0,0,0,0.5); border: none; color: white; cursor: pointer; padding: 2px;">×</button>
    `;
    div.querySelector('.btn-del-img').onclick = () => div.remove();
    return div;
};

// 🔥 ACTUALIZADO: agregarOpcionDOM (Ahora con Multimedia)
const agregarOpcionDOM = (id = '', titulo = '', respuesta = '', silenciar = false, imagenes = []) => {
    const div = document.createElement('div'); div.className = 'item-opcion'; div.style = 'border: 1px solid #334155; padding: 15px; margin-bottom: 15px; border-radius: 6px; background: #0f172a;';
    const inputId = 'file-' + Math.random().toString(36).substring(7); // ID único para el botón de subida
    
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
    
    // Precargar imágenes existentes si las hay
    const galleryGrid = div.querySelector('.galeria-grid');
    if (imagenes && imagenes.length > 0) {
        imagenes.forEach(filename => galleryGrid.appendChild(crearItemGaleria(filename)));
    }
    
    document.getElementById('contenedor-opciones').appendChild(div);
};

// 🔥 NUEVO: Función para subir la imagen a la API SaaS
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
            const res = await fetchAPI(`/api/upload?id=${idValor}`, {
                method: 'POST',
                body: formData
            });

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