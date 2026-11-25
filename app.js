// ===== Balões de aviso estilizados (substituem alert/confirm/prompt nativos) =====
function uiDialog({ message = "", type = "alert", defaultValue = "" }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'ui-dialog-overlay';
        const box = document.createElement('div');
        box.className = 'ui-dialog-box ui-dialog-' + type;
        box.setAttribute('role', type === 'alert' ? 'alertdialog' : 'dialog');
        const icon = { alert: 'fa-circle-info', confirm: 'fa-triangle-exclamation', prompt: 'fa-pen' }[type];
        const msg = document.createElement('p');
        msg.className = 'ui-dialog-message';
        msg.textContent = String(message);
        box.innerHTML = `<div class="ui-dialog-icon"><i class="fas ${icon}"></i></div>`;
        box.appendChild(msg);
        let input = null;
        if (type === 'prompt') {
            input = document.createElement('input');
            input.type = 'text'; input.className = 'ui-dialog-input'; input.value = defaultValue ?? '';
            box.appendChild(input);
        }
        const actions = document.createElement('div');
        actions.className = 'ui-dialog-actions';
        const ok = document.createElement('button');
        ok.type = 'button'; ok.className = 'ui-dialog-btn ui-dialog-btn-primary';
        ok.textContent = type === 'confirm' ? 'Confirmar' : 'OK';
        let cancel = null;
        if (type !== 'alert') {
            cancel = document.createElement('button');
            cancel.type = 'button'; cancel.className = 'ui-dialog-btn ui-dialog-btn-secondary';
            cancel.textContent = 'Cancelar';
            actions.appendChild(cancel);
        }
        actions.appendChild(ok);
        box.appendChild(actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('show'));
        const close = (val) => {
            document.removeEventListener('keydown', onKey, true);
            overlay.classList.remove('show');
            setTimeout(() => overlay.remove(), 200);
            resolve(val);
        };
        const okVal = () => type === 'prompt' ? input.value : true;
        const cancelVal = type === 'prompt' ? null : (type === 'confirm' ? false : undefined);
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancelVal); }
            else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(okVal()); }
        };
        document.addEventListener('keydown', onKey, true);
        ok.addEventListener('click', () => close(okVal()));
        if (cancel) cancel.addEventListener('click', () => close(cancelVal));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(cancelVal); });
        setTimeout(() => (input ? (input.focus(), input.select()) : ok.focus()), 50);
    });
}
function uiAlert(message) { return uiDialog({ message, type: 'alert' }); }
function uiConfirm(message) { return uiDialog({ message, type: 'confirm' }); }
function uiPrompt(message, defaultValue = '') { return uiDialog({ message, type: 'prompt', defaultValue }); }

// ==========================================
// CONFIGURAÇÃO INICIAL E CREDENCIAIS DO APP
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyA3obnKmTrF4zH6pdV8ogqZ88r7uACy3BI", 
    authDomain: "workin--music.firebaseapp.com",
    databaseURL: "https://workin--music-default-rtdb.firebaseio.com",
    projectId: "workin--music",
    storageBucket: "workin--music.firebasestorage.app",
    messagingSenderId: "588256543173",
    appId: "1:588256543173:web:eddf01b30628df90ca8bac"
};

// CHAVE DE API GLOBAL DO YOUTUBE (PROTEGIDA POR RESTRIÇÃO DE DOMÍNIO HTTP)
const YT_API_KEY_GLOBAL = "AIzaSyDHkLh2vGgxUJpVo11o1kKqtH1DQ5Toeu4";
// CHAVE DE API RESERVA DO YOUTUBE (usada automaticamente se a primeira falhar)
const YT_API_KEY_RESERVA = "COLE_AQUI_SUA_SEGUNDA_CHAVE_YOUTUBE_V3";

// ==========================================
// FALLBACK AUTOMÁTICO ENTRE CHAVES DO YOUTUBE
// Intercepta qualquer chamada à YouTube Data API v3. Se a chave atual
// falhar (cota excedida, chave inválida, bloqueio etc.), repete a mesma
// requisição com a chave reserva e passa a usá-la nas próximas chamadas.
// ==========================================
(function instalarFallbackYoutube() {
    const chaves = [YT_API_KEY_GLOBAL, YT_API_KEY_RESERVA].filter(k => k && !/^COLE_AQUI/.test(k));
    let indiceAtivo = 0;
    const fetchOriginal = window.fetch.bind(window);
    const ehYoutubeApi = (u) => typeof u === "string" && u.indexOf("googleapis.com/youtube/v3") > -1;
    const trocarChave = (u, chave) => {
        try { const url = new URL(u); if (url.searchParams.has("key")) url.searchParams.set("key", chave); return url.toString(); }
        catch (e) { return u; }
    };
    window.fetch = async function (recurso, opcoes) {
        const urlStr = typeof recurso === "string" ? recurso : (recurso && recurso.url);
        if (!ehYoutubeApi(urlStr) || chaves.length < 2 || urlStr.indexOf("key=") === -1) return fetchOriginal(recurso, opcoes);
        let ultimaResposta = null, ultimoErro = null;
        for (let t = 0; t < chaves.length; t++) {
            const idx = (indiceAtivo + t) % chaves.length;
            const url = trocarChave(urlStr, chaves[idx]);
            try {
                const resp = await fetchOriginal(typeof recurso === "string" ? url : new Request(url, recurso), opcoes);
                // 400/403/429 = chave inválida, cota esgotada ou restrição -> tenta a próxima
                if (resp.ok || [400, 403, 429].indexOf(resp.status) === -1) {
                    if (idx !== indiceAtivo) { indiceAtivo = idx; try { CONFIG.YT_API_KEY = chaves[idx]; } catch (e) {} }
                    return resp;
                }
                ultimaResposta = resp;
            } catch (e) { ultimoErro = e; }
        }
        if (ultimaResposta) return ultimaResposta;
        throw ultimoErro || new Error("Falha na YouTube API");
    };
})();

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const googleProvider = new firebase.auth.GoogleAuthProvider();
// Escopo necessário para que o usuário possa comentar nos vídeos com a própria conta Google
googleProvider.addScope("https://www.googleapis.com/auth/youtube.force-ssl");
googleProvider.setCustomParameters({ prompt: "select_account" });

// Token OAuth do Google (permite publicar comentários no YouTube)
let googleAccessToken = null;
try { googleAccessToken = sessionStorage.getItem("gToken") || null; } catch (e) { googleAccessToken = null; }

function guardarTokenGoogle(resultado) {
    try {
        const token = resultado?.credential?.accessToken;
        if (token) {
            googleAccessToken = token;
            try { sessionStorage.setItem("gToken", token); } catch (e) {}
        }
        const foto = resultado?.user?.photoURL;
        if (foto) { try { sessionStorage.setItem("gFoto", foto); } catch (e) {} }
    } catch (e) {}
}

function usuarioEhDoGoogle() {
    const u = firebase.auth().currentUser;
    return !!u && (u.providerData || []).some(p => p && p.providerId === "google.com");
}
// ==========================================
// ACESSO SEGURO AO REALTIME DATABASE
// Anexa o token de autenticação do usuário logado em
// todas as chamadas (obrigatório com regras seguras ativas)
// ==========================================
async function dbFetch(url, opcoes) {
    const usuario = firebase.auth().currentUser;
    if (usuario) {
        const token = await usuario.getIdToken();
        const separador = url.includes("?") ? "&" : "?";
        url = `${url}${separador}auth=${encodeURIComponent(token)}`;
    }
    return fetch(url, opcoes);
}


// Configurações globais dinâmicas (A URL do banco continua vindo por usuário)
let CONFIG = { YT_API_KEY: YT_API_KEY_GLOBAL, FIREBASE_URL: "" };

let currentUserUid = "";
let database = [];
let canaisDinamicos = {};
let currentView = 'categories'; 
let selectedCategory = '';
let selectedSubcategory = '';
let currentPlaylist = [];
let currentTrackIndex = 0;
let ytPlayer = null;
let lastYtSearchResults = [];
let lastLocalSearchResults = []; 
let lastLocalCatResults = [];
let lastLocalSubResults = [];

// ==========================================
// ORDENACAO: CATEGORIAS, SUBCATEGORIAS E MIDIAS
// ==========================================
let ordemAtual = 'catalogo'; // padrao das MIDIAS: ordem de catalogacao
let ordemAtualNomes = 'az'; // padrao de CATEGORIAS/SUBCATEGORIAS: ordem alfabetica (A -> Z)
let duracoesCache = {};
let buscandoDuracoes = false;


// ==========================================
// THUMBNAILS DO YOUTUBE EM ALTA DEFINIÇÃO
// Sempre prefere maxres > standard > high > medium > default
// ==========================================
function melhorThumbYoutube(snippet) {
    const t = (snippet && snippet.thumbnails) || {};
    return (t.maxres || t.standard || t.high || t.medium || t.default || {}).url || '';
}

// URL direta pela ID do vídeo: tenta maxresdefault e cai para hqdefault se não existir
function thumbAltaPorId(videoId) {
    return videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : '';
}

// Encadeia fallback de resolução na tag <img>: maxres -> sd -> hq -> mq
function atributoFallbackThumb(videoId) {
    if (!videoId) return '';
    return ` onerror="this.onerror=null; var b='https://img.youtube.com/vi/${videoId}/'; if(this.src.indexOf('maxresdefault')>-1)this.src=b+'sddefault.jpg'; else if(this.src.indexOf('sddefault')>-1)this.src=b+'hqdefault.jpg'; else if(this.src.indexOf('hqdefault')>-1)this.src=b+'mqdefault.jpg';"`;
}

function comparadorTexto(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'pt-BR', { sensitivity: 'base', numeric: true });
}

function ordenarNomes(lista) {
    const copia = [...lista];
    if (ordemAtualNomes === 'az') return copia.sort(comparadorTexto);
    if (ordemAtualNomes === 'za') return copia.sort((a, b) => comparadorTexto(b, a));
    return copia;
}

function chaveDuracao(track) {
    const vid = extractYoutubeId((track && track.link) || '');
    return vid ? `yt:${vid}` : `url:${((track && track.link) || '').trim()}`;
}

function duracaoDaFaixa(track) {
    const v = duracoesCache[chaveDuracao(track)];
    return typeof v === 'number' ? v : null;
}

function ordenarFaixas(lista) {
    const copia = [...lista];
    if (ordemAtual === 'az') return copia.sort((a, b) => comparadorTexto(a.título, b.título));
    if (ordemAtual === 'za') return copia.sort((a, b) => comparadorTexto(b.título, a.título));
    if (ordemAtual === 'dur-asc' || ordemAtual === 'dur-desc') {
        garantirDuracoes(copia);
        const fator = ordemAtual === 'dur-asc' ? 1 : -1;
        return copia.sort((a, b) => {
            const da = duracaoDaFaixa(a); const db = duracaoDaFaixa(b);
            if (da === null && db === null) return comparadorTexto(a.título, b.título);
            if (da === null) return 1;
            if (db === null) return -1;
            return (da - db) * fator;
        });
    }
    return copia;
}

function iso8601ParaSegundos(iso) {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
    if (!m) return null;
    return (parseInt(m[1] || 0, 10) * 86400) + (parseInt(m[2] || 0, 10) * 3600) + (parseInt(m[3] || 0, 10) * 60) + parseInt(m[4] || 0, 10);
}

function lerDuracaoDeArquivo(track) {
    return new Promise(resolve => {
        const link = ((track && track.link) || '').trim();
        const ehArquivo = (/\.(mp4|mkv|webm|mov|m4v|avi|flv|ogv)(\?|$)/i.test(link) || ehArquivoDeAudio(link)) || link.includes('raw.githubusercontent');
        if (!ehArquivo) { duracoesCache[chaveDuracao(track)] = null; return resolve(); }
        const el = document.createElement(ehArquivoDeAudio(link) ? 'audio' : 'video');
        let encerrado = false;
        const finalizar = (valor) => {
            if (encerrado) return; encerrado = true;
            duracoesCache[chaveDuracao(track)] = valor;
            try { el.removeAttribute('src'); el.load(); } catch (e) {}
            resolve();
        };
        el.preload = 'metadata';
        el.onloadedmetadata = () => finalizar(isFinite(el.duration) ? Math.round(el.duration) : null);
        el.onerror = () => finalizar(null);
        setTimeout(() => finalizar(null), 6000);
        el.src = link;
    });
}

// ===== VISUALIZAÇÕES =====
// YouTube: views públicas vindas da API. Links diretos: reproduções do usuário dentro do app.
const viewsYoutubeCache = {};
function chaveViewsLocais() { return 'midiaViewsApp_' + (currentUserUid || 'anon'); }
function lerViewsLocais() { try { return JSON.parse(localStorage.getItem(chaveViewsLocais()) || '{}'); } catch (e) { return {}; } }
function idViewLocal(track) { return String((track && track.link) || (track && track.título) || ''); }
function registrarViewLocal(track) {
    if (!track || extractYoutubeId(track.link || '')) return;
    const mapa = lerViewsLocais(); const k = idViewLocal(track); if (!k) return;
    mapa[k] = (mapa[k] || 0) + 1;
    try { localStorage.setItem(chaveViewsLocais(), JSON.stringify(mapa)); } catch (e) {}
}
function formatarViews(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    const f = (v, suf) => (v >= 10 ? Math.floor(v) : Math.floor(v * 10) / 10).toString().replace('.', ',') + suf;
    if (n >= 1e9) return f(n / 1e9, ' bi'); if (n >= 1e6) return f(n / 1e6, ' mi'); if (n >= 1e3) return f(n / 1e3, ' mil');
    return String(n);
}
function seloViews(track) {
    if (!track) return '';
    const vid = extractYoutubeId(track.link || '');
    if (vid) {
        const n = viewsYoutubeCache[vid];
        if (n === undefined) return '';
        return `<span class="views-badge views-yt" title="${n.toLocaleString('pt-BR')} visualizações no YouTube"><i class="fab fa-youtube"></i> ${formatarViews(n)}</span>`;
    }
    const n = lerViewsLocais()[idViewLocal(track)] || 0;
    return `<span class="views-badge views-app" title="${n} reprodução(ões) suas no app"><i class="fas fa-eye"></i> ${formatarViews(n)}</span>`;
}

async function garantirDuracoes(lista) {
    if (buscandoDuracoes) return;
    const pendentesYt = []; const pendentesArquivo = [];
    lista.forEach(track => {
        const chave = chaveDuracao(track);
        if (duracoesCache[chave] !== undefined) return;
        if (chave.startsWith('yt:')) pendentesYt.push(chave.slice(3));
        else pendentesArquivo.push(track);
    });
    if (pendentesYt.length === 0 && pendentesArquivo.length === 0) return;
    buscandoDuracoes = true;
    try {
        for (let i = 0; i < pendentesYt.length; i += 50) {
            const bloco = pendentesYt.slice(i, i + 50);
            try {
                const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${bloco.join(',')}&key=${CONFIG.YT_API_KEY}`);
                const data = await res.json();
                (data.items || []).forEach(item => {
                    duracoesCache[`yt:${item.id}`] = iso8601ParaSegundos(item.contentDetails && item.contentDetails.duration);
                    if (item.statistics && item.statistics.viewCount !== undefined) viewsYoutubeCache[item.id] = Number(item.statistics.viewCount);
                });
            } catch (e) {}
            bloco.forEach(id => { if (duracoesCache[`yt:${id}`] === undefined) duracoesCache[`yt:${id}`] = null; });
        }
        await Promise.all(pendentesArquivo.slice(0, 40).map(track => lerDuracaoDeArquivo(track)));
        pendentesArquivo.forEach(t => { const k = chaveDuracao(t); if (duracoesCache[k] === undefined) duracoesCache[k] = null; });
    } finally {
        buscandoDuracoes = false;
        renderMosaic();
    }
}

function formatarDuracao(seg) {
    if (typeof seg !== 'number' || !isFinite(seg)) return '';
    const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = Math.floor(seg % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function definirOrdenacao(valor) {
    ordemAtual = valor || 'catalogo';
    // Duração não se aplica a nomes: categorias/subcategorias caem para a ordem de catalogação
    ordemAtualNomes = (valor === 'dur-asc' || valor === 'dur-desc') ? 'catalogo' : (valor || 'catalogo');
    renderMosaic();
    // O filtro escolhido tambem reordena o menu lateral de categorias/subcategorias
    try { renderSidebar(); } catch (e) {}
}

function atualizarBarraOrdenacao() {
    const barra = document.getElementById('sort-bar');
    const select = document.getElementById('sort-select');
    if (!barra || !select) return;
    const ehMidias = currentView === 'tracks' || currentView === 'search_local_results';
    const rotulo = document.getElementById('sort-label-target');
    if (rotulo) rotulo.innerText = currentView === 'categories' ? 'categorias' : (currentView === 'subcategories' ? 'subcategorias' : 'mídias');
    if (currentView === 'search_results') { barra.classList.add('hidden'); return; }
    barra.classList.remove('hidden');
    const opcoes = [
        ['catalogo', 'Ordem de catalogação'],
        ['az', 'Título (A → Z) (padrão)'],
        ['za', 'Título (Z → A)']
    ];
    if (ehMidias) {
        opcoes.push(['dur-asc', 'Duração (menor → maior)']);
        opcoes.push(['dur-desc', 'Duração (maior → menor)']);
    }
    select.innerHTML = opcoes.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    select.value = ehMidias ? ordemAtual : ordemAtualNomes;
}

// ==========================================
// REPRODUCAO ALEATORIA (SHUFFLE) NOS PLAYERS
// ==========================================
let reproducaoAleatoria = false;
let jaSorteadas = [];

function alternarReproducaoAleatoria() {
    reproducaoAleatoria = !reproducaoAleatoria;
    jaSorteadas = reproducaoAleatoria ? [currentTrackIndex] : [];
    atualizarBotaoAleatorio();
}

function atualizarBotaoAleatorio() {
    document.querySelectorAll('#btn-shuffle').forEach(btn => {
        btn.classList.toggle('active', reproducaoAleatoria);
        btn.setAttribute('aria-pressed', reproducaoAleatoria ? 'true' : 'false');
        btn.title = reproducaoAleatoria ? 'Reprodução aleatória: ligada' : 'Reprodução aleatória: desligada';
    });
}

function sortearProximoIndice() {
    const total = currentPlaylist.length;
    if (total <= 1) return currentTrackIndex;
    if (jaSorteadas.length >= total) jaSorteadas = [currentTrackIndex];
    const disponiveis = [];
    for (let i = 0; i < total; i++) if (!jaSorteadas.includes(i)) disponiveis.push(i);
    if (disponiveis.length === 0) return currentTrackIndex;
    const escolhido = disponiveis[Math.floor(Math.random() * disponiveis.length)];
    jaSorteadas.push(escolhido);
    return escolhido;
}

function avancarFaixa() {
    if (currentPlaylist.length === 0) return;
    if (reproducaoAleatoria) { playTrack(sortearProximoIndice()); return; }
    if (currentTrackIndex + 1 < currentPlaylist.length) playTrack(currentTrackIndex + 1);
}

function voltarFaixa() {
    if (currentPlaylist.length === 0) return;
    if (reproducaoAleatoria) {
        jaSorteadas.pop();
        const anterior = jaSorteadas[jaSorteadas.length - 1];
        if (typeof anterior === 'number') { playTrack(anterior); return; }
        playTrack(sortearProximoIndice());
        return;
    }
    if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('sort-select')?.addEventListener('change', (e) => definirOrdenacao(e.target.value));
    atualizarBotaoAleatorio();
});

let activeEditingIndex = null;
let canalSelecionadoProvisorio = null;

let expandedCrudCats = {};
let expandedCrudSubs = {};

// Variável local para rastrear as mudanças temporárias de cor do perfil
let corPerfilTemporaria = "";

// Validador de Provedores de E-mail Reais e Famosos
function verificarProvedorValido(email) {
    const provedoresPermitidos = [
        'gmail.com', 
        'outlook.com', 'outlook.com.br', 
        'hotmail.com', 'hotmail.com.br', 
        'live.com', 'live.com.br',
        'yahoo.com', 'yahoo.com.br', 
        'icloud.com', 
        'uol.com.br', 'bol.com.br', 'ig.com.br'
    ];
    const dominio = email.split('@')[1];
    return provedoresPermitidos.includes(dominio);
}

// Abre o modal de perfil e preenche os campos com os dados antigos salvos no banco
async function abrirModalPerfil() {
    if (!currentUserUid) return;
    
    // Se o aviso de novidade na tela estiver aberto, remove ele
    document.getElementById('alert-novidade-perfil')?.remove();

    try {
        const urlBaseBanco = firebaseConfig.databaseURL.replace(/\/$/, "");
        let res = await dbFetch(`${urlBaseBanco}/usuarios/${currentUserUid}.json`);
        let perfil = await res.json();
        
        if (perfil) {
            document.getElementById('profile-edit-name').value = perfil.nome || "";
            document.getElementById('profile-edit-lastname').value = perfil.sobrenome || "";

            // Contato: e-mail somente leitura + WhatsApp com máscara, cidade e UF
            inicializarCamposContato();
            const emailAtual = (firebase.auth().currentUser?.email) || perfil.email || "";
            definirValorCampo('profile-edit-email', emailAtual);
            definirValorCampo('profile-edit-whatsapp', formatarWhatsApp(perfil.whatsapp || ""));
            definirValorCampo('profile-edit-cidade', perfil.cidade || "");
            definirValorCampo('profile-edit-uf', perfil.uf || "");
            
            // Inicializa a cor padrão baseada no que está na nuvem
            corPerfilTemporaria = perfil.cor_tema || "#ff0000";
            const txtHexPerfil = document.getElementById('profile-theme-color-hex');
            if(txtHexPerfil) txtHexPerfil.innerText = corPerfilTemporaria.toUpperCase();
            
            const selectorPerfil = document.getElementById('profile-color-spectrum-selector');
            if(selectorPerfil) selectorPerfil.style.left = "50%"; 
        }
        
        document.getElementById('profile-modal')?.classList.remove('hidden');
    } catch (e) {
        console.error("Erro ao carregar dados do perfil para edição:", e);
    }
}

// Fecha a janela de edição de perfil
function fecharModalPerfil() {
    document.getElementById('profile-modal')?.classList.add('hidden');
}

// Alterna visualmente entre os formulários de login, cadastro e recuperação preservando a logo
function alternarAbasLogin(modo) {
    const formLogin = document.getElementById('form-login-fluxo');
    const formCadastro = document.getElementById('form-cadastro-fluxo');
    const formRecuperar = document.getElementById('form-recuperar-fluxo');
    const titulo = document.getElementById('login-title');
    
    // Oculta todas as abas por padrão para evitar sobreposição
    formLogin.classList.add('hidden');
    formCadastro.classList.add('hidden');
    formRecuperar.classList.add('hidden');
    
    if (modo === 'cadastro') {
        formCadastro.classList.remove('hidden');
        titulo.innerText = "Criar Conta";
    } else if (modo === 'recuperar') {
        formRecuperar.classList.remove('hidden');
        titulo.innerText = "Recuperar Senha";
    } else {
        formLogin.classList.remove('hidden');
        titulo.innerText = "StreamHub";
    }
}

function obterUrlNodoItem(idItem = null) {
    let urlSemJson = CONFIG.FIREBASE_URL.replace(".json", "");
    return idItem ? `${urlSemJson}/${idItem}.json` : CONFIG.FIREBASE_URL;
}

function obterUrlBaseCanais() {
    return CONFIG.FIREBASE_URL.replace("midias.json", "canais_dinamicos.json");
} 

function aplicarCorTema(hexColor) {
    document.documentElement.style.setProperty('--theme-color', hexColor);
    let num = parseInt(hexColor.replace("#",""), 16);
    let r = (num >> 16) - 20; let g = ((num >> 8) & 0x00FF) - 20; let b = (num & 0x0000FF) - 20;
    r = r < 0 ? 0 : r; g = g < 0 ? 0 : g; b = b < 0 ? 0 : b;
    let hexHover = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    document.documentElement.style.setProperty('--theme-color-hover', hexHover);
    
    const txtHex = document.getElementById('theme-color-hex');
    if(txtHex) txtHex.innerText = hexColor.toUpperCase();
    
    const txtHexPerfil = document.getElementById('profile-theme-color-hex');
    if(txtHexPerfil) txtHexPerfil.innerText = hexColor.toUpperCase();
}

function posicionarSetaPelaCor(hexColor) {
    const selector = document.getElementById('color-spectrum-selector'); if (!selector) return;
    if(hexColor.toLowerCase() === "#ff0000" || hexColor.toLowerCase() === "#e50914") selector.style.left = "12%";
    if(hexColor.toLowerCase() === "#00f0ff") selector.style.left = "50%";
}

// Salva as preferências de customização respeitando o projeto configurado no topo
async function salvarPreferenciaNoFirebase(dadosModificados) {
    if (!currentUserUid || !firebaseConfig.databaseURL) return;
    try {
        const urlBaseBanco = firebaseConfig.databaseURL.replace(/\/$/, "");
        await dbFetch(`${urlBaseBanco}/usuarios/${currentUserUid}.json`, {
            method: "PATCH",
            body: JSON.stringify(dadosModificados),
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) { console.error("Erro ao salvar preferências na nuvem:", e); }
}

function checkSession() {
    firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
            currentUserUid = user.uid;
            
            try {
                const urlBaseBanco = firebaseConfig.databaseURL.replace(/\/$/, "");
                let resPerfil = await dbFetch(`${urlBaseBanco}/usuarios/${currentUserUid}.json`);
                let perfil = await resPerfil.json();
                
                if (!perfil) {
                    let nomeCompleto = user.displayName || "Usuário";
                    let partesNome = nomeCompleto.split(" ");
                    let primeiroNome = partesNome[0];
                    let sobrenome = partesNome.slice(1).join(" ") || "Google";

                    perfil = {
                        nome: primeiroNome,
                        sobrenome: sobrenome,
                        cor_tema: "#ff0000",
                        tema: "",
                        foto: user.photoURL || "",
                        firebaseUrl: `${urlBaseBanco}/usuarios/${currentUserUid}/midias.json`
                    };
                    await salvarPreferenciaNoFirebase(perfil);
                }
                // Se entrou com o Google e ainda não tem foto salva, usa o avatar da conta Google
                else if (!perfil.foto && user.photoURL) {
                    perfil.foto = user.photoURL;
                    await salvarPreferenciaNoFirebase({ foto: user.photoURL });
                }
                
                CONFIG.FIREBASE_URL = perfil.firebaseUrl;
                CONFIG.YT_API_KEY = YT_API_KEY_GLOBAL;
                carregarFavoritosDoPerfil(perfil.favoritos);
                
                aplicarCorTema(perfil.cor_tema || "#ff0000");
                posicionarSetaPelaCor(perfil.cor_tema || "#ff0000");
                document.body.className = perfil.tema || "";
                
                if (perfil.nome && perfil.nome !== "Usuário") {
                    const elBadge = document.getElementById('user-profile-display');
                    const elTxt = document.getElementById('user-top-name');
                    if(elBadge && elTxt) {
                        elTxt.innerText = `Olá, ${perfil.nome}!`;
                        elBadge.classList.remove('hidden');
                    }
                } else {
                    if(!document.getElementById('alert-novidade-perfil')) {
                        const aviso = document.createElement('div');
                        aviso.className = 'alert-novidade-box';
                        aviso.id = 'alert-novidade-perfil';
                        aviso.style.cursor = 'pointer';
                        
                        aviso.onclick = (e) => {
                            if(e.target.tagName !== 'BUTTON') abrirModalPerfil();
                        };
                        aviso.innerHTML = `
                            <div style="font-weight:bold; margin-bottom:5px;">Novidade no StreamHub! 🎉</div>
                            <p style="font-size:0.85rem; margin:0 0 10px 0; line-height:1.2rem;">Agora você pode personalizar seu perfil com nome, sobrenome e tema. <strong>Clique aqui para configurar!</strong></p>
                            <button onclick="event.stopPropagation(); document.getElementById('alert-novidade-perfil').remove()" style="background:var(--theme-color); border:none; color:#fff; padding:4px 10px; border-radius:3px; cursor:pointer; font-size:0.8rem; font-weight:bold;">Fechar</button>
                        `;
                        document.body.appendChild(aviso);
                    }
                }
                
            } catch (err) {
                console.error("Erro ao inicializar perfil seguro:", err);
                CONFIG.FIREBASE_URL = `${firebaseConfig.databaseURL.replace(/\/$/, "")}/usuarios/${currentUserUid}/midias.json`;
                CONFIG.YT_API_KEY = YT_API_KEY_GLOBAL;
            }
            
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('app-container').classList.remove('hidden');
            
            const btnTabUsers = document.getElementById('tab-trigger-users');
            if (user.email === "admin@admin.com") {
                btnTabUsers?.classList.remove('hidden');
            } else {
                btnTabUsers?.classList.add('hidden');
            }

            initApp();
            esconderCarregandoLogin();
            return;
        }
        esconderCarregandoLogin();
        limparInterfaceLocal();
    });
}

function configurarEventosLogin() {
    const inputUser = document.getElementById('login-user');
    const inputPass = document.getElementById('login-pass');
    const inputRecover = document.getElementById('recover-email');
    const btnLogin = document.getElementById('btn-login');

    if (inputUser) { inputUser.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (inputPass) inputPass.focus(); } }; }
    if (inputPass) { inputPass.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleLogin(); } }; }
    if (inputRecover) { inputRecover.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handlePasswordRecovery(); } }; }
    if (btnLogin) { btnLogin.onclick = (e) => { e.preventDefault(); handleLogin(); }; }
}

// Tela de carregamento com animação spin exibida durante o login
function mostrarCarregandoLogin(texto) {
    let ov = document.getElementById('login-loading-overlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'login-loading-overlay';
        ov.innerHTML = '<div class="login-loading-box"><div class="login-spinner"></div><p class="login-loading-text"></p></div>';
        document.body.appendChild(ov);
    }
    ov.querySelector('.login-loading-text').textContent = texto || 'Entrando...';
    requestAnimationFrame(() => ov.classList.add('ativo'));
}
function esconderCarregandoLogin() {
    const ov = document.getElementById('login-loading-overlay');
    if (ov) ov.classList.remove('ativo');
}

function handleLogin() {
    const elUser = document.getElementById('login-user');
    const elPass = document.getElementById('login-pass');
    if(!elUser || !elPass) return;
    const inputEmail = elUser.value.trim().toLowerCase();
    const inputPass = elPass.value.trim();
    if (!inputEmail || !inputPass) return uiAlert("Preencha todos os campos!");
    
    const btnLogin = document.getElementById('btn-login');
    btnLogin.innerText = "Autenticando..."; btnLogin.disabled = true;
    mostrarCarregandoLogin("Autenticando...");

    firebase.auth().signInWithEmailAndPassword(inputEmail, inputPass)
        .catch((error) => {
            esconderCarregandoLogin();
            uiAlert("Erro na Autenticação: " + error.message);
            btnLogin.innerText = "Entrar"; btnLogin.disabled = false;
        });
}

// Dispara o e-mail nativo de redefinição de senha do Firebase Auth
function handlePasswordRecovery() {
    const elEmail = document.getElementById('recover-email');
    if (!elEmail) return;
    
    const email = elEmail.value.trim().toLowerCase();
    if (!email) return uiAlert("Por favor, digite o seu e-mail cadastrado!");
    
    const btnRecover = document.getElementById('btn-recover-submit');
    btnRecover.innerText = "Enviando link..."; btnRecover.disabled = true;
    
    firebase.auth().sendPasswordResetEmail(email)
        .then(() => {
            uiAlert(`Link de redefinição enviado com sucesso para: ${email}\nVerifique a sua caixa de entrada ou spam!`);
            document.getElementById('form-recuperar-fluxo').reset();
            alternarAbasLogin('login'); // Retorna automaticamente para a tela de login
        })
        .catch((error) => {
            uiAlert("Erro ao solicitar link: " + error.message);
        })
        .finally(() => {
            btnRecover.innerText = "Enviar Link de Recuperação"; btnRecover.disabled = false;
        });
}

function handleLogoutActions() {
    firebase.auth().signOut().then(() => { limparInterfaceLocal(); });
}

function limparInterfaceLocal() {
    document.body.className = ""; 
    currentUserUid = ""; CONFIG.FIREBASE_URL = ""; CONFIG.YT_API_KEY = YT_API_KEY_GLOBAL;
    if (ytPlayer) { try { ytPlayer.stopVideo(); } catch(e){} }
    if (document.getElementById('universal-player')) document.getElementById('universal-player').src = "";
    try { pararStreamAtual(); } catch (e) {}
    if (document.getElementById('raw-player')) { document.getElementById('raw-player').pause(); document.getElementById('raw-player').src = ""; }
    esconderPalcoDeAudio();
    if (document.getElementById('login-user')) document.getElementById('login-user').value = "";
    if (document.getElementById('login-pass')) document.getElementById('login-pass').value = "";
    if (document.getElementById('recover-email')) document.getElementById('recover-email').value = "";
    if (document.getElementById('btn-login')) {
        document.getElementById('btn-login').innerText = "Entrar";
        document.getElementById('btn-login').disabled = false;
    }
    if (document.getElementById('app-container')) document.getElementById('app-container').classList.add('hidden');
    if (document.getElementById('login-screen')) document.getElementById('login-screen').classList.remove('hidden');
    if (document.getElementById('btn-google-login')) {
        document.getElementById('btn-google-login').innerHTML = '<i class="fab fa-google"></i> Entrar com o Google';
        document.getElementById('btn-google-login').disabled = false;
    }
    if (document.getElementById('user-profile-display')) document.getElementById('user-profile-display').classList.add('hidden');
}

async function initApp() { await carregarCanaisDinamicos(); await recarregarDadosDoBanco(); }

async function recarregarDadosDoBanco() {
    try {
        const res = await dbFetch(CONFIG.FIREBASE_URL); const data = await res.json(); database = [];
        if (data) {
            if (Array.isArray(data)) { database = data.filter(item => item !== null); } 
            else { Object.keys(data).forEach(key => { if (data[key]) database.push({ idFirebase: key, ...data[key] }); }); }
        }
    } catch (e) { console.log("Erro ao carregar mídias.", e); }
    finally { renderSidebar(); renderMosaic(); alimentarSeletorCategoriasCanais(); }
}

async function carregarCanaisDinamicos() {
    try { 
        const res = await dbFetch(obterUrlBaseCanais()); 
        if (!res.ok) { canaisDinamicos = {}; return; }
        const data = await res.json(); 
        canaisDinamicos = data || {}; 
    } catch (e) { 
        console.error("Erro canais:", e); 
        canaisDinamicos = {}; 
    }
}

function alimentarSeletorCategoriasCanais() {
    const select = document.getElementById("channel-target-category"); if (!select) return; select.innerHTML = "";
    const categories = [...new Set(database.map(item => item.categoria))];
    Object.keys(canaisDinamicos).forEach(key => { try { const catNome = decodeURIComponent(escape(atob(key))); if(!categories.includes(catNome)) categories.push(catNome); } catch(e){} });
    categories.sort();
    if(categories.length === 0) { select.innerHTML = `<option value="">Nenhuma categoria encontrada.</option>`; return; }
    categories.forEach(cat => { const opt = document.createElement("option"); opt.value = cat; opt.innerText = cat; select.appendChild(opt); });
}

function renderMosaic() {
    const grid = document.getElementById('mosaic-grid'); if (!grid) return; grid.innerHTML = '';
    atualizarBarraOrdenacao();
    const bcCat = document.getElementById('bc-category'); const bcSub = document.getElementById('bc-subcategory'); const bcSrc = document.getElementById('bc-search');
    if (bcCat) bcCat.classList.add('hidden'); if (bcSub) bcSub.classList.add('hidden'); if (bcSrc) bcSrc.classList.add('hidden');

    if (currentView === 'categories') {
        const categories = [...new Set(database.map(item => item.categoria))];
        Object.keys(canaisDinamicos).forEach(key => { try { const c = decodeURIComponent(escape(atob(key))); if(!categories.includes(c)) categories.push(c); } catch(e){} });
        ordenarNomes(categories).forEach(cat => {
            if(!cat) return; const match = database.find(item => item.categoria === cat); const nodeName = btoa(unescape(encodeURIComponent(cat))).replace(/=/g, "");
            const thumbCapa = match ? match.capa : (canaisDinamicos[nodeName] ? canaisDinamicos[nodeName].thumb : '');
            grid.appendChild(createCard(cat, thumbCapa, false, false, () => { selectedCategory = cat; currentView = 'subcategories'; renderMosaic(); }, -1, null, { tipo: 'categoria', categoria: cat }));
        });
    } 
    else if (currentView === 'subcategories') {
        if (bcCat) { bcCat.classList.remove('hidden'); bcCat.querySelector('.txt').innerText = selectedCategory; }
        const subcategories = [...new Set(database.filter(item => item.categoria === selectedCategory).map(item => item.subcategoria))];
        const nodeName = btoa(unescape(encodeURIComponent(selectedCategory))).replace(/=/g, "");
        if (canaisDinamicos[nodeName] && !subcategories.includes("Vídeos Recentes")) subcategories.push("Vídeos Recentes");
        
        ordenarNomes(subcategories).forEach(sub => {
            const match = database.find(item => item.categoria === selectedCategory && item.subcategoria === sub);
            grid.appendChild(createCard(sub, match ? match.capa : (canaisDinamicos[nodeName] ? canaisDinamicos[nodeName].thumb : ''), false, false, () => { selectedSubcategory = sub; currentView = 'tracks'; renderMosaic(); }, -1, null, { tipo: 'subcategoria', categoria: selectedCategory, subcategoria: sub }));
        });
    } 
    else if (currentView === 'tracks') {
        if (bcCat) { bcCat.classList.remove('hidden'); bcCat.querySelector('.txt').innerText = selectedCategory; }
        if (bcSub) { bcSub.classList.remove('hidden'); bcSub.querySelector('.txt').innerText = selectedSubcategory; }

        if (selectedSubcategory === "Vídeos Recentes") {
            const nodeName = btoa(unescape(encodeURIComponent(selectedCategory))).replace(/=/g, "");
            if (canaisDinamicos[nodeName]) buscarVideosRecentesDoCanal(canaisDinamicos[nodeName].uploadsPlaylistId);
        } else {
            currentPlaylist = ordenarFaixas(database.filter(item => item.categoria === selectedCategory && item.subcategoria === selectedSubcategory));
            garantirDuracoes(currentPlaylist);
            currentPlaylist.forEach((track, index) => {
                const realIndex = database.findIndex(dbItem => dbItem.link === track.link && dbItem.título === track.título);
                grid.appendChild(createCard(track.título, track.capa, false, false, () => { playTrack(index); }, realIndex, track, { tipo: 'midia', track: track }));
            });
        }
    }
    else if (currentView === 'search_results') {
        if (bcSrc) bcSrc.classList.remove('hidden');
        lastYtSearchResults.forEach(item => {
            const isPlaylist = item.type === 'playlist'; const card = createCard(item.title, item.thumb, true, isPlaylist, null, -1, { título: item.title, capa: item.thumb, link: isPlaylist ? `https://www.youtube.com/playlist?list=${item.youtubeId}` : `https://www.youtube.com/embed/${item.youtubeId}` });
            if (card.querySelector('.add-music-badge')) { card.querySelector('.add-music-badge').onclick = (e) => { e.preventDefault(); e.stopPropagation(); openAdminWithTrack(item); }; }
            const btnGroup = document.createElement('div'); btnGroup.className = 'search-btn-group';
            const btnPlay = document.createElement('button'); btnPlay.style.background = '#2980b9'; btnPlay.innerHTML = `<i class="fas fa-play"></i> Assistir`;
            btnPlay.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                currentPlaylist = [{ título: item.title, link: isPlaylist ? `https://www.youtube.com/embed/videoseries?list=${item.youtubeId}` : `https://www.youtube.com/embed/${item.youtubeId}` }]; playTrack(0);
            };
            btnGroup.appendChild(btnPlay);
            if(isPlaylist) {
                const btnList = document.createElement('button'); btnList.style.background = '#8e44ad'; btnList.innerHTML = `<i class="fas fa-list"></i> Ver Mídias`;
                btnList.onclick = (e) => { e.preventDefault(); e.stopPropagation(); peekPlaylistContents(item.youtubeId); }; btnGroup.appendChild(btnList);
            }
            card.appendChild(btnGroup); grid.appendChild(card);
        });
    }
    else if (currentView === 'search_local_results') {
        if (bcSrc) {
            bcSrc.classList.remove('hidden');
            bcSrc.innerHTML = ` &gt; <i class="fas fa-search"></i> Resultados Locais para: "${document.getElementById('search-internal-input').value}"`;
        }

        const totalResultados = lastLocalSearchResults.length + lastLocalCatResults.length + lastLocalSubResults.length;
        if (totalResultados === 0) {
            grid.innerHTML = '<h3 style="color: var(--text-gray); padding: 20px;">Nada encontrado no seu acervo local (mídias, categorias ou subcategorias).</h3>';
            return;
        }

        const tituloGrupo = (texto) => {
            const h = document.createElement('div');
            h.className = 'local-result-group-title';
            h.innerText = texto;
            grid.appendChild(h);
        };

        // Categorias encontradas na pesquisa local
        if (lastLocalCatResults.length > 0) {
            tituloGrupo(`Categorias (${lastLocalCatResults.length})`);
            lastLocalCatResults.forEach(cat => {
                const nodeName = btoa(unescape(encodeURIComponent(cat))).replace(/=/g, "");
                const match = database.find(item => item.categoria === cat);
                const capa = match ? match.capa : (canaisDinamicos[nodeName] ? canaisDinamicos[nodeName].thumb : '');
                const card = createCard(cat, capa, false, false, () => {
                    selectedCategory = cat; selectedSubcategory = ''; currentView = 'subcategories'; renderMosaic();
                }, -1, null, { tipo: 'categoria', categoria: cat });
                card.insertAdjacentHTML('afterbegin', '<span class="local-kind-badge"><i class="fas fa-folder"></i> Categoria</span>');
                grid.appendChild(card);
            });
        }

        // Subcategorias encontradas na pesquisa local
        if (lastLocalSubResults.length > 0) {
            tituloGrupo(`Subcategorias (${lastLocalSubResults.length})`);
            lastLocalSubResults.forEach(par => {
                const match = database.find(item => item.categoria === par.categoria && item.subcategoria === par.subcategoria);
                const card = createCard(`${par.subcategoria}`, match ? match.capa : '', false, false, () => {
                    selectedCategory = par.categoria; selectedSubcategory = par.subcategoria; currentView = 'tracks'; renderMosaic();
                }, -1, null, { tipo: 'subcategoria', categoria: par.categoria, subcategoria: par.subcategoria });
                card.insertAdjacentHTML('afterbegin', `<span class="local-kind-badge"><i class="fas fa-video"></i> ${par.categoria}</span>`);
                grid.appendChild(card);
            });
        }

        if (lastLocalSearchResults.length > 0) {
            tituloGrupo(`Mídias (${lastLocalSearchResults.length})`);
            currentPlaylist = ordenarFaixas(lastLocalSearchResults);
            garantirDuracoes(currentPlaylist);
            currentPlaylist.forEach((track, index) => {
                const realIndex = database.findIndex(dbItem => dbItem.link === track.link && dbItem.título === track.título);
                grid.appendChild(createCard(track.título, track.capa, false, false, () => { playTrack(index); }, realIndex, track, { tipo: 'midia', track: track }));
            });
        }
    }
}

function alternarModoCategoriaCanal(modo) {
    const wrapExistente = document.getElementById('wrapper-channel-cat-existente');
    const wrapNova = document.getElementById('wrapper-channel-cat-nova');
    
    if (modo === 'nova') {
        wrapExistente.classList.add('hidden');
        wrapNova.classList.remove('hidden');
        document.getElementById('channel-target-category-new').focus();
    } else {
        wrapNova.classList.add('hidden');
        wrapExistente.classList.remove('hidden');
    }
}

function createCard(title, imgSrc, showAddButton = false, isPlaylist = false, clickCallback, realIndex = -1, shareInfo = null, favInfo = null) {
    const card = document.createElement('div'); card.className = 'card';
    let selo = '';
    if (favInfo && favInfo.tipo === 'midia') {
        const seg = duracaoDaFaixa(favInfo.track || shareInfo || {});
        const txt = formatarDuracao(seg);
        if (txt) selo = `<span class="duration-badge"><i class="fas fa-clock"></i> ${txt}</span>`;
        selo += seloViews(favInfo.track || shareInfo);
    }
    const vidCard = extractYoutubeId((shareInfo && shareInfo.link) || '') || extractYoutubeId(imgSrc || '');
    const srcCard = (!imgSrc && vidCard) ? thumbAltaPorId(vidCard) : (imgSrc || 'https://placehold.co/160x90?text=Sem+Capa');
    let htmlContent = `<div class="card-thumb"><img src="${srcCard}"${atributoFallbackThumb(vidCard)}>${selo}</div><h4 title="${String(title || '').replace(/"/g, '&quot;')}">${title}</h4>`;
    if (favInfo) {
        const ativo = ehFavorito(favInfo) ? ' ativo' : '';
        htmlContent += `<div class="fav-badge${ativo}" title="Favoritar"><i class="fa-heart ${ativo ? 'fas' : 'far'}"></i></div>`;
    }
    let acoesCard = '';
    if (shareInfo && shareInfo.link) acoesCard += `<div class="share-badge" title="Compartilhar"><i class="fas fa-share-nodes"></i></div>`;
    if(isPlaylist) htmlContent += `<span class="media-type-badge"><i class="fas fa-photo-film"></i> Playlist</span>`;
    if(showAddButton) htmlContent += `<button class="add-music-badge"><i class="fas fa-plus"></i> ${isPlaylist ? "Add Playlist" : "Adicionar"}</button>`;
    if(realIndex >= 0) {
        acoesCard += `<div class="quick-edit-badge" title="Editar mídia" aria-label="Editar mídia"><i class="fas fa-cog"></i></div>`;
        acoesCard += `<button type="button" class="media-delete-badge" title="Excluir mídia" aria-label="Excluir mídia"><i class="fas fa-trash"></i></button>`;
    }
    const isCollectionCard = favInfo && (favInfo.tipo === 'categoria' || favInfo.tipo === 'subcategoria');
    const isDynamicRecent = favInfo && favInfo.tipo === 'subcategoria' && favInfo.subcategoria === 'Vídeos Recentes';
    if (isCollectionCard && !isDynamicRecent) {
        acoesCard += `<div class="collection-card-actions">
            <button type="button" class="collection-action-btn collection-edit-btn" title="Editar" aria-label="Editar ${favInfo.tipo}"><i class="fas fa-cog"></i></button>
            <button type="button" class="collection-action-btn collection-delete-btn" title="Excluir" aria-label="Excluir ${favInfo.tipo}"><i class="fas fa-trash"></i></button>
        </div>`;
    }
    if (acoesCard) htmlContent += `<div class="card-actions-row">${acoesCard}</div>`;
    card.innerHTML = htmlContent;
    if(clickCallback) card.addEventListener('click', clickCallback);
    if(realIndex >= 0 && card.querySelector('.quick-edit-badge')) {
        card.querySelector('.quick-edit-badge').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openAdvancedEditModal(realIndex); });
    }
    const mediaDelete = card.querySelector('.media-delete-badge');
    if (mediaDelete && realIndex >= 0) {
        mediaDelete.addEventListener('click', async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (await uiConfirm(`Excluir a mídia "${title}"?`)) deletarMidiaUnica(realIndex);
        });
    }
    const collectionEdit = card.querySelector('.collection-edit-btn');
    if (collectionEdit && favInfo) {
        collectionEdit.addEventListener('click', async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (favInfo.tipo === 'categoria') {
                const novoNome = await uiPrompt('Novo nome para a Categoria:', favInfo.categoria);
                if (novoNome && novoNome.trim() && novoNome.trim() !== favInfo.categoria) renomearCategoriaCompleta(favInfo.categoria, novoNome.trim());
            } else {
                const novoNome = await uiPrompt('Novo nome para a Subcategoria:', favInfo.subcategoria);
                if (novoNome && novoNome.trim() && novoNome.trim() !== favInfo.subcategoria) renomearSubcategoriaCompleta(favInfo.categoria, favInfo.subcategoria, novoNome.trim());
            }
        });
    }
    const collectionDelete = card.querySelector('.collection-delete-btn');
    if (collectionDelete && favInfo) {
        collectionDelete.addEventListener('click', async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (favInfo.tipo === 'categoria') {
                if (await uiConfirm(`Excluir a categoria "${favInfo.categoria}" e todo o seu conteúdo?`)) deletarCategoriaCompleta(favInfo.categoria);
            } else if (await uiConfirm(`Excluir a subcategoria "${favInfo.subcategoria}" e todo o seu conteúdo?`)) {
                deletarSubcategoria(favInfo.categoria, favInfo.subcategoria);
            }
        });
    }
    const badgeFav = card.querySelector('.fav-badge');
    if (badgeFav && favInfo) {
        badgeFav.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            alternarFavorito(favInfo);
        });
    }
    const badgeShare = card.querySelector('.share-badge');
    if (badgeShare && shareInfo) {
        badgeShare.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            compartilharMidia(shareInfo);
        });
    }
    return card;
}

async function buscarVideosRecentesDoCanal(playlistId) {
    const grid = document.getElementById('mosaic-grid'); if (grid) grid.innerHTML = '<h3>Atualizando vídeos recentes do canal via API...</h3>';
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=15&playlistId=${playlistId}&key=${CONFIG.YT_API_KEY}`;
    try {
        const res = await fetch(url); const data = await res.json();
        if(data.items) {
            const itensInvertidos = data.items.reverse();
            currentPlaylist = itensInvertidos.map(item => ({
                título: item.snippet.title, link: `https://www.youtube.com/embed/${item.snippet.resourceId.videoId}`,
                capa: melhorThumbYoutube(item.snippet) || 'https://placehold.co/300x200?text=Sem+Capa',
                categoria: selectedCategory, subcategoria: "Vídeos Recentes", isDinâmico: true
            }));
            if (grid) { 
                grid.innerHTML = ''; 
                garantirDuracoes(currentPlaylist);
                currentPlaylist.forEach((track, index) => { grid.appendChild(createCard(track.título, track.capa, false, false, () => { playTrack(index); }, -1, track, { tipo: 'midia', track: track })); }); 
            }
        }
    } catch (e) { if (grid) grid.innerHTML = '<h3>Erro ao carregar feeds do canal.</h3>'; }
}

function configurarEventosBuscaCanal() {
    const input = document.getElementById("search-channel-input");
    const btnSearchChan = document.getElementById("btn-search-channel");
    const scrollContainer = document.getElementById("channels-scroll-container");

    const executarBusca = async (e) => {
        if(e) e.preventDefault();
        const termo = input?.value.trim();
        if(!termo) return uiAlert("Digite o nome do canal.");
        
        scrollContainer.innerHTML = '<h3>Buscando...</h3>';
        scrollContainer.style.display = 'block';

        try {
            const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=10&q=${encodeURIComponent(termo)}&key=${CONFIG.YT_API_KEY}`);
            const data = await res.json();
            
            scrollContainer.innerHTML = '';
            if(!data.items || data.items.length === 0) return scrollContainer.innerHTML = '<p>Nenhum canal encontrado.</p>';

            data.items.forEach(item => {
                const div = document.createElement('div');
                div.className = 'channel-search-item';
                div.innerHTML = `<img src="${melhorThumbYoutube(item.snippet)}"><div class="info"><h4>${item.snippet.title}</h4></div>`;
                div.onclick = () => {
                    canalSelecionadoProvisorio = { 
                        channelId: item.snippet.channelId, 
                        title: item.snippet.title, 
                        thumb: melhorThumbYoutube(item.snippet), 
                        description: item.snippet.description 
                    };
                    document.getElementById("chan-thumb").src = canalSelecionadoProvisorio.thumb;
                    document.getElementById("chan-title-text").innerText = canalSelecionadoProvisorio.title;
                    document.getElementById("chan-desc-text").innerText = canalSelecionadoProvisorio.description;
                    document.getElementById("channel-preview").style.display = "flex";
                };
                scrollContainer.appendChild(div);
            });
        } catch(err) { scrollContainer.innerHTML = '<p>Erro na API.</p>'; }
    };

    if (input) input.onkeypress = (e) => { if(e.key === 'Enter') executarBusca(e); };
    if (btnSearchChan) btnSearchChan.onclick = executarBusca;
}

function renderSidebar() {
    const tree = document.getElementById('sidebar-tree'); if (!tree) return; tree.innerHTML = '';
    const categories = [...new Set(database.map(item => item.categoria))];
    Object.keys(canaisDinamicos).forEach(key => { try { const catNome = decodeURIComponent(escape(atob(key))); if(!categories.includes(catNome)) categories.push(catNome); } catch(e){} });
    ordenarNomes(categories).forEach(cat => {
        if(!cat) return;
        const catLi = document.createElement('li'); const catToggle = document.createElement('span'); catToggle.className = 'category-toggle'; catToggle.innerHTML = `<i class="fas fa-folder"></i> ${cat}`;
        const subUl = document.createElement('ul'); subUl.className = 'tree-sub hidden'; catToggle.addEventListener('click', () => subUl.classList.toggle('hidden'));
        const subcategories = [...new Set(database.filter(item => item.categoria === cat).map(item => item.subcategoria))];
        const nodeName = btoa(unescape(encodeURIComponent(cat))).replace(/=/g, ""); if(canaisDinamicos[nodeName]) subcategories.push("Vídeos Recentes");

        ordenarNomes(subcategories).forEach(sub => {
            if(!sub) return; const subLi = document.createElement('li');
            subLi.innerHTML = sub === "Vídeos Recentes" ? `<i class="fas fa-sync text-red"></i> <b>${sub}</b>` : `<i class="fas fa-photo-film"></i> ${sub}`;
            subLi.addEventListener('click', (e) => { e.stopPropagation(); selectedCategory = cat; selectedSubcategory = sub; currentView = 'tracks'; renderMosaic(); if(window.innerWidth <= 768) handleToggleSidebar(); });
            subUl.appendChild(subLi);
        });
        catLi.appendChild(catToggle); catLi.appendChild(subUl); tree.appendChild(catLi);
    });
}

function filterInternalDatabase(query) {
    const lowerQuery = query.toLowerCase().trim();
    document.querySelectorAll('#sidebar-tree > li').forEach(catLi => {
        const catName = catLi.querySelector('.category-toggle').innerText.toLowerCase(); let match = catName.includes(lowerQuery); let subMatchAny = false;
        catLi.querySelectorAll('.tree-sub li').forEach(subLi => {
            const realCat = catLi.querySelector('.category-toggle').innerText.trim(); const realSub = subLi.innerText.trim();
            const mediaMatch = database.some(item => item.categoria === realCat && item.subcategoria === realSub && item.título.toLowerCase().includes(lowerQuery));
            if(subLi.innerText.toLowerCase().includes(lowerQuery) || mediaMatch || match) { subLi.classList.remove('hidden'); subMatchAny = true; } else { subLi.classList.add('hidden'); }
        });
        if(match || subMatchAny) catLi.classList.remove('hidden'); else catLi.classList.add('hidden');
    });
}

async function searchYouTubeGlobal(query) {
    if(!query.trim()) return; currentView = 'search_results'; renderMosaic();
    const grid = document.getElementById('mosaic-grid'); if (grid) grid.innerHTML = '<h3>Buscando no YouTube...</h3>';
    try {
        const response = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=30&q=${encodeURIComponent(query)}&type=video,playlist&key=${CONFIG.YT_API_KEY}`);
        const data = await response.json();
        if (data.error) { if (grid) grid.innerHTML = `<h3 style="color:#e74c3c;">Erro do YouTube: ${data.error.message}</h3>`; return; }
        lastYtSearchResults = [];
        if(data.items) {
            data.items.forEach(item => {
                const isPl = item.id.kind === 'youtube#playlist';
                lastYtSearchResults.push({ type: isPl ? 'playlist' : 'video', youtubeId: isPl ? item.id.playlistId : item.id.videoId, title: item.snippet.title, thumb: melhorThumbYoutube(item.snippet) || 'https://placehold.co/300x200?text=Sem+Capa' });
            });
        }
        renderMosaic();
    } catch (e) { if (grid) grid.innerHTML = '<h3>Erro de rede ao conectar à API.</h3>'; }
}

async function peekPlaylistContents(playlistId) {
    try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${CONFIG.YT_API_KEY}`); const data = await res.json();
        if(data.items) { uiAlert(`Mídias:\n\n` + data.items.map((item, idx) => `${idx + 1}. ${item.snippet.title}`).join('\n').substring(0, 1200)); }
    } catch(e) { uiAlert("Erro playlist."); }
}

function inicializarSeletorCoresLinear() {
    const barAdmin = document.getElementById('color-spectrum-bar'); 
    const selectorAdmin = document.getElementById('color-spectrum-selector');
    const barPerfil = document.getElementById('profile-color-spectrum-bar');
    const selectorPerfil = document.getElementById('profile-color-spectrum-selector');

    const coresGradiente = ["#000000", "#ff0000", "#ff00ff", "#0000ff", "#00ffff", "#00ff00", "#ffff00", "#ff0000", "#ffffff"];
    let isDragging = false;

    function hexToRgb(hex) { let num = parseInt(hex.replace("#",""), 16); return { r: num >> 16, g: (num >> 8) & 0x00FF, b: num & 0x0000FF }; }
    function rgbToHex(r, g, b) { return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); }

    function calcularCorPelaPosicao(e, barElement, selectorElement, ehPerfil) {
        if (!barElement || !selectorElement) return;
        const rect = barElement.getBoundingClientRect(); 
        let clientX = e.clientX || (e.touches && e.touches[0].clientX); 
        let x = clientX - rect.left;
        
        if (x < 0) x = 0; 
        if (x > rect.width) x = rect.width; 
        let percent = x / rect.width; 
        selectorElement.style.left = (percent * 100) + '%';
        
        let segment = percent * (coresGradiente.length - 1); 
        let index = Math.floor(segment); 
        let factor = segment - index;
        let core1 = coresGradiente[index]; 
        let cor2 = coresGradiente[index + 1] || coresGradiente[index];
        let rgb1 = hexToRgb(core1); 
        let rgb2 = hexToRgb(cor2);
        
        let r = Math.round(rgb1.r + factor * (rgb2.r - rgb1.r)); 
        let g = Math.round(rgb1.g + factor * (rgb2.g - rgb1.g)); 
        let b = Math.round(rgb1.b + factor * (rgb2.b - rgb1.b));
        let hexResult = rgbToHex(r, g, b); 
        
        if (ehPerfil) {
            corPerfilTemporaria = hexResult;
            const txtHexPerfil = document.getElementById('profile-theme-color-hex');
            if (txtHexPerfil) txtHexPerfil.innerText = hexResult.toUpperCase();
        } else {
            aplicarCorTema(hexResult); 
            salvarPreferenciaNoFirebase({ cor_tema: hexResult });
        }
    }

    if (barAdmin) {
        barAdmin.addEventListener('mousedown', (e) => { isDragging = true; calcularCorPelaPosicao(e, barAdmin, selectorAdmin, false); });
        document.addEventListener('mousemove', (e) => { if (isDragging) calcularCorPelaPosicao(e, barAdmin, selectorAdmin, false); });
        barAdmin.addEventListener('touchstart', (e) => { isDragging = true; calcularCorPelaPosicao(e, barAdmin, selectorAdmin, false); }, {passive: true});
        document.addEventListener('touchmove', (e) => { if (isDragging) calcularCorPelaPosicao(e, barAdmin, selectorAdmin, false); }, {passive: true});
    }

    if (barPerfil) {
        barPerfil.addEventListener('mousedown', (e) => { isDragging = true; calcularCorPelaPosicao(e, barPerfil, selectorPerfil, true); });
        document.addEventListener('mousemove', (e) => { if (isDragging) calcularCorPelaPosicao(e, barPerfil, selectorPerfil, true); });
        barPerfil.addEventListener('touchstart', (e) => { isDragging = true; calcularCorPelaPosicao(e, barPerfil, selectorPerfil, true); }, {passive: true});
        document.addEventListener('touchmove', (e) => { if (isDragging) calcularCorPelaPosicao(e, barPerfil, selectorPerfil, true); }, {passive: true});
    }

    document.addEventListener('mouseup', () => isDragging = false);
    document.addEventListener('touchend', () => isDragging = false);
}

function openAdminWithTrack(item) {
    if (document.getElementById('admin-modal')) document.getElementById('admin-modal').classList.remove('hidden'); switchTabs('add-tab', 'tab-trigger-add');
    document.getElementById('manual-media-url').value = item.type === 'playlist' ? `https://www.youtube.com/playlist?list=${item.youtubeId}` : `https://www.youtube.com/embed/${item.youtubeId}`;
    document.getElementById('prev-thumb').src = item.thumb; document.getElementById('prev-title').value = item.title;
}

function extractPlaylistId(url) { const reg = /[&?]list=([^#\&\?]+)/; const match = url.match(reg); return match ? match[1] : null; }

function playTrack(index) {
    if(currentPlaylist.length === 0) return; currentTrackIndex = index; const track = currentPlaylist[index];
    try { registrarViewLocal(track); const sv = document.querySelectorAll('.card .views-app'); if (sv.length) setTimeout(() => { try { renderMosaic(); } catch (e) {} }, 0); } catch (e) {}
    if (reproducaoAleatoria && !jaSorteadas.includes(index)) jaSorteadas.push(index);
    if (document.getElementById('player-container')) document.getElementById('player-container').classList.remove('hidden');
    if (document.getElementById('current-track-title')) document.getElementById('current-track-title').innerText = track.título;
    try { atualizarBotaoFavoritoDoPlayer(); } catch (e) {}

    const ytPlayerEl = document.getElementById('yt-player'); const univPlayerEl = document.getElementById('universal-player'); const rawPlayerEl = document.getElementById('raw-player');
    try { pararStreamAtual(); } catch (e) {}
    if (univPlayerEl) univPlayerEl.src = ""; if (rawPlayerEl) { rawPlayerEl.removeAttribute('src'); try { rawPlayerEl.load(); } catch (e) {} }
    if (univPlayerEl) univPlayerEl.classList.add('hidden'); if (rawPlayerEl) rawPlayerEl.classList.add('hidden'); if (ytPlayerEl) ytPlayerEl.classList.remove('hidden');
    if (rawPlayerEl) rawPlayerEl.pause(); const linkOriginal = track.link.trim(); const vId = extractYoutubeId(linkOriginal);
    esconderPalcoDeAudio();

    const tipoStream = vId ? null : detectarStream(linkOriginal);
    if (tipoStream) {
        if (ytPlayerEl) ytPlayerEl.classList.add('hidden');
        if (ytPlayer && ytPlayer.stopVideo) { try { ytPlayer.stopVideo(); } catch (e) {} }
        tocarStream(track, linkOriginal, tipoStream, rawPlayerEl);
        return;
    }
    if(vId) {
        if (ytPlayerEl) ytPlayerEl.classList.remove('hidden');
        if (!ytPlayer) { 
            ytPlayer = new YT.Player('yt-player', { 
                videoId: vId, 
                playerVars: { 'autoplay': 1, 'playsinline': 1, 'enablejsapi': 1 }, 
                events: { 
                    'onReady': () => { aplicarVolume(); }, 
                    'onStateChange': (e) => { if(e.data === 0) avancarFaixa(); } 
                } 
            }); 
        } 
        else { 
            ytPlayer.loadVideoById(vId); 
            setTimeout(() => aplicarVolume(), 300); 
        }
    } 
    else if (ehArquivoDeAudio(linkOriginal)) {
        tocarAudioNoPlayer(track, linkOriginal, rawPlayerEl);
    }
    else if(linkOriginal.toLowerCase().endsWith('.mp4') || linkOriginal.toLowerCase().endsWith('.mkv') || linkOriginal.toLowerCase().includes('raw.githubusercontent') || linkOriginal.includes('docs.google.com/uc?export=download')) {
        if (rawPlayerEl) { rawPlayerEl.classList.remove('hidden'); rawPlayerEl.src = linkOriginal; rawPlayerEl.play(); aplicarVolume(); rawPlayerEl.onended = () => { avancarFaixa(); }; }
    } 
    else if (linkPrecisaSondagem(linkOriginal)) {
        if (ytPlayerEl) ytPlayerEl.classList.add('hidden');
        sondarEReproduzir(track, linkOriginal, rawPlayerEl, univPlayerEl, index);
    }
    else { 
        if (univPlayerEl) { 
            univPlayerEl.classList.remove('hidden'); 
            let urlTratada = linkOriginal;
            
            if (urlTratada.includes("archive.org/details/")) {
                urlTratada = urlTratada.replace("archive.org/details/", "archive.org/embed/");
            } 
            else if (urlTratada.includes("youtube.com/embed/videoseries")) {
                const separador = urlTratada.includes("?") ? "&" : "?";
                urlTratada = `${urlTratada}${separador}playsinline=1&enablejsapi=1&origin=${window.location.origin}`;
            }
            else if (urlTratada.includes("drive.google.com/file/d/")) {
                if (urlTratada.includes("/preview")) {
                    urlTratada = urlTratada.replace("/preview", "/preview?rm=minimal");
                } else if (!urlTratada.includes("?")) {
                    urlTratada += "?rm=minimal";
                } else if (!urlTratada.includes("rm=minimal")) {
                    urlTratada += "&rm=minimal";
                }
                const separador = urlTratada.includes("?") ? "&" : "?";
                urlTratada = `${urlTratada}${separador}playsinline=1&enablejsapi=1&origin=${window.location.origin}`;
            }
            univPlayerEl.src = urlTratada; 
        } 
    }
} 

function extractYoutubeId(url) {
    if (!url || url.includes('videoseries')) return null; 
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|\/shorts\/)([^#\&\?]*).*/; const match = url.match(regExp);
    if (match && match[2].length === 11) return match[2]; if (url.trim().length === 11 && !url.includes('/') && !url.includes('.')) return url.trim(); return null;
}

function aplicarVolume() {
    const slider = document.getElementById('player-volume-slider');
    const btnMute = document.getElementById('btn-mute-toggle');
    if (!slider || !btnMute) return;

    let vol = parseInt(slider.value);
    let isMuted = btnMute.getAttribute('data-muted') === 'true';

    btnMute.innerHTML = isMuted || vol === 0 ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';

    const rawPlayer = document.getElementById('raw-player');
    if (rawPlayer) {
        rawPlayer.volume = vol / 100;
        rawPlayer.muted = isMuted;
    }

    if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
        if (isMuted) ytPlayer.mute();
        else { ytPlayer.unMute(); ytPlayer.setVolume(vol); }
    }
}

function renderCrudManager() {
    const listContainer = document.getElementById('crud-tree-list'); if (!listContainer) return; listContainer.innerHTML = '';
    const categories = [...new Set(database.map(item => item.categoria))];
    Object.keys(canaisDinamicos).forEach(k => { try { const c = decodeURIComponent(escape(atob(k))); if(!categories.includes(c)) categories.push(c); } catch(e){} });

    categories.sort().forEach(cat => {
        if(!cat) return;
        const catRow = createCrudRow(cat, 'categoria', async () => { let n = await uiPrompt("Novo nome para a Categoria:", cat); if(n && n.trim() !== "") renomearCategoriaCompleta(cat, n.trim()); }, async () => { if(await uiConfirm(`Excluir ${cat}?`)) deletarCategoriaCompleta(cat); }, () => downloadJSON(montarPacoteBackup(database.filter(item => item.categoria === cat), [cat]), `cat_${cat}`));
        const subContainer = document.createElement('div'); subContainer.style.display = expandedCrudCats[cat] ? 'block' : 'none';
        
        catRow.addEventListener('click', (e) => { 
            if(e.target.closest('.crud-actions')) return; 
            expandedCrudCats[cat] = !expandedCrudCats[cat]; 
            subContainer.style.display = expandedCrudCats[cat] ? 'block' : 'none'; 
        });
        listContainer.appendChild(catRow);

        const subcategories = [...new Set(database.filter(item => item.categoria === cat).map(item => item.subcategoria))];
        const nodeName = btoa(unescape(encodeURIComponent(cat))).replace(/=/g, ""); if(canaisDinamicos[nodeName]) subcategories.push("Vídeos Recentes");

        subcategories.sort().forEach(sub => {
            const subRow = createCrudRow(sub, 'subcategoria', sub === "Vídeos Recentes" ? null : async () => { let n = await uiPrompt("Novo nome para a Subcategoria:", sub); if(n && n.trim() !== "") renomearSubcategoriaCompleta(cat, sub, n.trim()); }, async () => { if(await uiConfirm(`Excluir a subcategoria ${sub}?`)) deletarSubcategoria(cat, sub); }, () => downloadJSON(montarPacoteBackup(database.filter(item => item.categoria === cat && item.subcategoria === sub), sub === "Vídeos Recentes" ? [cat] : []), `sub_${sub}`));
            const mediaContainer = document.createElement('div'); mediaContainer.style.display = expandedCrudSubs[cat + '_' + sub] ? 'block' : 'none';
            
            subRow.addEventListener('click', (e) => { 
                if(e.target.closest('.crud-actions')) return; 
                expandedCrudSubs[cat + '_' + sub] = !expandedCrudSubs[cat + '_' + sub]; 
                mediaContainer.style.display = expandedCrudSubs[cat + '_' + sub] ? 'block' : 'none'; 
            });
            subContainer.appendChild(subRow);

            if(sub === "Vídeos Recentes") {
                const iRow = document.createElement('div'); iRow.className = 'crud-item track-level'; iRow.innerHTML = `<span><i class="fas fa-link"></i> Canal: ${canaisDinamicos[nodeName].title}</span>`; mediaContainer.appendChild(iRow);
            } else {
                database.forEach((item, idx) => {
                    if(item.categoria === cat && item.subcategoria === sub) {
                        mediaContainer.appendChild(createCrudRow(item.título, 'mídia', () => openAdvancedEditModal(idx), async () => { if(await uiConfirm(`Excluir a mídia: ${item.título}?`)) deletarMidiaUnica(idx); }, () => downloadJSON(item, item.título)));
                    }
                });
            }
            subContainer.appendChild(mediaContainer);
        });
        listContainer.appendChild(subContainer);
    });
}

function createCrudRow(title, type, onEdit, onDel, onExp) {
    const row = document.createElement('div'); row.className = `crud-item ${type === 'subcategoria' ? 'sub-level' : type === 'mídia' ? 'track-level' : ''}`;
    let icon = type === 'categoria' ? '<i class="fas fa-folder"></i>' : (type === 'subcategoria' ? '<i class="fas fa-video"></i>' : '<i class="fas fa-play-circle"></i>');
    row.innerHTML = `<span>${icon} <strong>[${type.toUpperCase()}]</strong> ${title}</span><div class="crud-actions">${onEdit ? '<button class="crud-btn btn-edit"><i class="fas fa-edit"></i></button>' : ''}<button class="crud-btn btn-del"><i class="fas fa-trash"></i></button><button class="crud-btn btn-exp"><i class="fas fa-download"></i></button></div>`;
    if(onEdit) row.querySelector('.btn-edit').onclick = (e) => { e.stopPropagation(); onEdit(); };
    row.querySelector('.btn-del').onclick = (e) => { e.stopPropagation(); onDel(); }; row.querySelector('.btn-exp').onclick = (e) => { e.stopPropagation(); onExp(); }; return row;
}

async function renomearCategoriaCompleta(antiga, nova) { 
    try { 
        database.forEach(item => { if(item.categoria === antiga) item.categoria = nova; }); 
        await empurrarBancoIntegralParaServidor(); 
        const oldNodeName = btoa(unescape(encodeURIComponent(antiga))).replace(/=/g, ""); 
        if (canaisDinamicos[oldNodeName]) { 
            const newNodeName = btoa(unescape(encodeURIComponent(nova))).replace(/=/g, ""); 
            let urlNovoCanal = obterUrlBaseCanais().replace(".json", `/${newNodeName}.json`);
            let urlAntigoCanal = obterUrlBaseCanais().replace(".json", `/${oldNodeName}.json`);
            await dbFetch(urlNovoCanal, { method: "PUT", body: JSON.stringify(canaisDinamicos[oldNodeName]), headers: { 'Content-Type': 'application/json' } }); 
            await dbFetch(urlAntigoCanal, { method: "DELETE" }); 
        } 
        await recarregarDadosDoBanco(); 
        renderCrudManager(); 
    } catch(e){ console.error("Erro ao renomear categoria:", e); uiAlert("Erro ao renomear categoria: " + e.message); } 
}

function openAdvancedEditModal(index) {
    activeEditingIndex = index; const item = database[index];
    document.getElementById('edit-field-title').value = item.título || ""; document.getElementById('edit-field-link').value = item.link || "";
    document.getElementById('edit-field-capa').value = item.capa || ""; document.getElementById('edit-field-category').value = item.categoria || "";
    document.getElementById('edit-field-subcategory').value = item.subcategoria || "";
    if (document.getElementById('edit-media-modal')) document.getElementById('edit-media-modal').classList.remove('hidden');
}

async function saveAdvancedEditChanges(e) {
    if(e) e.preventDefault();
    if (activeEditingIndex === null || !database[activeEditingIndex]) {
        return uiAlert("Não foi possível identificar a mídia em edição. Reabra a edição e tente novamente.");
    }
    const t = document.getElementById('edit-field-title').value.trim(); const l = document.getElementById('edit-field-link').value.trim();
    const c = document.getElementById('edit-field-capa').value.trim(); const cat = document.getElementById('edit-field-category').value.trim();
    const sub = document.getElementById('edit-field-subcategory').value.trim();
    if(!t || !l || !cat) return uiAlert("Preencha os campos!");

    const btnSalvar = document.getElementById('btn-submit-edit-media');
    const textoOriginal = btnSalvar ? btnSalvar.innerHTML : "";
    const itemOriginal = { ...database[activeEditingIndex] };

    database[activeEditingIndex].título = t; database[activeEditingIndex].link = l; database[activeEditingIndex].capa = c;
    database[activeEditingIndex].categoria = cat; database[activeEditingIndex].subcategoria = sub;

    try {
        if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.innerHTML = "Salvando..."; }
        await empurrarBancoIntegralParaServidor();
        document.getElementById('edit-media-modal').classList.add('hidden');
        activeEditingIndex = null;
        await recarregarDadosDoBanco();
        renderCrudManager();
        uiAlert("Alteração salva com sucesso!");
    } catch (err) {
        // Desfaz a alteração local se a gravação remota falhar
        database[activeEditingIndex] = itemOriginal;
        uiAlert("Erro ao salvar: " + err.message);
    } finally {
        if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.innerHTML = textoOriginal; }
    }
}

async function saveMediaToDatabase(e) {
    if(e) e.preventDefault(); const url = document.getElementById('manual-media-url').value.trim(); 
    const categoria = document.getElementById('media-category').value.trim(); const subcategoria = document.getElementById('media-subcategory').value.trim();
    if(!url || !categoria) return uiAlert("Preencha os campos."); const pId = extractPlaylistId(url); const btnSave = document.getElementById('btn-save-media');

    try {
        if(pId) {
            btnSave.innerText = "Processando..."; btnSave.disabled = true;
            let urlApi = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${pId}&key=${CONFIG.YT_API_KEY}`;
            let res = await fetch(urlApi); let data = await res.json();
            if(data.error) throw new Error(data.error.message); if(!data.items || data.items.length === 0) throw new Error("Playlist vazia.");
            
            for(let item of data.items) {
                let vId = item.snippet.resourceId.videoId; let título = item.snippet.title;
                let capa = melhorThumbYoutube(item.snippet); let linkVideo = `https://www.youtube.com/embed/${vId}`;
                database.push({ título, link: linkVideo, capa, categoria, subcategoria });
            }
            await empurrarBancoIntegralParaServidor();
            uiAlert(`Sucesso! Foram importados ${data.items.length} vídeos.`);
        } else {
            const título = document.getElementById('prev-title').value.trim() || "Nova Mídia"; 
            const capa = document.getElementById('prev-thumb').src;
            database.push({ título, link: url, capa, categoria, subcategoria });
            await empurrarBancoIntegralParaServidor();
            uiAlert("Vídeo salvo!");
        }
        document.getElementById('manual-media-url').value = ""; 
        document.getElementById('admin-modal')?.classList.add('hidden');
        await recarregarDadosDoBanco();
    } catch (err) { uiAlert("Erro: " + err.message); } finally { btnSave.innerText = "Salvar no meu Firebase"; btnSave.disabled = false; }
}

async function processarInjecaoDeDadosAcumulativa(novosItens, novosCanais = []) {
    novosItens = Array.isArray(novosItens) ? novosItens.filter(n => n && n.link) : [];
    novosCanais = Array.isArray(novosCanais) ? novosCanais.filter(c => c && c.channelId && c.categoria) : [];
    if (novosItens.length === 0 && novosCanais.length === 0) return uiAlert("Nenhum dado válido para importar.");
    try {
        if (novosItens.length > 0) {
            const res = await dbFetch(CONFIG.FIREBASE_URL); const data = await res.json(); let bancoAtual = [];
            if (data) {
                if (Array.isArray(data)) bancoAtual = data.filter(item => item !== null);
                else Object.keys(data).forEach(k => { if(data[k]) bancoAtual.push(data[k]); });
            }
            novosItens.forEach(novo => {
                const limpo = { título: novo.título || novo.titulo || "", link: novo.link, capa: novo.capa || "", categoria: novo.categoria, subcategoria: novo.subcategoria || "" };
                const jaExiste = bancoAtual.some(velho => velho.link === limpo.link && velho.categoria === limpo.categoria);
                if(!jaExiste) bancoAtual.push(limpo);
            });
            database = bancoAtual;
            await empurrarBancoIntegralParaServidor();
        }
        let canaisGravados = 0;
        for (const c of novosCanais) {
            const payload = {
                channelId: c.channelId,
                uploadsPlaylistId: c.uploadsPlaylistId || String(c.channelId).replace(/^UC/, "UU"),
                title: c.title || "",
                thumb: c.thumb || ""
            };
            const url = obterUrlBaseCanais().replace(".json", `/${codificarNodoCanal(c.categoria)}.json`);
            const r = await dbFetch(url, { method: "PUT", body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
            if (r.ok) canaisGravados++;
        }
        if (novosCanais.length > 0) await carregarCanaisDinamicos();
        await recarregarDadosDoBanco();
        renderCrudManager();
        uiAlert(`Importação concluída! Total de mídias: ${database.length}` + (novosCanais.length ? ` | Canais vinculados importados: ${canaisGravados}/${novosCanais.length}` : ""));
    } catch(e) { uiAlert("Falha na mesclagem de dados. " + (e && e.message ? e.message : "")); }
}

/* ---------- BACKUP: mídias + canais vinculados ---------- */
function codificarNodoCanal(cat) { return btoa(unescape(encodeURIComponent(cat))).replace(/=/g, ""); }
function decodificarNodoCanal(key) { try { return decodeURIComponent(escape(atob(key))); } catch (e) { return null; } }

// cats = null -> todos os canais; [] -> nenhum; ['A'] -> só os dessas categorias
function canaisVinculadosParaBackup(cats) {
    const lista = [];
    Object.keys(canaisDinamicos || {}).forEach(k => {
        const v = canaisDinamicos[k]; const cat = decodificarNodoCanal(k);
        if (!v || !cat) return;
        if (Array.isArray(cats) && !cats.includes(cat)) return;
        lista.push({ categoria: cat, channelId: v.channelId || "", uploadsPlaylistId: v.uploadsPlaylistId || "", title: v.title || "", thumb: v.thumb || "" });
    });
    return lista;
}

function montarPacoteBackup(itens, cats) {
    return {
        formato: "streamhub-backup",
        versao: 2,
        exportadoEm: new Date().toISOString(),
        midias: (itens || []).map(({ idFirebase, ...r }) => r),
        canais_vinculados: canaisVinculadosParaBackup(cats)
    };
}

// Aceita o formato novo ({midias, canais_vinculados}), o antigo (array/objeto de mídias) e mídia única
function lerPacoteImportado(p) {
    if (Array.isArray(p)) return { itens: p, canais: [] };
    if (!p || typeof p !== "object") return { itens: [], canais: [] };
    if (p.midias || p.canais_vinculados || p.canais) {
        const itens = Array.isArray(p.midias) ? p.midias : Object.values(p.midias || {});
        const bruto = p.canais_vinculados || p.canais || [];
        const canais = Array.isArray(bruto) ? bruto : Object.keys(bruto).map(k => ({ categoria: (bruto[k] && bruto[k].categoria) || decodificarNodoCanal(k) || k, ...bruto[k] }));
        return { itens, canais };
    }
    if (p.link) return { itens: [p], canais: [] };
    return { itens: Object.values(p), canais: [] };
}

async function empurrarBancoIntegralParaServidor() {
    if (!CONFIG.FIREBASE_URL) throw new Error("Banco de dados não configurado. Faça login novamente antes de salvar.");
    if (!firebase.auth().currentUser) throw new Error("Sessão expirada. Entre novamente para salvar suas alterações.");
    const loteLimpoParaSalvar = database.map(({idFirebase, ...resto}) => resto);
    let resposta = await dbFetch(CONFIG.FIREBASE_URL, { method: "PUT", body: JSON.stringify(loteLimpoParaSalvar), headers: { 'Content-Type': 'application/json' } });
    if (!resposta.ok) {
        let detalhe = "";
        try { detalhe = (await resposta.text()) || ""; } catch (e) {}
        throw new Error(`Erro na gravação remota do banco (HTTP ${resposta.status}). ${detalhe}`.trim());
    }
}

async function deletarMidiaUnica(indexNoBanco) {
    const backup = database.slice();
    try { database.splice(indexNoBanco, 1); await empurrarBancoIntegralParaServidor(); await recarregarDadosDoBanco(); renderCrudManager(); }
    catch(e){ database = backup; uiAlert("Erro ao excluir mídia: " + e.message); }
}
async function deletarSubcategoria(cat, sub) {
    const backup = database.slice();
    try { database = database.filter(item => !(item.categoria === cat && item.subcategoria === sub)); await empurrarBancoIntegralParaServidor(); await recarregarDadosDoBanco(); renderCrudManager(); }
    catch(e){ database = backup; uiAlert("Erro ao excluir subcategoria: " + e.message); }
}
async function deletarCategoriaCompleta(cat) { 
    try { 
        database = database.filter(item => item.categoria !== cat); 
        await empurrarBancoIntegralParaServidor(); 
        const nodeName = btoa(unescape(encodeURIComponent(cat))).replace(/=/g, "");
        let urlCanalIndividual = obterUrlBaseCanais().replace(".json", `/${nodeName}.json`);
        await dbFetch(urlCanalIndividual, { method: 'DELETE' }); 
        currentView = 'categories'; 
        selectedCategory = ''; 
        selectedSubcategory = ''; 
        await recarregarDadosDoBanco(); 
        renderCrudManager(); 
    } catch(e){ console.error("Erro ao deletar categoria completa:", e); uiAlert("Erro ao excluir categoria: " + e.message); } 
}

async function renomearSubcategoriaCompleta(cat, antigaSub, novaSub) {
    try {
        database.forEach(item => { if(item.categoria === cat && item.subcategoria === antigaSub) item.subcategoria = novaSub; });
        await empurrarBancoIntegralParaServidor();
        await recarregarDadosDoBanco();
        renderCrudManager();
    } catch(e){ uiAlert("Erro ao renomear subcategoria: " + e.message); }
}
// Alias mantido para compatibilidade com chamadas antigas
const renameSubcategoryComplete = renomearSubcategoriaCompleta;

function downloadJSON(obj, filename) {
    const prepararObjeto = Array.isArray(obj) ? obj.map(({idFirebase, ...r}) => r) : obj;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(prepararObjeto, null, 2));
    const a = document.createElement('a'); a.setAttribute("href", dataStr); a.setAttribute("download", `${filename.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_backup.json`);
    document.body.appendChild(a); a.click(); a.remove();
}

function syncSidebarLayout() {
    const sidebar = document.getElementById('sidebar');
    const contentBody = document.querySelector('.content-body');
    if (!sidebar || !contentBody) return;

    const isMobile = window.innerWidth <= 768;
    const expanded = isMobile ? sidebar.classList.contains('open') : !sidebar.classList.contains('collapsed');
    contentBody.classList.toggle('sidebar-collapsed', !isMobile && !expanded);
    document.getElementById('toggle-sidebar')?.setAttribute('aria-expanded', String(!isMobile && expanded));
    document.getElementById('btn-sidebar-mobile-header')?.setAttribute('aria-expanded', String(isMobile && expanded));
}

function handleToggleSidebar() {
    const sidebar = document.getElementById('sidebar'); if (!sidebar) return;
    if (window.innerWidth <= 768) {
        sidebar.classList.toggle('open');
        sidebar.classList.remove('collapsed');
    } else {
        sidebar.classList.toggle('collapsed');
        sidebar.classList.remove('open');
    }
    syncSidebarLayout();
}

window.addEventListener('resize', syncSidebarLayout);
document.addEventListener('DOMContentLoaded', syncSidebarLayout);

function switchTabs(targetTabId, activeTriggerBtnId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); 
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    const triggerBtn = document.getElementById(activeTriggerBtnId); 
    const targetTab = document.getElementById(targetTabId);
    if (triggerBtn) triggerBtn.classList.add('active'); 
    if (targetTab) targetTab.classList.remove('hidden');
}

async function renderizarListaUsuariosPedidosExclusao() {
    const container = document.getElementById('admin-users-request-list');
    if (!container) return;
    
    container.innerHTML = "<p style='color:var(--text-gray); font-size:0.9rem;'><i class='fas fa-spinner fa-spin'></i> Carregando dados do nó /usuarios...</p>";
    
    try {
        let urlRaizLimpa = firebaseConfig.databaseURL.replace(/\/$/, "");
        let res = await dbFetch(`${urlRaizLimpa}/usuarios.json`);
        
        if (!res.ok) {
            container.innerHTML = `<p style='color:#e74c3c; padding:10px; font-weight:bold;'>❌ Erro de HTTP no Firebase: ${res.status}</p>`;
            return;
        }
        
        let data = await res.json();
        if (!data) {
            container.innerHTML = "<p style='color:var(--text-gray); padding:10px; font-size:0.9rem;'>Nenhum registro encontrado no nó /usuarios. O banco está vazio. ✨</p>";
            return;
        }

        let usuariosObjeto = {};
        if (Array.isArray(data)) {
            data.forEach((item, index) => { if (item) usuariosObjeto[index] = item; });
        } else {
            usuariosObjeto = data;
        }
        
        container.innerHTML = ""; 
        let encontrouNenhum = true;
        
        Object.keys(usuariosObjeto).forEach(uid => {
            try {
                const userPerfil = usuariosObjeto[uid];
                if (!userPerfil || typeof userPerfil !== 'object') return;
                
                const pediuExclusao = userPerfil.solicitou_exclusao === true || 
                                     userPerfil.solicitou_exclusao === "true" ||
                                     userPerfil.solicitouExclusao === true || 
                                     userPerfil.solicitouExclusao === "true";
                
                if (pediuExclusao) {
                    encontrouNenhum = false;
                    
                    const row = document.createElement('div');
                    row.className = "crud-item";
                    row.style.background = "rgba(231, 76, 60, 0.1)";
                    row.style.borderLeft = "4px solid #e74c3c";
                    row.style.padding = "10px";
                    row.style.marginBottom = "5px";
                    row.style.display = "flex";
                    row.style.justifyContent = "space-between";
                    row.style.alignItems = "center";
                    row.style.width = "100%";
                    
                    row.innerHTML = `
                        <div style="display:flex; flex-direction:column; gap:2px; text-align:left;">
                            <span style="color:#fff; font-weight:bold;">${userPerfil.nome || 'Usuário Sem Nome'} ${userPerfil.sobrenome || ''}</span>
                            <span style="font-size:0.72rem; color:var(--text-gray); font-family:monospace; user-select:all;"><i class="fas fa-fingerprint"></i> UID: ${uid}</span>
                        </div>
                        <button class="crud-btn btn-del" onclick="processarExclusaoDefinitivaPeloMaster('${uid}')" style="padding:6px 12px; font-size:0.8rem; flex-shrink:0; margin-left:10px;"><i class="fas fa-user-minus"></i> Limpar</button>
                    `;
                    container.appendChild(row);
                }
            } catch (innerError) {
                console.error("Erro ao processar linha de usuário individual:", innerError);
            }
        });
        
        if (encontrouNenhum) {
            container.innerHTML = "<p style='color:var(--text-gray); padding:10px; font-size:0.9rem;'>Nenhuma solicitação pendente no momento! Seu Firebase está limpo. ✨</p>";
        }
        
    } catch(err) {
        console.error("Erro crítico na renderização:", err);
        container.innerHTML = `<p style='color:#e74c3c; padding:10px; font-weight:bold;'>❌ Falha Crítica no Script: ${err.message}</p>`;
    }
}

async function processarExclusaoDefinitivaPeloMaster(uidUsuarioAlvo) {
    if (!await uiConfirm("Atenção Admin: Deseja apagar permanentemente todas as mídias e preferências deste usuário do banco? (Lembre-se de deletar a credencial dele no painel Firebase Auth)")) return;
    
    try {
        const urlBaseBanco = firebaseConfig.databaseURL.replace(/\/$/, "");
        await dbFetch(`${urlBaseBanco}/usuarios/${uidUsuarioAlvo}.json`, { method: "DELETE" });
        uiAlert("Dados do Realtime Database removidos com sucesso!");
        renderizarListaUsuariosPedidosExclusao();
    } catch(e) {
        uiAlert("Erro técnico ao limpar nó do usuário.");
    }
}

function setupEventListeners() {
    console.log("Configurando Delegação de Eventos...");

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#toggle-sidebar')) handleToggleSidebar();
        if (e.target.closest('#bc-root') || e.target.closest('#bc-home')) { currentView = 'categories'; selectedCategory=''; selectedSubcategory=''; renderMosaic(); }
        if (e.target.closest('#bc-category')) { currentView = 'subcategories'; selectedSubcategory=''; renderMosaic(); }
        if (e.target.closest('#btn-logout')) handleLogoutActions();
        if (e.target.closest('#btn-toggle-search-mobile')) {
            const row = document.getElementById('mobile-search-row');
            if(row) { row.classList.toggle('hidden'); if(!row.classList.contains('hidden')) document.getElementById('search-yt-input-mobile').focus(); }
        }
        
        if (e.target.closest('#btn-google-login')) {
            const btnGoogle = e.target.closest('#btn-google-login');
            btnGoogle.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando...';
            btnGoogle.disabled = true;
            mostrarCarregandoLogin("Conectando com o Google...");

            firebase.auth().signInWithPopup(googleProvider)
                .then((resultado) => { guardarTokenGoogle(resultado); })
                .catch((error) => {
                    esconderCarregandoLogin();
                    uiAlert("Erro ao logar com o Google: " + error.message);
                    btnGoogle.innerHTML = '<i class="fab fa-google"></i> Entrar com o Google';
                    btnGoogle.disabled = false;
                });
        }

        if (e.target.closest('#btn-trigger-dropdown-mobile')) {
            e.stopPropagation();
            document.getElementById('dropdown-menu-mobile')?.classList.toggle('hidden');
        } else if (!e.target.closest('#dropdown-menu-mobile')) {
            document.getElementById('dropdown-menu-mobile')?.classList.add('hidden');
        }
        // Mantem o cabecalho acima de tudo enquanto o menu da engrenagem esta aberto
        (function syncDropdownStacking() {
            const menu = document.getElementById('dropdown-menu-mobile');
            const header = document.querySelector('.app-header');
            if (!menu || !header) return;
            header.classList.toggle('dropdown-open', !menu.classList.contains('hidden'));
        })();

        if (e.target.closest('#btn-toggle-sidebar-mobile') || e.target.closest('#btn-sidebar-mobile-header')) {
            handleToggleSidebar();
        }

        if (e.target.closest('#btn-open-admin-mobile')) {
            document.getElementById('admin-modal')?.classList.remove('hidden'); 
            switchTabs('add-tab', 'tab-trigger-add'); 
            renderCrudManager();
        }

        if (e.target.closest('#btn-logout-mobile')) {
            handleLogoutActions();
        }
        
        if (e.target.closest('#btn-open-admin')) { 
            document.getElementById('admin-modal')?.classList.remove('hidden'); 
            switchTabs('add-tab', 'tab-trigger-add'); renderCrudManager(); 
        }
        if (e.target.closest('#btn-close-admin')) document.getElementById('admin-modal')?.classList.add('hidden');
        
        if (e.target.closest('#tab-trigger-add')) switchTabs('add-tab', 'tab-trigger-add');
        if (e.target.closest('#tab-trigger-channel')) switchTabs('channel-tab', 'tab-trigger-channel');
        if (e.target.closest('#tab-trigger-manage')) { switchTabs('manage-tab', 'tab-trigger-manage'); renderCrudManager(); }
        if (e.target.closest('#tab-trigger-custom')) switchTabs('custom-tab', 'tab-trigger-custom');
        if (e.target.closest('#tab-trigger-users')) { switchTabs('users-tab', 'tab-trigger-users'); renderizarListaUsuariosPedidosExclusao(); }

        if (e.target.closest('#btn-save-media')) saveMediaToDatabase(e);
        if (e.target.closest('#btn-submit-edit-media')) saveAdvancedEditChanges(e);
        if (e.target.closest('#btn-cancel-edit-media') || e.target.closest('#btn-cancel-edit-media-2')) {
            document.getElementById('edit-media-modal')?.classList.add('hidden');
        }
        
        if (e.target.closest('#btn-save-channel-link')) {
            const modoSelecionado = document.querySelector('input[name="cat-mode-channel"]:checked')?.value || 'existente';
            let catDestino = "";

            if (modoSelecionado === 'nova') {
                catDestino = document.getElementById("channel-target-category-new")?.value.trim();
            } else {
                catDestino = document.getElementById("channel-target-category")?.value;
            }

            if(!canalSelecionadoProvisorio || !catDestino) {
                return uiAlert("Por favor, selecione um canal e defina/selecione uma categoria válida.");
            }

            try {
                const payload = { 
                    channelId: canalSelecionadoProvisorio.channelId, 
                    uploadsPlaylistId: canalSelecionadoProvisorio.channelId.replace(/^UC/, "UU"), 
                    title: canalSelecionadoProvisorio.title, 
                    thumb: canalSelecionadoProvisorio.thumb 
                };
                
                const nodeName = btoa(unescape(encodeURIComponent(catDestino))).replace(/=/g, "");
                let urlCanalIndividual = obterUrlBaseCanais().replace(".json", `/${nodeName}.json`);
                
                const respCanal = await dbFetch(urlCanalIndividual, { method: "PUT", body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
                if (!respCanal.ok) throw new Error(`Falha ao gravar o canal (HTTP ${respCanal.status}).`);
                
                uiAlert(`Canal vinculado com sucesso na categoria "${catDestino}"!`);
                
                document.getElementById("channel-preview").style.display = "none"; 
                document.getElementById('search-channel-input').value = "";
                if(document.getElementById('channel-target-category-new')) document.getElementById('channel-target-category-new').value = "";
                
                const radExistente = document.querySelector('input[name="cat-mode-channel"][value="existente"]');
                if(radExistente) { radExistente.checked = true; alternarModoCategoriaCanal('existente'); }

                canalSelecionadoProvisorio = null; 
                initApp();
            } catch(err) { 
                uiAlert("Erro ao salvar canal: " + err.message); 
            }
        }

        if (e.target.closest('#btn-request-delete-account')) {
            e.preventDefault();
            if (!await uiConfirm("Tem certeza absoluta de que deseja solicitar a exclusão da sua conta? Seu acervo e preferências serão agendados para eliminação pelo administrador.")) return;
            
            try {
                await salvarPreferenciaNoFirebase({ solicitou_exclusao: true });
                uiAlert("Sua solicitação de exclusão foi enviada com sucesso! Você pode fechar o site ou deslogar.");
                fecharModalPerfil();
            } catch(err) {
                uiAlert("Falha ao registrar pedido.");
            }
        }
        
        if (e.target.closest('#btn-fetch-manual')) {
            const url = document.getElementById('manual-media-url').value.trim(); if(!url) return uiAlert("Insira uma URL.");
            const btn = e.target.closest('#btn-fetch-manual'); btn.innerText = "Buscando..."; const vId = extractYoutubeId(url);
            try {
                if (vId) {
                    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${vId}&key=${CONFIG.YT_API_KEY}`); const data = await res.json();
                    if (data.items && data.items.length > 0) { const snip = data.items[0].snippet; document.getElementById('prev-title').value = snip.title; document.getElementById('prev-thumb').src = melhorThumbYoutube(snip); } 
                }
            } catch(err) {} finally { btn.innerText = "Capturar Dados"; }
        }

        if (e.target.closest('#btn-export-all-json')) { if (database.length > 0 || Object.keys(canaisDinamicos || {}).length > 0) downloadJSON(montarPacoteBackup(database, null), "backup_completo_streamhub"); else uiAlert("Banco vazio!"); }
        if (e.target.closest('#btn-submit-json-code')) {
            const val = document.getElementById('json-input-field')?.value.trim(); if(!val) return uiAlert("Cole o código JSON");
            try { let p = lerPacoteImportado(JSON.parse(val)); await processarInjecaoDeDadosAcumulativa(p.itens, p.canais); document.getElementById('json-input-field').value = ""; } catch(err) { uiAlert("JSON inválido."); }
        }
        
        if (e.target.closest('#btn-reset-theme')) {
            if(currentUserUid) {
                let padrao = { cor_tema: "#ff0000" };
                aplicarCorTema("#ff0000"); posicionarSetaPelaCor("#ff0000");
                salvarPreferenciaNoFirebase(padrao);
            }
        }

        if (e.target.closest('#profile-btn-reset-theme')) {
            corPerfilTemporaria = "#ff0000";
            aplicarCorTema("#ff0000");
            const selectorPerfil = document.getElementById('profile-color-spectrum-selector');
            if(selectorPerfil) selectorPerfil.style.left = "12%";
        }

        if (e.target.closest('#btn-next-track')) { avancarFaixa(); }
        if (e.target.closest('#btn-prev-track')) { voltarFaixa(); }
        if (e.target.closest('#btn-shuffle')) { alternarReproducaoAleatoria(); }
        if (e.target.closest('#btn-close-player')) {
            if(ytPlayer?.stopVideo) ytPlayer.stopVideo(); document.getElementById('universal-player').src = ""; document.getElementById('raw-player').pause();
            esconderPalcoDeAudio();
            document.getElementById('player-container')?.classList.add('hidden');
        }
        if (e.target.closest('#btn-mute-toggle')) {
            const btnMute = e.target.closest('#btn-mute-toggle');
            let isMuted = btnMute.getAttribute('data-muted') === 'true';
            btnMute.setAttribute('data-muted', !isMuted); 
            aplicarVolume();
        }

        const themeBtn = e.target.closest('[id^="theme-switch-"]');
        if (themeBtn) {
            const tema = themeBtn.id.replace('theme-switch-', '');
            const className = tema === 'youtube' ? "" : `theme-${tema}`;
            document.body.className = className;
            salvarPreferenciaNoFirebase({ tema: className });
        }

        const adminThemeBtn = e.target.closest('.admin-theme-btn');
        if (adminThemeBtn) {
            const temaAdmin = adminThemeBtn.getAttribute('data-theme');
            const classNameAdmin = temaAdmin === 'youtube' ? "" : `theme-${temaAdmin}`;
            document.body.className = classNameAdmin;
            adminThemeBtn.parentElement.querySelectorAll('.admin-theme-btn').forEach(btn => btn.classList.remove('active'));
            adminThemeBtn.classList.add('active');
            salvarPreferenciaNoFirebase({ tema: classNameAdmin });
        }

        const profileThemeBtn = e.target.closest('.profile-theme-btn');
        if (profileThemeBtn) {
            const temaSelecionado = profileThemeBtn.getAttribute('data-theme');
            const className = temaSelecionado === 'youtube' ? "" : `theme-${temaSelecionado}`;
            document.body.className = className;
            profileThemeBtn.parentElement.querySelectorAll('.profile-theme-btn').forEach(btn => btn.classList.remove('active'));
            profileThemeBtn.classList.add('active');
        }

        // DISPARO DA REQUISIÇÃO DE RECUPERAÇÃO DE SENHA
        if (e.target.closest('#btn-recover-submit')) {
            e.preventDefault();
            handlePasswordRecovery();
        }
    });

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-save-profile-changes')) {
            e.preventDefault();
            
            const novoNome = document.getElementById('profile-edit-name').value.trim();
            const novoSobrenome = document.getElementById('profile-edit-lastname').value.trim();
            const novoWhatsapp = lerValorCampo('profile-edit-whatsapp');
            const novaCidade = lerValorCampo('profile-edit-cidade');
            const novaUf = lerValorCampo('profile-edit-uf');
            const btnTemaAtivo = document.querySelector('.profile-theme-btn.active');
            let temaFinal = document.body.className; 
            
            if (btnTemaAtivo) {
                const dataTheme = btnTemaAtivo.getAttribute('data-theme');
                temaFinal = dataTheme === 'youtube' ? "" : `theme-${dataTheme}`;
            }
            
            if (!novoNome || !novoSobrenome) {
                return uiAlert("Os campos Nome e Sobrenome não podem ficar vazios!");
            }
            if (novoWhatsapp && !whatsappEhValido(novoWhatsapp)) {
                return uiAlert("Informe um WhatsApp válido com DDD, no formato (99) 99999-9999.");
            }
            
            const btnSaveProf = document.getElementById('btn-save-profile-changes');
            btnSaveProf.innerText = "Salvando..."; btnSaveProf.disabled = true;
            
            try {
                const dadosAtualizados = {
                    nome: novoNome,
                    sobrenome: novoSobrenome,
                    whatsapp: apenasDigitos(novoWhatsapp),
                    cidade: novaCidade,
                    uf: novaUf,
                    cor_tema: corPerfilTemporaria || "#ff0000",
                    tema: temaFinal
                };
                
                await salvarPreferenciaNoFirebase(dadosAtualizados);
                aplicarCorTema(dadosAtualizados.cor_tema);
                document.body.className = dadosAtualizados.tema;
                
                const elTxt = document.getElementById('user-top-name');
                if (elTxt) elTxt.innerText = `Olá, ${novoNome}!`;
                
                uiAlert("Perfil e preferências salvos com sucesso!");
                fecharModalPerfil();
                
            } catch (err) {
                uiAlert("Erro ao salvar alterações do perfil: " + err.message);
            } finally {
                btnSaveProf.innerText = "Salvar Alterações"; btnSaveProf.disabled = false;
            }
        }
    });
    
    const tratarBuscaGlobal = (e) => {
        if (e.key === 'Enter' || e.type === 'change') {
            const termo = e.target.value.trim();
            if (termo) {
                searchYouTubeGlobal(termo);
                e.target.blur(); 
                document.getElementById('mobile-search-row')?.classList.add('hidden');
            }
        }
    };

    document.getElementById('search-yt-input')?.addEventListener('keypress', tratarBuscaGlobal);
    document.getElementById('search-yt-input')?.addEventListener('change', tratarBuscaGlobal);

    document.getElementById('search-yt-input-mobile')?.addEventListener('keypress', tratarBuscaGlobal);
    document.getElementById('search-yt-input-mobile')?.addEventListener('change', tratarBuscaGlobal);
    
    document.getElementById('search-internal-input')?.addEventListener('input', (e) => {
        const termo = e.target.value.trim();
        filterInternalDatabase(termo);
        if (termo === "") { currentView = 'categories'; selectedCategory = ''; selectedSubcategory = ''; renderMosaic(); }
    });

    const executarBuscaLocal = (e) => {
        {
            const termo = (e.target.value || '').toLowerCase().trim();
            if (!termo) return;

            lastLocalSearchResults = database.filter(item => {
                const titulo = item.título || item.titulo || ""; 
                const categoria = item.categoria || item.Categoria || "";
                const subcategoria = item.subcategoria || "";
                return titulo.toLowerCase().includes(termo) || categoria.toLowerCase().includes(termo) || subcategoria.toLowerCase().includes(termo);
            });

            // Cataloga também categorias e subcategorias que combinam com o termo
            const todasCategorias = [...new Set(database.map(i => i.categoria).filter(Boolean))];
            Object.keys(canaisDinamicos).forEach(key => {
                try { const c = decodeURIComponent(escape(atob(key))); if (c && !todasCategorias.includes(c)) todasCategorias.push(c); } catch (err) {}
            });
            lastLocalCatResults = todasCategorias.filter(c => c.toLowerCase().includes(termo)).sort();

            const paresVistos = new Set();
            lastLocalSubResults = [];
            database.forEach(i => {
                const cat = i.categoria || "", sub = i.subcategoria || "";
                if (!sub) return;
                const chave = cat + "||" + sub;
                if (paresVistos.has(chave)) return;
                if (sub.toLowerCase().includes(termo) || (cat.toLowerCase().includes(termo) && !lastLocalCatResults.includes(cat))) {
                    paresVistos.add(chave);
                    lastLocalSubResults.push({ categoria: cat, subcategoria: sub });
                }
            });
            lastLocalSubResults.sort((a, b) => a.subcategoria.localeCompare(b.subcategoria));

            currentView = 'search_local_results'; renderMosaic();
            // No mobile o menu lateral se recolhe para o mosaico com os resultados aparecer
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar')?.classList.remove('open');
                try { e.target.blur(); } catch (err) {}
                document.getElementById('mosaic-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    };

    const inputBuscaLocal = document.getElementById('search-internal-input');
    if (inputBuscaLocal) {
        // keypress nao dispara em varios teclados de celular: keydown/search/change cobrem todos
        inputBuscaLocal.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); executarBuscaLocal(e); } });
        inputBuscaLocal.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); executarBuscaLocal(e); } });
        inputBuscaLocal.addEventListener('search', executarBuscaLocal);
        inputBuscaLocal.addEventListener('change', executarBuscaLocal);
    }

    document.getElementById('file-import-json')?.addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return; const reader = new FileReader();
        reader.onload = async (evt) => {
            try { let p = lerPacoteImportado(JSON.parse(evt.target.result)); await processarInjecaoDeDadosAcumulativa(p.itens, p.canais); e.target.value = ""; } catch(err) { uiAlert("Erro de arquivo."); }
        }; reader.readAsText(file);
    });

    document.addEventListener('input', (e) => {
        if (e.target.id === 'player-volume-slider') {
            const btnMute = document.getElementById('btn-mute-toggle');
            if (btnMute) btnMute.setAttribute('data-muted', 'false'); 
            aplicarVolume();
        }
    });

// Efeito de pulsação suave no botão do WhatsApp
const waButton = document.querySelector('.whatsapp-float');
if (waButton) {
    waButton.style.animation = "pulse 2s infinite";
    
    // Injetando o keyframe da animação via JS para não precisar mexer no CSS
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.7); }
            70% { box-shadow: 0 0 0 15px rgba(37, 211, 102, 0); }
            100% { box-shadow: 0 0 0 0 rgba(37, 211, 102, 0); }
        }
    `;
    document.head.appendChild(style);
}
    
    // PROCESSAMENTO DO CADASTRO COMPLETO DE USUÁRIOS COM FILTRO DE PROVEDOR REAL
    document.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-register-submit')) {
            e.preventDefault();
            
            const nome = document.getElementById('register-name').value.trim();
            const sobrenome = document.getElementById('register-lastname').value.trim();
            const email = document.getElementById('register-email').value.trim().toLowerCase();
            const senha = document.getElementById('register-pass').value.trim();
            const senhaConfirm = document.getElementById('register-pass-confirm').value.trim();
            const whatsapp = lerValorCampo('register-whatsapp');
            const cidade = lerValorCampo('register-cidade');
            const uf = lerValorCampo('register-uf');
            
            if(!nome || !sobrenome || !email || !senha) {
                return uiAlert("Por favor, preencha todos os campos do cadastro!");
            }
            if(!whatsapp || !cidade || !uf) {
                return uiAlert("Informe também o seu WhatsApp, a cidade e a UF.");
            }
            if(!whatsappEhValido(whatsapp)) {
                return uiAlert("Informe um WhatsApp válido com DDD, no formato (99) 99999-9999.");
            }
            
            // TRAVA DE PROVEDOR REAL: Aplica a validação do front-end
            if (!verificarProvedorValido(email)) {
                return uiAlert("Cadastro Bloqueado!\nPor razões de segurança e viabilidade de recuperação de senha, use um e-mail válido pertencente aos grandes provedores (Gmail, Hotmail, Outlook, Yahoo, iCloud, UOL, BOL ou IG).");
            }

            if(senha.length < 6) {
                return uiAlert("A senha precisa ter no mínimo 6 caracteres!");
            }
            if(senha !== senhaConfirm) {
                return uiAlert("As senhas digitadas não batem! Verifique a confirmação.");
            }
            
            const btnReg = document.getElementById('btn-register-submit');
            btnReg.innerText = "Criando conta..."; btnReg.disabled = true;
            
            try {
                const cred = await firebase.auth().createUserWithEmailAndPassword(email, senha);
                const novoUid = cred.user.uid;
                const urlBaseBanco = firebaseConfig.databaseURL.replace(/\/$/, "");
                
                const novoPerfil = {
                    nome: nome,
                    sobrenome: sobrenome,
                    email: email,
                    whatsapp: apenasDigitos(whatsapp),
                    cidade: cidade,
                    uf: uf,
                    cor_tema: "#ff0000",
                    tema: "",
                    firebaseUrl: `${urlBaseBanco}/usuarios/${novoUid}/midias.json`
                };
                
                await dbFetch(`${urlBaseBanco}/usuarios/${novoUid}.json`, {
                    method: "PATCH",
                    body: JSON.stringify(novoPerfil),
                    headers: { 'Content-Type': 'application/json' }
                });
                
                uiAlert(`Conta criada com absoluto sucesso, ${nome}! Seja bem-vindo.`);
                
                document.getElementById('form-cadastro-fluxo').reset();
                alternarAbasLogin('login');
                
            } catch(error) {
                uiAlert("Erro ao realizar cadastro: " + error.message);
            } finally {
                btnReg.innerText = "Criar Minha Conta"; btnReg.disabled = false;
            }
        }
    });

    configurarEventosBuscaCanal();
    inicializarSeletorCoresLinear();
}

// INICIALIZAÇÃO DO ECOSSISTEMA
document.addEventListener('DOMContentLoaded', () => {
    inicializarCamposContato();
    configurarEventosLogin();
    setupEventListeners();
    checkSession();
});

/* ==========================================================================
   MÓDULO DE NOVOS RECURSOS (ADITIVO)
   - Foto de perfil via upload (base64) ou link
   - Comentários retráteis dos vídeos no player (YouTube Data API)
   - Player arrastável e redimensionável
   - Painel gerencial completo para admin@admin.com
   Nenhuma função original foi alterada.
   ========================================================================== */

const EMAIL_ADMIN_MASTER = "admin@admin.com";

/* ==========================================
   UFs DO BRASIL, MÁSCARA DE WHATSAPP E CAMPOS DE CONTATO
   ========================================== */
const UFS_BRASIL = [
    { sigla: "AC", nome: "Acre" }, { sigla: "AL", nome: "Alagoas" },
    { sigla: "AP", nome: "Amapá" }, { sigla: "AM", nome: "Amazonas" },
    { sigla: "BA", nome: "Bahia" }, { sigla: "CE", nome: "Ceará" },
    { sigla: "DF", nome: "Distrito Federal" }, { sigla: "ES", nome: "Espírito Santo" },
    { sigla: "GO", nome: "Goiás" }, { sigla: "MA", nome: "Maranhão" },
    { sigla: "MT", nome: "Mato Grosso" }, { sigla: "MS", nome: "Mato Grosso do Sul" },
    { sigla: "MG", nome: "Minas Gerais" }, { sigla: "PA", nome: "Pará" },
    { sigla: "PB", nome: "Paraíba" }, { sigla: "PR", nome: "Paraná" },
    { sigla: "PE", nome: "Pernambuco" }, { sigla: "PI", nome: "Piauí" },
    { sigla: "RJ", nome: "Rio de Janeiro" }, { sigla: "RN", nome: "Rio Grande do Norte" },
    { sigla: "RS", nome: "Rio Grande do Sul" }, { sigla: "RO", nome: "Rondônia" },
    { sigla: "RR", nome: "Roraima" }, { sigla: "SC", nome: "Santa Catarina" },
    { sigla: "SP", nome: "São Paulo" }, { sigla: "SE", nome: "Sergipe" },
    { sigla: "TO", nome: "Tocantins" }
];

// Preenche todos os <select data-uf-select> do site com as 27 UFs
function preencherSelectsDeUF() {
    document.querySelectorAll("select[data-uf-select]").forEach(sel => {
        if (sel.dataset.ufPreenchido === "1") return;
        const valorAtual = sel.value;
        sel.innerHTML = '<option value="">UF</option>' +
            UFS_BRASIL.map(uf => `<option value="${uf.sigla}">${uf.sigla} - ${uf.nome}</option>`).join("");
        sel.dataset.ufPreenchido = "1";
        if (valorAtual) sel.value = valorAtual;
    });
}

// Aplica a máscara (99) 99999-9999 aceitando apenas números
function formatarWhatsApp(valor) {
    const d = (valor || "").replace(/\D/g, "").slice(0, 11);
    if (d.length === 0) return "";
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function apenasDigitos(valor) {
    return (valor || "").replace(/\D/g, "");
}

function whatsappEhValido(valor) {
    const d = apenasDigitos(valor);
    return d.length === 10 || d.length === 11;
}

// Liga a máscara numérica em todos os campos marcados com data-mask="whatsapp"
function ativarMascarasWhatsApp() {
    document.querySelectorAll('[data-mask="whatsapp"]').forEach(campo => {
        if (campo.dataset.maskAtiva === "1") return;
        campo.dataset.maskAtiva = "1";
        const aplicar = () => { campo.value = formatarWhatsApp(campo.value); };
        campo.addEventListener("input", aplicar);
        campo.addEventListener("blur", aplicar);
        campo.addEventListener("keypress", (ev) => {
            if (ev.key.length === 1 && /\D/.test(ev.key)) ev.preventDefault();
        });
    });
}

function inicializarCamposContato() {
    preencherSelectsDeUF();
    ativarMascarasWhatsApp();
}

function definirValorCampo(id, valor) {
    const el = document.getElementById(id);
    if (el) el.value = valor || "";
}

function lerValorCampo(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
}

let fotoPerfilTemporaria = null;      // null = não alterada nesta sessão do modal
let videoIdEmExibicao = null;
let configGlobalSite = {};
let uidUsuarioEmEdicaoMaster = null;

function urlRaizBanco() {
    return firebaseConfig.databaseURL.replace(/\/$/, "");
}

function ehAdminMaster() {
    const u = firebase.auth().currentUser;
    return !!u && (u.email || "").toLowerCase() === EMAIL_ADMIN_MASTER;
}

function avatarPadrao() {
    return "https://placehold.co/120x120/222222/ffffff?text=%F0%9F%91%A4";
}

/* ---------------------- FOTO DE PERFIL ---------------------- */

// Converte o arquivo enviado em base64 já redimensionado (evita estourar o banco)
function converterArquivoParaBase64(file, maxLado = 320) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith("image/")) return reject(new Error("O arquivo escolhido não é uma imagem."));
        if (file.size > 8 * 1024 * 1024) return reject(new Error("Imagem muito grande (máximo 8MB)."));
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                const escala = Math.min(1, maxLado / Math.max(width, height));
                width = Math.round(width * escala);
                height = Math.round(height * escala);
                const canvas = document.createElement("canvas");
                canvas.width = width; canvas.height = height;
                canvas.getContext("2d").drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL("image/jpeg", 0.82));
            };
            img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
            img.src = reader.result;
        };
        reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
        reader.readAsDataURL(file);
    });
}

function aplicarFotoNoTopo(foto) {
    const badge = document.getElementById("user-profile-display");
    if (!badge) return;
    let img = badge.querySelector("img.avatar-top");
    const icone = badge.querySelector("i.fa-user-circle");
    if (foto) {
        if (!img) {
            img = document.createElement("img");
            img.className = "avatar-top";
            badge.insertBefore(img, badge.firstChild);
        }
        img.src = foto;
        if (icone) icone.style.display = "none";
    } else {
        if (img) img.remove();
        if (icone) icone.style.display = "";
    }
}

function preencherFotoNoModalPerfil(foto) {
    fotoPerfilTemporaria = null;
    const prev = document.getElementById("profile-photo-preview");
    const inputUrl = document.getElementById("profile-photo-url");
    if (prev) prev.src = foto || avatarPadrao();
    if (inputUrl) inputUrl.value = foto && !foto.startsWith("data:") ? foto : "";
}

async function carregarPerfilAtual() {
    if (!currentUserUid) return null;
    try {
        const res = await dbFetch(`${urlRaizBanco()}/usuarios/${currentUserUid}.json`);
        return await res.json();
    } catch (e) { return null; }
}

/* ---------------------- COMENTÁRIOS DO PLAYER ---------------------- */

function formatarDataComentario(iso) {
    try { return new Date(iso).toLocaleDateString("pt-BR"); } catch (e) { return ""; }
}

async function carregarComentariosDoVideo(videoId) {
    const lista = document.getElementById("comments-list");
    if (!lista) return;
    if (!videoId) {
        lista.innerHTML = `<p class="comments-empty">Comentários disponíveis apenas para vídeos do YouTube.</p>`;
        return;
    }
    lista.innerHTML = `<p class="comments-empty"><i class="fas fa-spinner fa-spin"></i> Carregando comentários...</p>`;
    try {
        const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&maxResults=30&order=relevance&textFormat=plainText&videoId=${videoId}&key=${CONFIG.YT_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) {
            lista.innerHTML = `<p class="comments-empty">Não foi possível carregar (o vídeo pode estar com comentários desativados).</p>`;
            return;
        }
        if (!data.items || data.items.length === 0) {
            lista.innerHTML = `<p class="comments-empty">Nenhum comentário encontrado para este vídeo.</p>`;
            return;
        }
        lista.innerHTML = "";
        data.items.forEach(item => {
            const c = item.snippet.topLevelComment.snippet;
            const div = document.createElement("div");
            div.className = "comment-item";
            const texto = (c.textDisplay || "").replace(/[<>]/g, "");
            div.innerHTML = `
                <img src="${c.authorProfileImageUrl}" alt="">
                <div class="comment-body">
                    <div class="comment-author">${c.authorDisplayName}
                        <span class="comment-meta">${formatarDataComentario(c.publishedAt)} · <i class="fas fa-thumbs-up"></i> ${c.likeCount || 0}</span>
                    </div>
                    <div class="comment-text"></div>
                </div>`;
            div.querySelector(".comment-text").innerText = texto;
            lista.appendChild(div);
        });
    } catch (e) {
        lista.innerHTML = `<p class="comments-empty">Erro de rede ao buscar comentários.</p>`;
    }
}

function comentariosEstaoVisiveis() {
    const painel = document.getElementById("player-comments");
    return painel && !painel.classList.contains("hidden");
}

let alturaPlayerAntesDosComentarios = null;

// Altura padrão generosa do painel (ajustável pelo usuário arrastando a alça)
function alturaPadraoComentarios() {
    const salvo = parseInt(localStorage.getItem("alturaComentarios") || "0", 10);
    if (salvo && salvo > 150) return Math.min(salvo, Math.round(window.innerHeight * 0.85));
    return Math.round(window.innerHeight * (window.innerWidth <= 768 ? 0.6 : 0.55));
}

function aplicarAlturaComentarios(px) {
    const painel = document.getElementById("player-comments");
    if (!painel) return;
    const min = 180;
    const max = Math.round(window.innerHeight * 0.85);
    const altura = Math.min(Math.max(Math.round(px), min), max);
    painel.style.setProperty("--comments-height", altura + "px");
    painel.style.height = altura + "px";
    try { localStorage.setItem("alturaComentarios", String(altura)); } catch (e) {}
    return altura;
}

// Layout dos comentários: ao lado (desktop) ou abaixo (mobile)
function ehLayoutDesktopComentarios() {
    return window.innerWidth > 768;
}

let larguraPlayerAntesDosComentarios = null;

function limparEstilosDePosicaoDoPlayer(player) {
    if (!player) return;
    ["left", "top", "width", "height", "bottom", "right"].forEach(p => player.style.removeProperty(p));
}

// Ao abrir os comentários, o player ganha o espaço extra (não encolhe o vídeo)
function ajustarAlturaDoPlayerComComentarios(abrir, alturaComentarios) {
    const player = document.getElementById("player-container");
    if (!player || !player.classList.contains("player-free")) return;
    if (abrir) {
        const atual = player.getBoundingClientRect().height;
        if (alturaPlayerAntesDosComentarios === null) alturaPlayerAntesDosComentarios = atual;
        const desejada = Math.min(alturaPlayerAntesDosComentarios + alturaComentarios + 40, Math.round(window.innerHeight * 0.94));
        player.style.setProperty("height", desejada + "px", "important");
        const topo = Math.max(0, Math.min(player.getBoundingClientRect().top, window.innerHeight - desejada));
        player.style.setProperty("top", topo + "px", "important");
    } else if (alturaPlayerAntesDosComentarios !== null) {
        player.style.setProperty("height", alturaPlayerAntesDosComentarios + "px", "important");
        alturaPlayerAntesDosComentarios = null;
    }
}

// No desktop os comentários ficam colados à direita: o player só ganha largura
function ajustarLarguraDoPlayerComComentarios(abrir) {
    const player = document.getElementById("player-container");
    if (!player || !player.classList.contains("player-free")) return;
    if (abrir) {
        const rect = player.getBoundingClientRect();
        if (larguraPlayerAntesDosComentarios === null) larguraPlayerAntesDosComentarios = rect.width;
        const extra = Math.min(400, Math.round(window.innerWidth * 0.3));
        const desejada = Math.min(larguraPlayerAntesDosComentarios + extra, Math.round(window.innerWidth * 0.96));
        player.style.setProperty("width", desejada + "px", "important");
        const esquerda = Math.max(0, Math.min(rect.left, window.innerWidth - desejada));
        player.style.setProperty("left", esquerda + "px", "important");
    } else if (larguraPlayerAntesDosComentarios !== null) {
        player.style.setProperty("width", larguraPlayerAntesDosComentarios + "px", "important");
        larguraPlayerAntesDosComentarios = null;
    }
}

function alternarPainelComentarios(forcarAbrir) {
    const painel = document.getElementById("player-comments");
    const player = document.getElementById("player-container");
    if (!painel) return;
    const abrir = typeof forcarAbrir === "boolean" ? forcarAbrir : painel.classList.contains("hidden");
    const desktop = ehLayoutDesktopComentarios();
    painel.classList.toggle("hidden", !abrir);
    if (player) {
        player.classList.toggle("with-comments", abrir);
        player.classList.toggle("comments-side", abrir && desktop);
    }
    const btn = document.getElementById("btn-toggle-comments");
    if (btn) btn.style.color = abrir ? "var(--theme-color)" : "";
    if (abrir) {
        if (desktop) {
            // Painel colado à direita: altura acompanha o player
            painel.style.removeProperty("height");
            painel.style.removeProperty("--comments-height");
            ajustarLarguraDoPlayerComComentarios(true);
        } else {
            const altura = aplicarAlturaComentarios(alturaPadraoComentarios());
            ajustarAlturaDoPlayerComComentarios(true, altura);
        }
        carregarComentariosDoVideo(videoIdEmExibicao);
        montarCaixaDeComentario();
    } else {
        // Ao fechar, o player volta ao tamanho e à posição originais
        alturaPlayerAntesDosComentarios = null;
        larguraPlayerAntesDosComentarios = null;
        painel.style.removeProperty("height");
        painel.style.removeProperty("--comments-height");
        if (player) {
            player.classList.remove("player-free", "comments-side");
            limparEstilosDePosicaoDoPlayer(player);
        }
    }
}


// Alça de redimensionamento do painel de comentários (mouse e toque)
function configurarRedimensionamentoComentarios() {
    const alca = document.getElementById("comments-resizer");
    const painel = document.getElementById("player-comments");
    if (!alca || !painel) return;
    let arrastando = false, startY = 0, baseH = 0;
    const ponto = (ev) => (ev.touches && ev.touches[0] ? ev.touches[0] : ev);

    const iniciar = (ev) => {
        if (ehLayoutDesktopComentarios()) return; // no desktop o painel fica colado à direita
        arrastando = true;
        startY = ponto(ev).clientY;
        baseH = painel.getBoundingClientRect().height;
        ev.preventDefault();
    };
    const mover = (ev) => {
        if (!arrastando) return;
        const delta = startY - ponto(ev).clientY;
        const nova = aplicarAlturaComentarios(baseH + delta);
        ajustarAlturaDoPlayerComComentarios(true, nova);
        ev.preventDefault();
    };
    const finalizar = () => { arrastando = false; };

    alca.addEventListener("mousedown", iniciar);
    alca.addEventListener("touchstart", iniciar, { passive: false });
    document.addEventListener("mousemove", mover);
    document.addEventListener("touchmove", mover, { passive: false });
    document.addEventListener("mouseup", finalizar);
    document.addEventListener("touchend", finalizar);
}

/* ------- COMENTAR NOS VÍDEOS COM A CONTA GOOGLE ------- */

async function pedirLoginGoogleParaComentar() {
    try {
        const usuario = firebase.auth().currentUser;
        let resultado;
        if (usuario && !usuarioEhDoGoogle()) {
            // Conta de e-mail/senha: vincula a conta Google para liberar o comentário
            try { resultado = await usuario.linkWithPopup(googleProvider); }
            catch (err) { resultado = await usuario.reauthenticateWithPopup(googleProvider); }
        } else if (usuario) {
            resultado = await usuario.reauthenticateWithPopup(googleProvider);
        } else {
            resultado = await firebase.auth().signInWithPopup(googleProvider);
        }
        guardarTokenGoogle(resultado);
        const foto = resultado?.user?.photoURL;
        if (foto) {
            const perfil = await carregarPerfilAtual();
            if (!perfil || !perfil.foto) { await salvarPreferenciaNoFirebase({ foto }); aplicarFotoNoTopo(foto); }
        }
        montarCaixaDeComentario();
        return true;
    } catch (e) {
        uiAlert("Não foi possível autorizar sua conta Google para comentar: " + (e.message || e));
        return false;
    }
}

function montarCaixaDeComentario() {
    const box = document.getElementById("comment-compose");
    if (!box) return;
    if (!videoIdEmExibicao) {
        box.innerHTML = `<p class="comment-compose-hint">Comentários disponíveis apenas para vídeos do YouTube.</p>`;
        return;
    }
    const podeComentar = usuarioEhDoGoogle() && !!googleAccessToken;
    if (!podeComentar) {
        box.innerHTML = `
            <div class="compose-fields">
                <p class="comment-compose-hint">Entre com o Google para comentar neste vídeo com a sua conta.</p>
                <button type="button" id="btn-google-para-comentar" class="btn-google-comment">
                    <i class="fab fa-google"></i> Entrar com o Google para comentar
                </button>
            </div>`;
        return;
    }
    const usuario = firebase.auth().currentUser;
    const foto = (usuario && usuario.photoURL) || avatarPadrao();
    box.innerHTML = `
        <img class="compose-avatar" src="${foto}" alt="">
        <div class="compose-fields">
            <textarea id="novo-comentario-texto" placeholder="Escreva um comentário público..."></textarea>
            <div class="compose-actions">
                <button type="button" id="btn-enviar-comentario" class="btn-send-comment"><i class="fas fa-paper-plane"></i> Comentar</button>
            </div>
        </div>`;
}

async function enviarComentarioNoVideo() {
    const campo = document.getElementById("novo-comentario-texto");
    const botao = document.getElementById("btn-enviar-comentario");
    if (!campo || !videoIdEmExibicao) return;
    const texto = campo.value.trim();
    if (!texto) { campo.focus(); return; }
    if (!googleAccessToken) { await pedirLoginGoogleParaComentar(); return; }
    if (botao) { botao.disabled = true; botao.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; }
    try {
        const res = await fetch("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet", {
            method: "POST",
            headers: { "Authorization": "Bearer " + googleAccessToken, "Content-Type": "application/json" },
            body: JSON.stringify({
                snippet: { videoId: videoIdEmExibicao, topLevelComment: { snippet: { textOriginal: texto } } }
            })
        });
        const dados = await res.json();
        if (dados.error) {
            if (res.status === 401 || res.status === 403) {
                googleAccessToken = null;
                try { sessionStorage.removeItem("gToken"); } catch (e) {}
                uiAlert("Sua autorização do Google expirou. Entre novamente com o Google para comentar.");
                montarCaixaDeComentario();
            } else {
                uiAlert("Não foi possível publicar o comentário: " + (dados.error.message || "erro desconhecido"));
            }
            return;
        }
        campo.value = "";
        await carregarComentariosDoVideo(videoIdEmExibicao);
    } catch (e) {
        uiAlert("Erro de rede ao publicar o comentário.");
    } finally {
        if (botao) { botao.disabled = false; botao.innerHTML = '<i class="fas fa-paper-plane"></i> Comentar'; }
    }
}

// Intercepta o playTrack original para saber qual vídeo está tocando
(function interceptarPlayTrack() {
    if (typeof playTrack !== "function") return;
    const original = playTrack;
    playTrack = function (index) {
        original(index);
        try {
            const track = currentPlaylist[index];
            videoIdEmExibicao = track ? extractYoutubeId((track.link || "").trim()) : null;
        } catch (e) { videoIdEmExibicao = null; }
        if (comentariosEstaoVisiveis()) { carregarComentariosDoVideo(videoIdEmExibicao); montarCaixaDeComentario(); }
    };
})();

/* ---------------------- PLAYER ARRASTÁVEL E REDIMENSIONÁVEL ---------------------- */

function ativarModoPlayerLivre() {
    const player = document.getElementById("player-container");
    if (!player || player.classList.contains("player-free")) return;
    const rect = player.getBoundingClientRect();
    player.classList.add("player-free");
    player.style.setProperty("left", rect.left + "px", "important");
    player.style.setProperty("top", rect.top + "px", "important");
    player.style.setProperty("width", rect.width + "px", "important");
    player.style.setProperty("height", rect.height + "px", "important");
    player.style.setProperty("bottom", "auto", "important");
    player.style.setProperty("right", "auto", "important");
}

function limitarDentroDaTela(player) {
    const rect = player.getBoundingClientRect();
    let left = rect.left, top = rect.top;
    left = Math.min(Math.max(left, -rect.width + 120), window.innerWidth - 120);
    top = Math.min(Math.max(top, 0), window.innerHeight - 60);
    player.style.setProperty("left", left + "px", "important");
    player.style.setProperty("top", top + "px", "important");
}

function configurarPlayerLivre() {
    const player = document.getElementById("player-container");
    const header = player?.querySelector(".player-header");
    const resizer = document.getElementById("player-resizer");
    if (!player || !header || !resizer) return;

    let modo = null, startX = 0, startY = 0, baseLeft = 0, baseTop = 0, baseW = 0, baseH = 0;

    const ponto = (e) => e.touches && e.touches[0] ? e.touches[0] : e;

    const iniciar = (e, novoModo) => {
        if (configGlobalSite.playerLivre === false) return;
        if (e.target.closest("button") || e.target.closest("input")) return;
        ativarModoPlayerLivre();
        const p = ponto(e);
        const rect = player.getBoundingClientRect();
        modo = novoModo;
        startX = p.clientX; startY = p.clientY;
        baseLeft = rect.left; baseTop = rect.top; baseW = rect.width; baseH = rect.height;
        document.body.style.userSelect = "none";
    };

    const mover = (e) => {
        if (!modo) return;
        const p = ponto(e);
        const dx = p.clientX - startX;
        const dy = p.clientY - startY;
        if (modo === "drag") {
            player.style.setProperty("left", (baseLeft + dx) + "px", "important");
            player.style.setProperty("top", (baseTop + dy) + "px", "important");
        } else {
            player.style.setProperty("width", Math.max(280, baseW + dx) + "px", "important");
            player.style.setProperty("height", Math.max(200, baseH + dy) + "px", "important");
        }
        if (e.cancelable) e.preventDefault();
    };

    const finalizar = () => {
        if (!modo) return;
        modo = null;
        document.body.style.userSelect = "";
        limitarDentroDaTela(player);
    };

    header.addEventListener("mousedown", (e) => iniciar(e, "drag"));
    header.addEventListener("touchstart", (e) => iniciar(e, "drag"), { passive: false });
    resizer.addEventListener("mousedown", (e) => { e.stopPropagation(); iniciar(e, "resize"); });
    resizer.addEventListener("touchstart", (e) => { e.stopPropagation(); iniciar(e, "resize"); }, { passive: false });

    document.addEventListener("mousemove", mover);
    document.addEventListener("touchmove", mover, { passive: false });
    document.addEventListener("mouseup", finalizar);
    document.addEventListener("touchend", finalizar);

    // Duplo clique no cabeçalho volta o player para a posição/tamanho padrão
    header.addEventListener("dblclick", () => {
        player.classList.remove("player-free");
        ["left", "top", "width", "height", "bottom", "right"].forEach(p => player.style.removeProperty(p));
    });
}

/* ---------------------- CONFIGURAÇÃO GLOBAL DO SITE ---------------------- */

async function carregarConfigGlobal() {
    try {
        const res = await dbFetch(`${urlRaizBanco()}/config_global.json`);
        configGlobalSite = (await res.json()) || {};
    } catch (e) { configGlobalSite = {}; }
    aplicarConfigGlobal();
}

function aplicarConfigGlobal() {
    const c = configGlobalSite || {};
    const mostrar = (el, cond) => { if (el) el.classList.toggle("hidden", cond === false); };

    mostrar(document.querySelector(".theme-switcher-float"), c.temas);
    const wa = document.querySelector(".whatsapp-float");
    if (wa) wa.style.display = c.whatsapp === false ? "none" : "";
    mostrar(document.getElementById("btn-toggle-comments"), c.comentarios);
    if (c.comentarios === false) alternarPainelComentarios(false);

    const linkCadastro = document.querySelector("#form-login-fluxo .toggle-login-p");
    if (linkCadastro) linkCadastro.style.display = c.cadastro === false ? "none" : "";
    const btnGoogle = document.getElementById("btn-google-login");
    if (btnGoogle) btnGoogle.style.display = c.google === false ? "none" : "";

    const podeAdmin = c.adminUsuarios !== false || ehAdminMaster();
    document.getElementById("btn-open-admin")?.classList.toggle("hidden", !podeAdmin);
    document.getElementById("btn-open-admin-mobile")?.classList.toggle("hidden", !podeAdmin);

    aplicarIdentidadeVisual(c);
}

// Logos, título e favicon configurados no painel gerencial (link externo ou base64)
const LOGO_QUADRADA_PADRAO = "logo.png";
const TITULO_PADRAO_SITE = document.title || "StreamHub";
function aplicarIdentidadeVisual(c) {
    c = c || {};
    const nome = c.siteNome || "StreamHub";
    const titulo = document.getElementById("bc-root");
    if (titulo) {
        if (c.logoExtenso) {
            titulo.innerHTML = "";
            const img = document.createElement("img");
            img.src = c.logoExtenso;
            img.alt = nome;
            img.className = "brand-logo-extenso";
            img.style.cssText = "max-height:23px;max-width:220px;height:auto;display:block;cursor:pointer;";
            img.onerror = () => { titulo.innerText = nome; };
            titulo.appendChild(img);
            titulo.setAttribute("aria-label", nome);
        } else {
            titulo.innerText = nome;
        }
    }
    const quadrada = c.logoQuadrada || LOGO_QUADRADA_PADRAO;
    document.querySelectorAll("img[data-logo-quadrada]").forEach(img => {
        img.onerror = () => { img.onerror = null; img.src = LOGO_QUADRADA_PADRAO; };
        img.src = quadrada;
    });
    document.title = c.siteTitulo || TITULO_PADRAO_SITE;
    if (c.favicon) {
        let link = document.querySelector("link[rel~='icon']");
        if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
        link.removeAttribute("type");
        link.href = c.favicon;
    }
}

function atualizarPreviewImagemMaster(id) {
    const input = document.getElementById(id);
    const prev = document.querySelector(`.master-img-preview[data-target="${id}"]`);
    if (!input || !prev) return;
    const v = input.value.trim();
    prev.style.display = v ? "" : "none";
    if (v) prev.src = v; else prev.removeAttribute("src");
}

document.addEventListener("change", async (e) => {
    const f = e.target.closest && e.target.closest(".master-img-file");
    if (!f || !f.files || !f.files[0]) return;
    const arquivo = f.files[0];
    if (arquivo.size > 1024 * 1024 && !await uiConfirm("A imagem tem mais de 1 MB e deixará o site mais lento. Continuar?")) { f.value = ""; return; }
    const leitor = new FileReader();
    leitor.onload = () => {
        const alvo = document.getElementById(f.getAttribute("data-target"));
        if (alvo) { alvo.value = leitor.result; atualizarPreviewImagemMaster(alvo.id); }
    };
    leitor.readAsDataURL(arquivo);
});
document.addEventListener("input", (e) => {
    if (e.target.classList && e.target.classList.contains("master-img-url")) atualizarPreviewImagemMaster(e.target.id);
});
document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".master-img-clear");
    if (!b) return;
    const id = b.getAttribute("data-target");
    const alvo = document.getElementById(id);
    if (alvo) alvo.value = "";
    const f = document.querySelector(`.master-img-file[data-target="${id}"]`);
    if (f) f.value = "";
    atualizarPreviewImagemMaster(id);
});

/* ---------------------- PAINEL GERENCIAL DO ADMIN ---------------------- */

function alternarBotoesAdminMaster() {
    const ehAdmin = ehAdminMaster();
    // O menu roxo "Gerencial" só existe para o administrador admin@admin.com
    ["btn-open-master", "btn-open-master-mobile"].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = ehAdmin ? "" : "none";
    });
    if (!ehAdmin) {
        document.getElementById("master-modal")?.classList.add("hidden");
        document.getElementById("master-edit-user-modal")?.classList.add("hidden");
    }
    document.getElementById("btn-open-master")?.classList.toggle("hidden", !ehAdmin);
    document.getElementById("btn-open-master-mobile")?.classList.toggle("hidden", !ehAdmin);
}

function abrirPainelMaster() {
    if (!ehAdminMaster()) return uiAlert("Acesso restrito ao administrador.");
    document.getElementById("master-modal")?.classList.remove("hidden");
    inicializarCamposContato();
    trocarAbaMaster("m-users-tab", "tab-trigger-m-users");
    renderizarUsuariosMaster();
    preencherFormularioEstiloMaster();
}

function trocarAbaMaster(alvo, botao) {
    const modal = document.getElementById("master-modal");
    if (!modal) return;
    modal.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    modal.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
    document.getElementById(botao)?.classList.add("active");
    document.getElementById(alvo)?.classList.remove("hidden");
}

let cacheUsuariosMaster = {};

async function renderizarUsuariosMaster() {
    const cont = document.getElementById("master-users-list");
    if (!cont) return;
    cont.innerHTML = `<p class="comments-empty"><i class="fas fa-spinner fa-spin"></i> Carregando usuários...</p>`;
    try {
        const res = await dbFetch(`${urlRaizBanco()}/usuarios.json`);
        const data = (await res.json()) || {};
        cacheUsuariosMaster = data;
        desenharListaUsuariosMaster(document.getElementById("master-search-user")?.value || "");
    } catch (e) {
        cont.innerHTML = `<p class="comments-empty">Erro ao carregar a lista de usuários.</p>`;
    }
}

function desenharListaUsuariosMaster(filtro) {
    const cont = document.getElementById("master-users-list");
    if (!cont) return;
    const termo = (filtro || "").toLowerCase().trim();
    cont.innerHTML = "";
    const uids = Object.keys(cacheUsuariosMaster || {});
    let exibidos = 0;

    uids.forEach(uid => {
        const p = cacheUsuariosMaster[uid];
        if (!p || typeof p !== "object") return;
        const texto = `${p.nome || ""} ${p.sobrenome || ""} ${p.email || ""} ${uid}`.toLowerCase();
        if (termo && !texto.includes(termo)) return;
        exibidos++;

        const row = document.createElement("div");
        row.className = "master-user-row";
        row.innerHTML = `
            <img src="${p.foto || avatarPadrao()}" alt="">
            <div class="master-user-info">
                <strong>${p.nome || "Sem nome"} ${p.sobrenome || ""}
                    ${(p.email || "").toLowerCase() === EMAIL_ADMIN_MASTER ? '<span class="tag-admin">ADMIN</span>' : ""}
                    ${p.solicitou_exclusao ? '<span class="tag-exclusao">PEDIU EXCLUSÃO</span>' : ""}
                </strong>
                <small>${p.email ? p.email + " · " : ""}UID: ${uid}</small>
            </div>
            <div class="master-user-actions">
                <button class="crud-btn btn-edit" data-uid="${uid}" title="Editar usuário"><i class="fas fa-user-pen"></i></button>
                <button class="crud-btn btn-del" data-del="${uid}" title="Apagar dados do usuário"><i class="fas fa-trash"></i></button>
            </div>`;
        row.querySelector("[data-uid]").onclick = () => abrirEdicaoUsuarioMaster(uid);
        row.querySelector("[data-del]").onclick = () => excluirUsuarioMaster(uid);
        cont.appendChild(row);
    });

    if (exibidos === 0) cont.innerHTML = `<p class="comments-empty">Nenhum usuário encontrado.</p>`;
}

function abrirEdicaoUsuarioMaster(uid) {
    const p = cacheUsuariosMaster[uid] || {};
    uidUsuarioEmEdicaoMaster = uid;
    document.getElementById("mu-uid").value = uid;
    document.getElementById("mu-name").value = p.nome || "";
    document.getElementById("mu-lastname").value = p.sobrenome || "";
    document.getElementById("mu-email").value = p.email || "";
    inicializarCamposContato();
    definirValorCampo("mu-whatsapp", formatarWhatsApp(p.whatsapp || ""));
    definirValorCampo("mu-cidade", p.cidade || "");
    definirValorCampo("mu-uf", p.uf || "");
    document.getElementById("mu-photo").value = p.foto || "";
    document.getElementById("mu-theme").value = p.tema || "";
    document.getElementById("mu-color").value = p.cor_tema || "#ff0000";
    document.getElementById("master-edit-user-modal")?.classList.remove("hidden");
}

async function salvarUsuarioMaster() {
    if (!uidUsuarioEmEdicaoMaster) return;
    const whatsMaster = lerValorCampo("mu-whatsapp");
    if (whatsMaster && !whatsappEhValido(whatsMaster)) return uiAlert("WhatsApp inválido. Use o formato (99) 99999-9999.");
    const dados = {
        nome: document.getElementById("mu-name").value.trim(),
        sobrenome: document.getElementById("mu-lastname").value.trim(),
        email: document.getElementById("mu-email").value.trim(),
        whatsapp: apenasDigitos(lerValorCampo("mu-whatsapp")),
        cidade: lerValorCampo("mu-cidade"),
        uf: lerValorCampo("mu-uf"),
        foto: document.getElementById("mu-photo").value.trim(),
        tema: document.getElementById("mu-theme").value,
        cor_tema: document.getElementById("mu-color").value
    };
    try {
        await dbFetch(`${urlRaizBanco()}/usuarios/${uidUsuarioEmEdicaoMaster}.json`, {
            method: "PATCH", body: JSON.stringify(dados), headers: { "Content-Type": "application/json" }
        });
        uiAlert("Usuário atualizado com sucesso!");
        document.getElementById("master-edit-user-modal")?.classList.add("hidden");
        renderizarUsuariosMaster();
    } catch (e) { uiAlert("Erro ao salvar usuário: " + e.message); }
}

async function excluirUsuarioMaster(uid) {
    if (!await uiConfirm("Apagar TODOS os dados deste usuário no banco? (a credencial no Firebase Auth deve ser removida no console)")) return;
    try {
        await dbFetch(`${urlRaizBanco()}/usuarios/${uid}.json`, { method: "DELETE" });
        document.getElementById("master-edit-user-modal")?.classList.add("hidden");
        renderizarUsuariosMaster();
    } catch (e) { uiAlert("Erro ao apagar dados."); }
}

// Cria contas sem derrubar a sessão do admin (usa uma instância secundária do Firebase)
async function cadastrarUsuarioPeloMaster() {
    const nome = document.getElementById("master-new-name").value.trim();
    const sobrenome = document.getElementById("master-new-lastname").value.trim();
    const email = document.getElementById("master-new-email").value.trim().toLowerCase();
    const senha = document.getElementById("master-new-pass").value.trim();
    const whatsapp = lerValorCampo("master-new-whatsapp");
    const cidade = lerValorCampo("master-new-cidade");
    const uf = lerValorCampo("master-new-uf");
    if (!nome || !email || senha.length < 6) return uiAlert("Preencha nome, e-mail e uma senha de no mínimo 6 caracteres.");
    if (!whatsapp || !cidade || !uf) return uiAlert("Informe também o WhatsApp, a cidade e a UF do novo usuário.");
    if (!whatsappEhValido(whatsapp)) return uiAlert("WhatsApp inválido. Use o formato (99) 99999-9999.");

    const btn = document.getElementById("btn-master-create-user");
    btn.innerText = "Cadastrando..."; btn.disabled = true;
    let appSecundario = firebase.apps.find(a => a.name === "adminSecundario");
    if (!appSecundario) appSecundario = firebase.initializeApp(firebaseConfig, "adminSecundario");

    try {
        const cred = await appSecundario.auth().createUserWithEmailAndPassword(email, senha);
        const novoUid = cred.user.uid;
        await dbFetch(`${urlRaizBanco()}/usuarios/${novoUid}.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nome, sobrenome, email,
                whatsapp: apenasDigitos(whatsapp),
                cidade, uf,
                cor_tema: configGlobalSite.corPadrao || "#ff0000",
                tema: configGlobalSite.temaPadrao || "",
                foto: "",
                firebaseUrl: `${urlRaizBanco()}/usuarios/${novoUid}/midias.json`
            })
        });
        await appSecundario.auth().signOut();
        uiAlert(`Usuário ${nome} cadastrado com sucesso!`);
        ["master-new-name", "master-new-lastname", "master-new-email", "master-new-pass", "master-new-whatsapp", "master-new-cidade", "master-new-uf"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
        trocarAbaMaster("m-users-tab", "tab-trigger-m-users");
        renderizarUsuariosMaster();
    } catch (e) {
        uiAlert("Erro ao cadastrar usuário: " + e.message);
    } finally {
        btn.innerText = "Cadastrar Novo Usuário"; btn.disabled = false;
    }
}

function preencherFormularioEstiloMaster() {
    const c = configGlobalSite || {};
    const cor = c.corPadrao || "#ff0000";
    const inputCor = document.getElementById("master-color-input");
    if (inputCor) inputCor.value = cor;
    const hex = document.getElementById("master-color-hex");
    if (hex) hex.innerText = cor.toUpperCase();
    const nome = document.getElementById("master-site-name");
    if (nome) nome.value = c.siteNome || "StreamHub";
    const tituloSite = document.getElementById("master-site-title");
    if (tituloSite) tituloSite.value = c.siteTitulo || "";
    [["master-logo-square", "logoQuadrada"], ["master-logo-wide", "logoExtenso"], ["master-favicon", "favicon"]].forEach(([id, k]) => {
        const el = document.getElementById(id);
        if (el) el.value = c[k] || "";
        atualizarPreviewImagemMaster(id);
    });

    document.querySelectorAll(".master-theme-btn").forEach(b => {
        const val = b.getAttribute("data-theme") === "youtube" ? "" : `theme-${b.getAttribute("data-theme")}`;
        b.classList.toggle("active", val === (c.temaPadrao || ""));
    });

    const mapa = {
        "fn-comentarios": "comentarios", "fn-temas": "temas", "fn-whatsapp": "whatsapp",
        "fn-cadastro": "cadastro", "fn-google": "google",
        "fn-admin-users": "adminUsuarios", "fn-player-livre": "playerLivre"
    };
    Object.keys(mapa).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = c[mapa[id]] !== false;
    });
}

async function salvarConfigGlobal(parcial) {
    try {
        await dbFetch(`${urlRaizBanco()}/config_global.json`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parcial)
        });
        configGlobalSite = { ...configGlobalSite, ...parcial };
        aplicarConfigGlobal();
        uiAlert("Configurações salvas com sucesso!");
    } catch (e) { uiAlert("Erro ao salvar configurações globais."); }
}

/* ---------------------- EVENTOS DOS NOVOS RECURSOS ---------------------- */

document.addEventListener("DOMContentLoaded", () => {
    configurarPlayerLivre();
    configurarRedimensionamentoComentarios();

    // Foto de perfil: upload em base64
    document.getElementById("profile-photo-file")?.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const base64 = await converterArquivoParaBase64(file);
            fotoPerfilTemporaria = base64;
            document.getElementById("profile-photo-preview").src = base64;
            document.getElementById("profile-photo-url").value = "";
        } catch (err) { uiAlert(err.message); }
        e.target.value = "";
    });

    // Foto de perfil: via link
    document.getElementById("profile-photo-url")?.addEventListener("input", (e) => {
        const url = e.target.value.trim();
        fotoPerfilTemporaria = url;
        document.getElementById("profile-photo-preview").src = url || avatarPadrao();
    });

    document.addEventListener("click", async (e) => {
        if (e.target.closest("#btn-remove-photo")) {
            fotoPerfilTemporaria = "";
            document.getElementById("profile-photo-preview").src = avatarPadrao();
            document.getElementById("profile-photo-url").value = "";
        }

        // Salvar perfil: grava também a foto (o handler original salva o restante)
        if (e.target.closest("#btn-save-profile-changes")) {
            if (fotoPerfilTemporaria !== null) {
                const foto = fotoPerfilTemporaria;
                await salvarPreferenciaNoFirebase({ foto });
                aplicarFotoNoTopo(foto);
            }
        }

        // Comentários
        if (e.target.closest("#btn-toggle-comments")) alternarPainelComentarios();
        if (e.target.closest("#btn-reload-comments")) { carregarComentariosDoVideo(videoIdEmExibicao); montarCaixaDeComentario(); }
        if (e.target.closest("#btn-google-para-comentar")) await pedirLoginGoogleParaComentar();
        if (e.target.closest("#btn-enviar-comentario")) await enviarComentarioNoVideo();

        // Painel gerencial
        if (e.target.closest("#btn-open-master") || e.target.closest("#btn-open-master-mobile")) abrirPainelMaster();
        if (e.target.closest("#btn-close-master")) document.getElementById("master-modal")?.classList.add("hidden");
        if (e.target.closest("#tab-trigger-m-users")) { trocarAbaMaster("m-users-tab", "tab-trigger-m-users"); renderizarUsuariosMaster(); }
        if (e.target.closest("#tab-trigger-m-new")) trocarAbaMaster("m-new-tab", "tab-trigger-m-new");
        if (e.target.closest("#tab-trigger-m-style")) { trocarAbaMaster("m-style-tab", "tab-trigger-m-style"); preencherFormularioEstiloMaster(); }
        if (e.target.closest("#tab-trigger-m-func")) { trocarAbaMaster("m-func-tab", "tab-trigger-m-func"); preencherFormularioEstiloMaster(); }
        if (e.target.closest("#btn-master-reload-users")) renderizarUsuariosMaster();
        if (e.target.closest("#btn-master-create-user")) cadastrarUsuarioPeloMaster();
        if (e.target.closest("#btn-close-master-edit")) document.getElementById("master-edit-user-modal")?.classList.add("hidden");
        if (e.target.closest("#btn-master-save-user")) salvarUsuarioMaster();
        if (e.target.closest("#btn-master-delete-user")) excluirUsuarioMaster(uidUsuarioEmEdicaoMaster);

        const btnTemaMaster = e.target.closest(".master-theme-btn");
        if (btnTemaMaster) {
            document.querySelectorAll(".master-theme-btn").forEach(b => b.classList.remove("active"));
            btnTemaMaster.classList.add("active");
        }

        if (e.target.closest("#btn-master-save-style")) {
            const ativo = document.querySelector(".master-theme-btn.active");
            const tema = ativo ? (ativo.getAttribute("data-theme") === "youtube" ? "" : `theme-${ativo.getAttribute("data-theme")}`) : "";
            salvarConfigGlobal({
                temaPadrao: tema,
                corPadrao: document.getElementById("master-color-input").value,
                siteNome: document.getElementById("master-site-name").value.trim() || "StreamHub",
                siteTitulo: document.getElementById("master-site-title").value.trim(),
                logoQuadrada: document.getElementById("master-logo-square").value.trim(),
                logoExtenso: document.getElementById("master-logo-wide").value.trim(),
                favicon: document.getElementById("master-favicon").value.trim()
            });
        }

        if (e.target.closest("#btn-master-save-func")) {
            salvarConfigGlobal({
                comentarios: document.getElementById("fn-comentarios").checked,
                temas: document.getElementById("fn-temas").checked,
                whatsapp: document.getElementById("fn-whatsapp").checked,
                cadastro: document.getElementById("fn-cadastro").checked,
                google: document.getElementById("fn-google").checked,
                adminUsuarios: document.getElementById("fn-admin-users").checked,
                playerLivre: document.getElementById("fn-player-livre").checked
            });
        }
    });

    document.getElementById("master-search-user")?.addEventListener("input", (e) => desenharListaUsuariosMaster(e.target.value));
    document.getElementById("master-color-input")?.addEventListener("input", (e) => {
        document.getElementById("master-color-hex").innerText = e.target.value.toUpperCase();
    });

    // Preenche a foto sempre que o modal de perfil for aberto
    const observarPerfil = new MutationObserver(async () => {
        const modal = document.getElementById("profile-modal");
        if (modal && !modal.classList.contains("hidden") && fotoPerfilTemporaria === null) {
            const perfil = await carregarPerfilAtual();
            const fotoGoogle = firebase.auth().currentUser?.photoURL || "";
            preencherFotoNoModalPerfil(perfil?.foto || fotoGoogle || "");
        }
    });
    const modalPerfil = document.getElementById("profile-modal");
    if (modalPerfil) observarPerfil.observe(modalPerfil, { attributes: true, attributeFilter: ["class"] });

    // Sessão: avatar no topo, botões de admin e configuração global
    firebase.auth().onAuthStateChanged(async (user) => {
        alternarBotoesAdminMaster();
        await carregarConfigGlobal();
        if (!user) { aplicarFotoNoTopo(""); return; }
        try {
            const res = await dbFetch(`${urlRaizBanco()}/usuarios/${user.uid}.json`);
            const perfil = (await res.json()) || {};
            let fotoAtual = perfil.foto || "";
            if (!fotoAtual && user.photoURL) {
                fotoAtual = user.photoURL;
                salvarPreferenciaNoFirebase({ foto: fotoAtual });
            }
            aplicarFotoNoTopo(fotoAtual);
            if (!perfil.email) {
                dbFetch(`${urlRaizBanco()}/usuarios/${user.uid}.json`, {
                    method: "PATCH", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: user.email || "" })
                });
            }
            if (!perfil.tema && configGlobalSite.temaPadrao) document.body.className = configGlobalSite.temaPadrao;
            if (!perfil.cor_tema && configGlobalSite.corPadrao) aplicarCorTema(configGlobalSite.corPadrao);
        } catch (e) { /* silencioso */ }
        alternarBotoesAdminMaster();
    });
});

// ==========================================
// ESPELHAMENTO DE VÍDEOS (CHROMECAST)
// Módulo independente: usa o Google Cast SDK (CAF).
// - Arquivos diretos (mp4/mkv/webm/mp3/hls) -> Default Media Receiver
// - Vídeos e playlists do YouTube -> app oficial do YouTube na TV
// - Demais fontes (iframes/Drive/Archive) -> orienta o espelhamento de aba
// ==========================================
const CAST_YT_RECEIVER_ID = "233637DE";
const CAST_YT_NAMESPACE = "urn:x-cast:com.google.youtube.mdx";

let castApiPronta = false;
let castContext = null;
let castRemotePlayer = null;
let castRemoteController = null;
let castModoAtual = null;      // 'media' | 'youtube'
let castReceiverDesejado = null;
let castEstaTransmitindo = false;
let castIndiceEmTransmissao = -1;

let castTentativas = 0;
let castTimerBusca = null;

// A API do Chromecast pode ficar pronta ANTES ou DEPOIS deste arquivo carregar.
// Por isso registramos o callback e também fazemos uma verificação periódica.
window['__onGCastApiAvailable'] = function (disponivel) {
    window.__castApiDisponivel = !!disponivel;
    if (!disponivel) return;
    try { inicializarCast(); } catch (e) { console.warn("Cast: falha ao iniciar", e); }
};

function castSdkCarregado() {
    return typeof cast !== "undefined" && !!cast.framework &&
           typeof chrome !== "undefined" && !!chrome.cast && !!chrome.cast.isAvailable;
}

function garantirSdkCast() {
    if (castSdkCarregado()) { inicializarCast(); return; }
    const jaTem = Array.from(document.scripts).some(sc => (sc.src || "").includes("cast_sender.js"));
    if (!jaTem) {
        const sc = document.createElement("script");
        sc.src = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
        sc.async = true;
        document.head.appendChild(sc);
    }
    if (castTimerBusca) return;
    castTimerBusca = setInterval(() => {
        castTentativas++;
        if (castSdkCarregado()) { inicializarCast(); }
        if (castApiPronta || castTentativas > 60) { clearInterval(castTimerBusca); castTimerBusca = null; }
    }, 500);
}

function inicializarCast() {
    if (castApiPronta || !castSdkCarregado()) return;
    castApiPronta = true;
    castContext = cast.framework.CastContext.getInstance();
    castDefinirReceiver(chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID);

    castContext.addEventListener(
        cast.framework.CastContextEventType.CAST_STATE_CHANGED,
        () => atualizarInterfaceCast()
    );
    castContext.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        (evento) => {
            const S = cast.framework.SessionState;
            if (evento.sessionState === S.SESSION_STARTED || evento.sessionState === S.SESSION_RESUMED) {
                castEstaTransmitindo = true;
                if (castModoAtual) transmitirFaixaAtual(true);
            }
            if (evento.sessionState === S.SESSION_ENDED) {
                castEstaTransmitindo = false;
                castModoAtual = null;
                castIndiceEmTransmissao = -1;
                retomarReproducaoLocal();
            }
            atualizarInterfaceCast();
        }
    );

    castRemotePlayer = new cast.framework.RemotePlayer();
    castRemoteController = new cast.framework.RemotePlayerController(castRemotePlayer);
    castRemoteController.addEventListener(
        cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
        () => {
            if (!castEstaTransmitindo) return;
            if (castRemotePlayer.playerState === chrome.cast.media.PlayerState.IDLE &&
                castIndiceEmTransmissao === currentTrackIndex &&
                currentTrackIndex + 1 < currentPlaylist.length) {
                const media = castContext.getCurrentSession()?.getMediaSession();
                if (media && media.idleReason === chrome.cast.media.IdleReason.FINISHED) {
                    playTrack(currentTrackIndex + 1);
                }
            }
        }
    );

    // Reavalia periodicamente: a descoberta na rede local costuma demorar alguns segundos
    setInterval(() => { try { atualizarInterfaceCast(); } catch (e) {} }, 3000);
    atualizarInterfaceCast();
}

function castDefinirReceiver(appId) {
    if (!castContext || castReceiverDesejado === appId) return;
    castReceiverDesejado = appId;
    castContext.setOptions({
        receiverApplicationId: appId,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        androidReceiverCompatible: true
    });
}

function castLinkDaFaixa(track) {
    let link = ((track && track.link) || "").trim();
    // Converte links de visualização do Google Drive em link direto de mídia
    const drive = link.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
    if (drive) link = `https://drive.google.com/uc?export=download&id=${drive[1]}`;
    // Converte página do Archive.org em arquivo direto quando possível
    if (link.includes("archive.org/details/")) link = link.replace("/details/", "/download/");
    return link;
}

function castTipoDaFonte(link) {
    const url = (link || "").toLowerCase();
    const vId = (typeof extractYoutubeId === "function") ? extractYoutubeId(link) : null;
    const plId = (typeof extractPlaylistId === "function") ? extractPlaylistId(link) : null;
    if (vId || plId || url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
    if (/\.(mp4|m4v|webm|ogv|mov|mkv|m3u8|mpd|flv|avi)(\?|$)/.test(url)) return "media";
    if (typeof ehArquivoDeAudio === "function" && ehArquivoDeAudio(url)) return "media";
    if (url.includes("raw.githubusercontent") || url.includes("docs.google.com/uc?export=download")) return "media";
    if (url.includes("drive.google.com/file/d/")) return "media";
    if (/^https?:\/\//.test(url)) return "media"; // tentativa universal: qualquer link é enviado ao receptor
    return "desconhecido";
}

function castMimeDoArquivo(link) {
    const url = (link || "").toLowerCase();
    if (url.includes(".m3u8")) return "application/x-mpegurl";
    if (url.includes(".mpd")) return "application/dash+xml";
    if (url.includes(".webm")) return "video/webm";
    if (url.includes(".mkv")) return "video/x-matroska";
    if (url.includes(".ogv")) return "video/ogg";
    if (typeof ehArquivoDeAudio === "function" && ehArquivoDeAudio(url)) {
        return (typeof mimeDoAudio === "function" && mimeDoAudio(url)) || "audio/mpeg";
    }
    return "video/mp4";
}

function castAvisar(mensagem) {
    const anterior = document.querySelector(".cast-toast");
    if (anterior) anterior.remove();
    const caixa = document.createElement("div");
    caixa.className = "cast-toast";
    caixa.innerHTML = mensagem;
    document.body.appendChild(caixa);
    setTimeout(() => { try { caixa.remove(); } catch (e) {} }, 7000);
}

function pausarReproducaoLocal() {
    try { if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); } catch (e) {}
    const raw = document.getElementById("raw-player");
    if (raw) { try { raw.pause(); } catch (e) {} }
}

function retomarReproducaoLocal() {
    const raw = document.getElementById("raw-player");
    if (raw && raw.src && !raw.classList.contains("hidden")) { try { raw.play(); } catch (e) {} }
}

async function espelharPorRemotePlayback() {
    // Compatibilidade universal: Safari/iOS (AirPlay) e navegadores com Remote Playback API
    const raw = document.getElementById("raw-player");
    if (raw && typeof raw.webkitShowPlaybackTargetPicker === "function" && raw.src) {
        try { raw.webkitShowPlaybackTargetPicker(); return true; } catch (e) {}
    }
    if (raw && raw.remote && typeof raw.remote.prompt === "function" && raw.src) {
        try { await raw.remote.prompt(); return true; } catch (e) {}
    }
    return false;
}

async function alternarTransmissao() {
    if (castEstaTransmitindo) { encerrarTransmissao(); return; }

    if (!castApiPronta || !castContext) {
        garantirSdkCast();
        // Aguarda um instante: o SDK pode ainda estar carregando
        await new Promise(r => setTimeout(r, 900));
    }
    if (!castApiPronta || !castContext) {
        if (await espelharPorRemotePlayback()) return;
        castAvisar("<b>Espelhamento indisponível neste navegador</b><br>Use Chrome, Edge ou Android (via HTTPS) para Chromecast, ou Safari/iOS para AirPlay.<br>Alternativa: menu do navegador (⋮) &rarr; <i>Transmitir</i> &rarr; <i>Transmitir aba</i>.");
        return;
    }
    if (castContext.getCastState() === cast.framework.CastState.NO_DEVICES_AVAILABLE) {
        // NÃO bloqueamos mais: a descoberta é assíncrona e o diálogo do navegador
        // costuma encontrar aparelhos que ainda não foram anunciados ao site.
        castAvisar("<b>Procurando dispositivos na rede...</b><br>Se a lista aparecer vazia, confirme que o celular/PC e a TV estão na mesma rede Wi-Fi (sem isolamento de clientes/VPN).");
    }
    if (!currentPlaylist.length || currentTrackIndex < 0) {
        castAvisar("<b>Escolha um vídeo primeiro</b><br>Abra uma mídia no player e depois toque em transmitir.");
        return;
    }
    transmitirFaixaAtual(false);
}

async function transmitirFaixaAtual(sessaoJaAtiva) {
    const track = currentPlaylist[currentTrackIndex];
    if (!track) return;
    const link = castLinkDaFaixa(track);
    const tipo = castTipoDaFonte(link);

    if (tipo === "desconhecido") {
        if (await espelharPorRemotePlayback()) return;
        castAvisar("<b>Fonte exibida por player externo</b><br>Use o menu do navegador (⋮) &rarr; <i>Transmitir</i> &rarr; <i>Fontes: Transmitir aba</i> para espelhar esta mídia.");
        return;
    }

    const appDesejado = tipo === "youtube" ? CAST_YT_RECEIVER_ID : chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
    const sessaoAtual = castContext.getCurrentSession();
    const precisaTrocarApp = sessaoAtual && castReceiverDesejado !== appDesejado;

    if (precisaTrocarApp) {
        try { await castContext.endCurrentSession(true); } catch (e) {}
    }

    castModoAtual = tipo;
    castDefinirReceiver(appDesejado);

    if (!castContext.getCurrentSession()) {
        try {
            await castContext.requestSession();
            return; // o evento SESSION_STARTED chama esta função novamente
        } catch (e) {
            castModoAtual = null;
            return;
        }
    }

    pausarReproducaoLocal();
    if (tipo === "youtube") await enviarYoutubeParaTV(link);
    else await enviarArquivoParaTV(track, link);

    castEstaTransmitindo = true;
    castIndiceEmTransmissao = currentTrackIndex;
    atualizarInterfaceCast();
}

async function enviarYoutubeParaTV(link) {
    const sessao = castContext.getCurrentSession();
    if (!sessao) return;
    const videoId = (typeof extractYoutubeId === "function") ? extractYoutubeId(link) : null;
    const listId = (typeof extractPlaylistId === "function") ? extractPlaylistId(link) : null;
    const dados = { currentTime: 0 };
    if (videoId) dados.videoId = videoId;
    if (listId) dados.listId = listId;
    if (!videoId && !listId) {
        castAvisar("<b>Não foi possível identificar o vídeo do YouTube.</b>");
        return;
    }
    try {
        await sessao.sendMessage(CAST_YT_NAMESPACE, { type: "flingVideo", data: dados });
    } catch (e) {
        castAvisar("<b>A TV recusou a transmissão do YouTube</b><br>Use o menu do Chrome (⋮) &rarr; <i>Transmitir</i> para espelhar a aba.");
    }
}

async function enviarArquivoParaTV(track, link) {
    const sessao = castContext.getCurrentSession();
    if (!sessao) return;
    const info = new chrome.cast.media.MediaInfo(link, castMimeDoArquivo(link));
    info.metadata = new chrome.cast.media.GenericMediaMetadata();
    info.metadata.title = (track && (track.título || track.titulo)) || "StreamHub";
    if (track && track.capa) info.metadata.images = [new chrome.cast.Image(track.capa)];
    const pedido = new chrome.cast.media.LoadRequest(info);
    pedido.autoplay = true;
    try {
        await sessao.loadMedia(pedido);
    } catch (e) {
        const ok = await espelharPorRemotePlayback();
        if (!ok) castAvisar("<b>Não foi possível enviar esta mídia</b><br>O formato pode não ser suportado pela TV. Use o menu do navegador (⋮) &rarr; <i>Transmitir</i> &rarr; <i>Transmitir aba</i> para espelhar mesmo assim.");
    }
}

function encerrarTransmissao() {
    if (!castContext) return;
    try { castContext.endCurrentSession(true); } catch (e) {}
    castEstaTransmitindo = false;
    castModoAtual = null;
    castIndiceEmTransmissao = -1;
    atualizarInterfaceCast();
    retomarReproducaoLocal();
}

function garantirBarraDeStatusCast() {
    if (document.getElementById("cast-status-bar")) return document.getElementById("cast-status-bar");
    const container = document.getElementById("player-container");
    const header = container ? container.querySelector(".player-header") : null;
    if (!container || !header) return null;
    const barra = document.createElement("div");
    barra.id = "cast-status-bar";
    barra.innerHTML =
        '<span class="cast-status-text"><i class="fab fa-chromecast"></i> <span id="cast-status-label">Transmitindo</span></span>' +
        '<span class="cast-status-actions">' +
        '<button type="button" id="btn-cast-play-pause"><i class="fas fa-pause"></i> Pausar</button>' +
        '<button type="button" id="btn-cast-stop"><i class="fas fa-stop"></i> Parar</button>' +
        '</span>';
    header.insertAdjacentElement("afterend", barra);
    return barra;
}

function atualizarInterfaceCast() {
    const botao = document.getElementById("btn-cast");
    if (botao) {
        let disponivel = false;
        try {
            disponivel = !!(castApiPronta && castContext &&
                castContext.getCastState() !== cast.framework.CastState.NO_DEVICES_AVAILABLE);
        } catch (e) { disponivel = false; }
        const raw = document.getElementById("raw-player");
        if (!disponivel && raw && (typeof raw.webkitShowPlaybackTargetPicker === "function" || (raw.remote && raw.remote.prompt))) disponivel = true;
        botao.classList.toggle("cast-available", !!disponivel);
        botao.classList.toggle("cast-connected", !!castEstaTransmitindo);
        botao.title = castEstaTransmitindo ? "Parar transmissão para a TV" : "Transmitir para a TV (Chromecast)";
    }
    const barra = garantirBarraDeStatusCast();
    if (!barra) return;
    barra.classList.toggle("active", !!castEstaTransmitindo);
    const rotulo = document.getElementById("cast-status-label");
    if (rotulo) {
        const nomeDispositivo = (castContext && castContext.getCurrentSession) ?
            (castContext.getCurrentSession()?.getCastDevice()?.friendlyName || "TV") : "TV";
        rotulo.innerText = `Transmitindo em ${nomeDispositivo}`;
    }
    const btnPP = document.getElementById("btn-cast-play-pause");
    if (btnPP) {
        const pausado = castRemotePlayer && castRemotePlayer.isPaused;
        btnPP.innerHTML = pausado ? '<i class="fas fa-play"></i> Retomar' : '<i class="fas fa-pause"></i> Pausar';
    }
}

document.addEventListener("click", (e) => {
    if (e.target.closest("#btn-cast")) { alternarTransmissao(); return; }
    if (e.target.closest("#btn-cast-stop")) { encerrarTransmissao(); return; }
    if (e.target.closest("#btn-cast-play-pause")) {
        if (castRemoteController) {
            try { castRemoteController.playOrPause(); } catch (err) {}
            setTimeout(atualizarInterfaceCast, 250);
        }
    }
});

// Troca de faixa e volume continuam funcionando enquanto transmite
(function integrarCastComPlayer() {
    if (typeof playTrack === "function") {
        const originalPlay = playTrack;
        playTrack = function (index) {
            originalPlay(index);
            if (castEstaTransmitindo) {
                setTimeout(() => { try { transmitirFaixaAtual(true); } catch (e) {} }, 200);
            }
        };
    }
    if (typeof aplicarVolume === "function") {
        const originalVolume = aplicarVolume;
        aplicarVolume = function () {
            originalVolume();
            if (!castEstaTransmitindo || !castContext) return;
            const slider = document.getElementById("player-volume-slider");
            const btnMute = document.getElementById("btn-mute-toggle");
            const sessao = castContext.getCurrentSession();
            if (!slider || !sessao) return;
            const mudo = btnMute && btnMute.getAttribute("data-muted") === "true";
            try {
                sessao.setVolume(Math.max(0, Math.min(1, parseInt(slider.value) / 100)));
                sessao.setMute(!!mudo);
            } catch (e) {}
        };
    }
})();

document.addEventListener("DOMContentLoaded", () => { garantirBarraDeStatusCast(); atualizarInterfaceCast(); });

document.addEventListener("DOMContentLoaded", () => { try { garantirSdkCast(); } catch (e) {} });
try { garantirSdkCast(); } catch (e) {}

// ==========================================
// COMPARTILHAMENTO DE MÍDIAS
// Gera um link do próprio site apontando para a mídia e usa o
// compartilhamento nativo do aparelho (ou copia o link).
// ==========================================
function linkDeCompartilhamento(info) {
    const base = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    params.set("midia", (info && info.link) || "");
    const titulo = (info && (info.título || info.titulo)) || "";
    if (titulo) params.set("t", titulo);
    const capa = (info && info.capa) || "";
    if (capa) params.set("capa", capa);
    return `${base}?${params.toString()}`;
}

async function compartilharMidia(info) {
    if (!info || !info.link) { castAvisar("<b>Nada para compartilhar</b>"); return; }
    abrirMenuCompartilhamento(info);
}

// Compartilhamento direto pelo recurso nativo do aparelho (ou cópia do link)
async function compartilharLinkNativo(url, titulo, texto) {
    if (navigator.share) {
        try { await navigator.share({ title: titulo, text: texto, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try {
        await navigator.clipboard.writeText(url);
        castAvisar("<b>Link copiado!</b><br>Cole onde quiser para compartilhar esta mídia.");
        return;
    } catch (e) {}
    const campo = document.createElement("textarea");
    campo.value = url; campo.style.position = "fixed"; campo.style.opacity = "0";
    document.body.appendChild(campo); campo.select();
    try { document.execCommand("copy"); castAvisar("<b>Link copiado!</b>"); }
    catch (e) { castAvisar(`<b>Copie o link abaixo:</b><br><small>${url}</small>`); }
    campo.remove();
}

function compartilharMidiaAtual() {
    const track = (typeof currentPlaylist !== "undefined" && currentPlaylist[currentTrackIndex]) || null;
    if (!track) { castAvisar("<b>Abra uma mídia no player</b> antes de compartilhar."); return; }
    compartilharMidia(track);
}

// ==========================================
// MENU DE OPÇÕES DE COMPARTILHAMENTO
// Link do StreamHub, link padrão do YouTube, WhatsApp,
// Facebook, Telegram, X, e-mail, cópia e menu do aparelho
// ==========================================
async function copiarTextoParaAreaDeTransferencia(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch (e) {}
    const campo = document.createElement("textarea");
    campo.value = texto; campo.style.position = "fixed"; campo.style.opacity = "0";
    document.body.appendChild(campo); campo.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    campo.remove();
    return ok;
}

function linkPadraoDoYoutube(info) {
    const id = typeof extractYoutubeId === "function" ? extractYoutubeId(((info && info.link) || "").trim()) : null;
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

function fecharMenuCompartilhamento() {
    document.getElementById("share-sheet")?.remove();
}

function abrirMenuCompartilhamento(info) {
    if (!info || !info.link) { castAvisar("<b>Nada para compartilhar</b>"); return; }
    fecharMenuCompartilhamento();

    const titulo = (info.título || info.titulo || "StreamHub");
    const linkSite = linkDeCompartilhamento(info);
    const linkYt = linkPadraoDoYoutube(info);
    const texto = `Assista "${titulo}" no StreamHub`;

    const overlay = document.createElement("div");
    overlay.id = "share-sheet";
    overlay.className = "share-sheet-overlay";
    overlay.innerHTML = `
        <div class="share-sheet-box" role="dialog" aria-label="Compartilhar mídia">
            <div class="share-sheet-head">
                <span><i class="fas fa-share-nodes"></i> Compartilhar</span>
                <button type="button" class="btn-player-action" data-share="fechar" title="Fechar"><i class="fas fa-times"></i></button>
            </div>
            <p class="share-sheet-title">${titulo}</p>
            <div class="share-sheet-grid">
                <button type="button" class="share-opt" data-share="site"><i class="fas fa-link"></i><span>Link do StreamHub</span></button>
                ${linkYt ? '<button type="button" class="share-opt" data-share="youtube"><i class="fab fa-youtube"></i><span>Link do YouTube</span></button>' : ""}
                <button type="button" class="share-opt" data-share="whatsapp"><i class="fab fa-whatsapp"></i><span>WhatsApp</span></button>
                <button type="button" class="share-opt" data-share="facebook"><i class="fab fa-facebook"></i><span>Facebook</span></button>
                <button type="button" class="share-opt" data-share="telegram"><i class="fab fa-telegram"></i><span>Telegram</span></button>
                <button type="button" class="share-opt" data-share="twitter"><i class="fab fa-x-twitter"></i><span>X (Twitter)</span></button>
                <button type="button" class="share-opt" data-share="email"><i class="fas fa-envelope"></i><span>E-mail</span></button>
                <button type="button" class="share-opt" data-share="nativo"><i class="fas fa-mobile-screen"></i><span>Outros apps do aparelho</span></button>
            </div>
            <div class="share-sheet-link-row">
                <input type="text" id="share-sheet-link" readonly value="${linkSite}">
                <button type="button" class="btn-send-comment" data-share="copiar"><i class="fas fa-copy"></i> Copiar</button>
            </div>
            ${linkYt ? `<div class="share-sheet-link-row">
                <input type="text" id="share-sheet-link-yt" readonly value="${linkYt}">
                <button type="button" class="btn-send-comment" data-share="copiar-yt"><i class="fas fa-copy"></i> Copiar</button>
            </div>` : ""}
        </div>`;

    const escolhido = () => {
        const seletor = overlay.querySelector(".share-opt.selected");
        return seletor && seletor.dataset.share === "youtube" && linkYt ? linkYt : linkSite;
    };

    const abrirJanela = (url) => window.open(url, "_blank", "noopener,noreferrer");

    overlay.addEventListener("click", async (e) => {
        if (e.target === overlay) { fecharMenuCompartilhamento(); return; }
        const botao = e.target.closest("[data-share]");
        if (!botao) return;
        const acao = botao.dataset.share;
        const url = escolhido();

        if (acao === "fechar") { fecharMenuCompartilhamento(); return; }
        if (acao === "site" || acao === "youtube") {
            overlay.querySelectorAll(".share-opt").forEach(b => b.classList.remove("selected"));
            botao.classList.add("selected");
            const alvo = acao === "youtube" ? linkYt : linkSite;
            castAvisar(acao === "youtube"
                ? "<b>Link do YouTube selecionado</b><br>Escolha agora por onde compartilhar."
                : "<b>Link do StreamHub selecionado</b><br>Escolha agora por onde compartilhar.");
            const campo = document.getElementById("share-sheet-link");
            if (campo) campo.value = alvo;
            return;
        }
        if (acao === "whatsapp") { abrirJanela(`https://api.whatsapp.com/send?text=${encodeURIComponent(texto + " " + url)}`); }
        else if (acao === "facebook") { abrirJanela(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`); }
        else if (acao === "telegram") { abrirJanela(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(texto)}`); }
        else if (acao === "twitter") { abrirJanela(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(texto)}`); }
        else if (acao === "email") { window.location.href = `mailto:?subject=${encodeURIComponent(titulo)}&body=${encodeURIComponent(texto + "\n\n" + url)}`; }
        else if (acao === "nativo") { await compartilharLinkNativo(url, titulo, texto); }
        else if (acao === "copiar") {
            const ok = await copiarTextoParaAreaDeTransferencia(document.getElementById("share-sheet-link")?.value || linkSite);
            castAvisar(ok ? "<b>Link copiado!</b>" : "<b>Copie o link manualmente</b>");
        } else if (acao === "copiar-yt") {
            const ok = await copiarTextoParaAreaDeTransferencia(linkYt);
            castAvisar(ok ? "<b>Link do YouTube copiado!</b>" : "<b>Copie o link manualmente</b>");
        }
        fecharMenuCompartilhamento();
    });

    document.body.appendChild(overlay);
    overlay.querySelector('[data-share="site"]')?.classList.add("selected");
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharMenuCompartilhamento(); });

// Abre automaticamente a mídia recebida por link compartilhado
function abrirMidiaCompartilhada() {
    const params = new URLSearchParams(window.location.search);
    const link = params.get("midia");
    if (!link) return;
    const titulo = params.get("t") || "Mídia compartilhada";
    const capa = params.get("capa") || "";
    let tentativas = 0;
    const timer = setInterval(() => {
        tentativas++;
        const app = document.getElementById("app-container");
        const pronto = app && !app.classList.contains("hidden") && typeof playTrack === "function";
        if (pronto) {
            clearInterval(timer);
            currentPlaylist = [{ título: titulo, link: link, capa: capa }];
            currentTrackIndex = 0;
            try { playTrack(0); } catch (e) {}
        }
        if (tentativas > 120) clearInterval(timer);
    }, 500);
}
document.addEventListener("DOMContentLoaded", abrirMidiaCompartilhada);

// ==========================================
// AÇÕES DO PLAYER: COMPARTILHAR + MENU RETRÁTIL (MOBILE)
// ==========================================
function garantirBotoesDoPlayer() {
    const grupo = document.querySelector("#player-container .player-controls-group");
    if (!grupo) return;

    if (!document.getElementById("btn-share-media")) {
        const btn = document.createElement("button");
        btn.id = "btn-share-media";
        btn.className = "btn-player-action";
        btn.type = "button";
        btn.title = "Compartilhar esta mídia";
        btn.innerHTML = '<i class="fas fa-share-nodes"></i>';
        const alvo = document.getElementById("btn-cast");
        if (alvo) alvo.insertAdjacentElement("beforebegin", btn);
        else grupo.appendChild(btn);
    }

    if (!document.getElementById("btn-player-more")) {
        const mais = document.createElement("button");
        mais.id = "btn-player-more";
        mais.className = "btn-player-action btn-player-more";
        mais.type = "button";
        mais.title = "Mais opções";
        mais.innerHTML = '<i class="fas fa-ellipsis-vertical"></i>';
        grupo.insertAdjacentElement("beforebegin", mais);
    }

    // O botão de fechar fica sempre visível, fora do menu retrátil
    const fechar = document.getElementById("btn-close-player");
    if (fechar && fechar.parentElement === grupo) grupo.insertAdjacentElement("afterend", fechar);

    ajustarModoCompactoPlayer();
}

function ajustarModoCompactoPlayer() {
    const header = document.querySelector("#player-container .player-header");
    const grupo = document.querySelector("#player-container .player-controls-group");
    if (!header || !grupo) return;
    const compacto = window.innerWidth <= 768 || (document.getElementById("player-container")?.offsetWidth || 9999) < 520;
    header.classList.toggle("compact-mode", compacto);
    if (!compacto) grupo.classList.remove("menu-open");
}

document.addEventListener("DOMContentLoaded", garantirBotoesDoPlayer);
window.addEventListener("resize", ajustarModoCompactoPlayer);

document.addEventListener("click", (e) => {
    if (e.target.closest("#btn-share-media")) { e.preventDefault(); compartilharMidiaAtual(); return; }
    if (e.target.closest("#btn-player-more")) {
        e.preventDefault(); e.stopPropagation();
        document.querySelector("#player-container .player-controls-group")?.classList.toggle("menu-open");
        return;
    }
    if (!e.target.closest(".player-controls-group")) {
        document.querySelector("#player-container .player-controls-group")?.classList.remove("menu-open");
    }
});

// ==========================================
// MOSTRAR / OCULTAR SENHA NO LOGIN
// ==========================================
function ativarBotoesDeSenha() {
    document.querySelectorAll('input[type="password"], input[data-senha-visivel]').forEach((campo) => {
        const grupo = campo.parentElement;
        if (!grupo || grupo.querySelector(".toggle-senha")) return;
        grupo.classList.add("has-toggle-senha");

        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "toggle-senha";
        botao.tabIndex = -1;
        botao.setAttribute("data-visivel", "0");
        botao.setAttribute("aria-label", "Mostrar senha");
        botao.title = "Mostrar senha";
        botao.innerHTML = '<i class="fas fa-eye-slash"></i>';

        const alternar = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const visivel = campo.getAttribute("type") === "text";
            const novoVisivel = !visivel;
            campo.setAttribute("type", novoVisivel ? "text" : "password");
            campo.setAttribute("data-senha-visivel", novoVisivel ? "1" : "0");
            botao.setAttribute("data-visivel", novoVisivel ? "1" : "0");
            // Recria o ícone para a animação de olho reiniciar sempre
            botao.innerHTML = novoVisivel ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
            botao.title = novoVisivel ? "Ocultar senha" : "Mostrar senha";
            botao.setAttribute("aria-label", botao.title);
        };

        // Pointerdown garante resposta imediata no desktop e no mobile
        botao.addEventListener("pointerdown", alternar);
        botao.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
        botao.addEventListener("touchend", (e) => { e.preventDefault(); });

        grupo.appendChild(botao);
    });
}
document.addEventListener("DOMContentLoaded", ativarBotoesDeSenha);
setTimeout(ativarBotoesDeSenha, 1500);
try {
    new MutationObserver(() => ativarBotoesDeSenha()).observe(document.documentElement, { childList: true, subtree: true });
} catch (e) {}

// ==========================================
// MOBILE: RECOLHER MENUS APÓS ESCOLHER UMA OPÇÃO
// ==========================================
document.addEventListener("click", (e) => {
    if (window.innerWidth > 768) return;

    // Menu lateral retrátil: fecha ao escolher uma subcategoria/mídia
    const sidebar = document.getElementById("sidebar");
    if (sidebar && sidebar.classList.contains("open") && e.target.closest("#sidebar")) {
        const itemAcao = e.target.closest("#sidebar-tree li");
        const ehPastaCategoria = !!e.target.closest(".category-toggle");
        const ehBusca = !!e.target.closest(".sidebar-search");
        if (itemAcao && !ehPastaCategoria && !ehBusca && !itemAcao.querySelector("ul.tree-sub")) {
            sidebar.classList.remove("open");
        }
    }

    // Menu de opções (engrenagem) fecha após clicar em qualquer item
    if (e.target.closest(".dropdown-item-btn")) {
        document.getElementById("dropdown-menu-mobile")?.classList.add("hidden");
    }

    // Menu extra do player fecha após escolher uma ação
    if (e.target.closest(".player-controls-group .btn-player-action")) {
        document.querySelector("#player-container .player-controls-group")?.classList.remove("menu-open");
    }
}, true);

// ==========================================
// MOBILE: FECHAR O MENU LATERAL AO CLICAR FORA
// ==========================================
(function () {
    function obterBackdrop() {
        let bd = document.getElementById("sidebar-backdrop");
        if (!bd) {
            bd = document.createElement("div");
            bd.id = "sidebar-backdrop";
            bd.className = "sidebar-backdrop";
            document.body.appendChild(bd);
            bd.addEventListener("click", fecharSidebarMobile);
        }
        return bd;
    }

    function fecharSidebarMobile() {
        document.getElementById("sidebar")?.classList.remove("open");
        atualizarBackdrop();
    }

    function atualizarBackdrop() {
        const sidebar = document.getElementById("sidebar");
        const aberto = !!sidebar && sidebar.classList.contains("open") && window.innerWidth <= 768;
        obterBackdrop().classList.toggle("visible", aberto);
    }

    // Clique/toque fora do menu lateral fecha o menu
    document.addEventListener("pointerdown", (e) => {
        if (window.innerWidth > 768) return;
        const sidebar = document.getElementById("sidebar");
        if (!sidebar || !sidebar.classList.contains("open")) return;
        if (e.target.closest("#sidebar")) return;
        // Não fecha ao usar os próprios botões que abrem/fecham o menu
        if (e.target.closest("#toggle-sidebar, #btn-toggle-sidebar-mobile, #btn-sidebar-mobile-header")) return;
        fecharSidebarMobile();
    }, true);

    // Mantém o fundo escuro sincronizado com o estado do menu
    document.addEventListener("click", () => setTimeout(atualizarBackdrop, 0), true);
    window.addEventListener("resize", atualizarBackdrop);
    document.addEventListener("DOMContentLoaded", () => {
        atualizarBackdrop();
        const sidebar = document.getElementById("sidebar");
        if (sidebar) {
            try {
                new MutationObserver(atualizarBackdrop).observe(sidebar, { attributes: true, attributeFilter: ["class"] });
            } catch (e) {}
        }
    });

    // Tecla ESC também fecha
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharSidebarMobile(); });

    window.fecharSidebarMobile = fecharSidebarMobile;
})();

// ==========================================
// PICTURE-IN-PICTURE UNIVERSAL + REPRODUÇÃO
// COM A TELA DESLIGADA (SEGUNDO PLANO)
// Versão corrigida e definitiva
// ==========================================
(function () {
    "use strict";

    const CHAVE_BG = "streamhub_bg_play";
    let bgAtivo = false;
    try { bgAtivo = localStorage.getItem(CHAVE_BG) === "1"; } catch (e) { bgAtivo = false; }

    // Estado de intenção do usuário: só retomamos automaticamente aquilo
    // que estava tocando (nunca "revivemos" algo pausado de propósito).
    let usuarioPausou = false;

    let audioSilencioso = null;
    let urlSilencio = null;
    let audioCtx = null;
    let noAr = false;              // áudio destravado por gesto do usuário
    let timerRetomada = null;

    // Document PiP
    let janelaDocPip = null;
    let ancoraPip = null;
    let modoDocPip = null;         // "mover" | "youtube"
    let iframeYtPip = null;
    let tempoYtPip = 0;
    let ouvinteMensagemPip = null;
    let timerSondaPip = null;

    // Canvas PiP (fallback)
    let videoCanvasPip = null;
    let canvasPip = null;
    let timerCanvas = null;
    let capaCarregada = null;

    function avisar(msg) {
        try {
            if (typeof castAvisar === "function") { castAvisar(msg); return; }
            if (typeof mostrarToast === "function") { mostrarToast(String(msg).replace(/<[^>]+>/g, "")); return; }
        } catch (e) {}
        try { console.log(String(msg).replace(/<[^>]+>/g, "")); } catch (e) {}
    }

    function elPlayerContent() { return document.querySelector("#player-container .player-content"); }

    function elVideoBruto() {
        const v = document.getElementById("raw-player");
        if (!v) return null;
        const visivel = !v.classList.contains("hidden");
        const temFonte = !!(v.currentSrc || v.src);
        return visivel && temFonte ? v : null;
    }

    function ytDisponivel() {
        try {
            const el = document.getElementById("yt-player");
            const visivel = !!el && !el.classList.contains("hidden");
            return visivel && typeof ytPlayer !== "undefined" && !!ytPlayer && typeof ytPlayer.playVideo === "function";
        } catch (e) { return false; }
    }

    function iframeUniversal() {
        const f = document.getElementById("universal-player");
        if (!f) return null;
        return (!f.classList.contains("hidden") && f.src) ? f : null;
    }

    function faixaAtual() {
        try {
            if (typeof currentPlaylist !== "undefined" && currentPlaylist && typeof currentTrackIndex !== "undefined") {
                return currentPlaylist[currentTrackIndex] || null;
            }
        } catch (e) {}
        return null;
    }

    function tituloAtual() {
        const f = faixaAtual();
        return (f && (f["título"] || f.titulo)) ||
            document.getElementById("current-track-title")?.innerText ||
            "StreamHub";
    }

    function capaAtual() {
        const f = faixaAtual();
        return (f && f.capa) || "";
    }

    function idYoutubeAtual() {
        try {
            if (!ytDisponivel()) return null;
            // 1) direto do próprio player (mais confiável)
            if (typeof ytPlayer.getVideoData === "function") {
                const d = ytPlayer.getVideoData();
                if (d && d.video_id) return d.video_id;
            }
            const f = faixaAtual();
            if (f && f.link && typeof extractYoutubeId === "function") return extractYoutubeId(String(f.link).trim());
        } catch (e) {}
        return null;
    }

    // =====================================================
    // ÁUDIO DE SUSTENTAÇÃO (mantém a aba "audível" e viva)
    // Correção: o WAV anterior era 100% mudo e com volume
    // 0.001 — o navegador tratava a aba como silenciosa e
    // suspendia tudo ao apagar a tela. Agora usamos ruído
    // de 1 LSB (inaudível ao ouvido, audível ao navegador)
    // com volume real, + AudioContext para não ser suspenso.
    // =====================================================
    function criarUrlSilencio() {
        if (urlSilencio) return urlSilencio;
        try {
            const taxa = 44100, segundos = 5, amostras = taxa * segundos;
            const buffer = new ArrayBuffer(44 + amostras * 2);
            const view = new DataView(buffer);
            const escrever = (pos, txt) => { for (let i = 0; i < txt.length; i++) view.setUint8(pos + i, txt.charCodeAt(i)); };
            escrever(0, "RIFF"); view.setUint32(4, 36 + amostras * 2, true); escrever(8, "WAVE");
            escrever(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
            view.setUint32(24, taxa, true); view.setUint32(28, taxa * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
            escrever(36, "data"); view.setUint32(40, amostras * 2, true);
            for (let i = 0; i < amostras; i++) {
                // ruído de amplitude 1 (≈ -90 dBFS): inaudível, porém não é silêncio digital
                view.setInt16(44 + i * 2, (i % 2 === 0 ? 1 : -1), true);
            }
            urlSilencio = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
        } catch (e) { urlSilencio = null; }
        return urlSilencio;
    }

    function ligarAudioSilencioso() {
        try {
            if (!audioSilencioso) {
                const url = criarUrlSilencio();
                if (!url) return;
                audioSilencioso = document.createElement("audio");
                audioSilencioso.id = "streamhub-silencio";
                audioSilencioso.src = url;
                audioSilencioso.loop = true;
                audioSilencioso.volume = 1;
                audioSilencioso.preload = "auto";
                audioSilencioso.setAttribute("playsinline", "");
                audioSilencioso.setAttribute("webkit-playsinline", "");
                audioSilencioso.style.display = "none";
                document.body.appendChild(audioSilencioso);
                // se o navegador encerrar o loop por qualquer motivo, reiniciamos
                audioSilencioso.addEventListener("ended", () => { if (bgAtivo) { try { audioSilencioso.currentTime = 0; audioSilencioso.play().catch(() => {}); } catch (e) {} } });
                audioSilencioso.addEventListener("pause", () => { if (bgAtivo) setTimeout(() => { try { audioSilencioso.play().catch(() => {}); } catch (e) {} }, 300); });
            }
            if (audioSilencioso.paused) {
                const p = audioSilencioso.play();
                if (p && p.catch) p.catch(() => {});
            }
            manterAudioContext();
        } catch (e) {}
    }

    function desligarAudioSilencioso() {
        try { if (audioSilencioso) { audioSilencioso.pause(); } } catch (e) {}
        try { if (audioCtx && audioCtx.state === "running") audioCtx.suspend(); } catch (e) {}
    }

    // AudioContext com ganho ~0: impede que o navegador congele o
    // pipeline de áudio da aba quando a tela apaga.
    function manterAudioContext() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!audioCtx) {
                audioCtx = new AC();
                const osc = audioCtx.createOscillator();
                const ganho = audioCtx.createGain();
                ganho.gain.value = 0.0001;
                osc.frequency.value = 30;
                osc.connect(ganho);
                ganho.connect(audioCtx.destination);
                osc.start();
            }
            if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
        } catch (e) {}
    }

    // Destrava a reprodução automática no primeiro gesto do usuário,
    // para que o modo segundo plano funcione mesmo sendo reativado
    // automaticamente numa próxima sessão.
    function destravarAudio() {
        if (noAr) return;
        noAr = true;
        try {
            manterAudioContext();
            if (bgAtivo) ligarAudioSilencioso();
        } catch (e) {}
    }
    ["pointerdown", "touchstart", "keydown", "click"].forEach((ev) => {
        document.addEventListener(ev, destravarAudio, { once: false, passive: true });
    });

    // ---------- MEDIA SESSION ----------
    function atualizarMediaSession() {
        if (!("mediaSession" in navigator)) return;
        try {
            const capa = capaAtual();
            navigator.mediaSession.metadata = new MediaMetadata({
                title: tituloAtual(),
                artist: "StreamHub",
                album: "StreamHub by Di Workin'",
                artwork: capa
                    ? [
                        { src: capa, sizes: "256x256", type: "image/jpeg" },
                        { src: capa, sizes: "512x512", type: "image/jpeg" }
                    ]
                    : []
            });
            const set = (acao, fn) => { try { navigator.mediaSession.setActionHandler(acao, fn); } catch (e) {} };
            set("play", () => { usuarioPausou = false; tocar(); });
            set("pause", () => { usuarioPausou = true; pausar(); });
            set("previoustrack", () => { try { document.getElementById("btn-prev-track")?.click(); } catch (e) {} });
            set("nexttrack", () => { try { document.getElementById("btn-next-track")?.click(); } catch (e) {} });
            set("stop", () => { usuarioPausou = true; pausar(); });
            // não anunciamos posição (fontes em iframe não expõem tempo confiável)
            try { navigator.mediaSession.setPositionState && navigator.mediaSession.setPositionState(); } catch (e) {}
            navigator.mediaSession.playbackState = usuarioPausou ? "paused" : "playing";
        } catch (e) {}
    }

    function tocar() {
        const v = elVideoBruto();
        if (v) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
        if (ytDisponivel()) { try { ytPlayer.playVideo(); } catch (e) {} }
        if (bgAtivo) ligarAudioSilencioso();
        if ("mediaSession" in navigator) { try { navigator.mediaSession.playbackState = "playing"; } catch (e) {} }
        refletirEstadoBotoes();
    }

    function pausar() {
        const v = elVideoBruto();
        if (v) { try { v.pause(); } catch (e) {} }
        if (ytDisponivel()) { try { ytPlayer.pauseVideo(); } catch (e) {} }
        if ("mediaSession" in navigator) { try { navigator.mediaSession.playbackState = "paused"; } catch (e) {} }
    }

    // ---------- MODO SEGUNDO PLANO ----------
    function pararVigilancia() { if (timerRetomada) { clearInterval(timerRetomada); timerRetomada = null; } }

    function iniciarVigilancia() {
        pararVigilancia();
        timerRetomada = setInterval(() => {
            if (!bgAtivo) return;
            ligarAudioSilencioso();
            if (usuarioPausou) return;          // respeita a pausa do usuário
            if (!document.hidden) return;
            if (pipAtivo()) return;             // no PiP a mídia já continua visível
            const v = elVideoBruto();
            if (v && v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
            if (ytDisponivel()) {
                try {
                    const estado = ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : -1;
                    if (estado === 2 || estado === -1) ytPlayer.playVideo();
                } catch (e) {}
            }
        }, 1000);
    }

    function pipAtivo() {
        return !!document.pictureInPictureElement ||
            !!(janelaDocPip && !janelaDocPip.closed) ||
            !!(window.documentPictureInPicture && window.documentPictureInPicture.window);
    }

    function refletirEstadoBotoes() {
        const b = document.getElementById("btn-bg-play");
        if (b) {
            b.classList.toggle("active", bgAtivo);
            b.setAttribute("aria-pressed", bgAtivo ? "true" : "false");
            b.title = bgAtivo ? "Segundo plano ativo (toca com a tela desligada)" : "Reproduzir com a tela desligada";
        }
        const p = document.getElementById("btn-pip");
        if (p) {
            p.classList.toggle("active", pipAtivo());
            p.setAttribute("aria-pressed", pipAtivo() ? "true" : "false");
            p.title = pipAtivo() ? "Fechar janela flutuante (PiP)" : "Picture-in-Picture (janela flutuante)";
        }
    }

    function definirSegundoPlano(ativo, avisando) {
        bgAtivo = !!ativo;
        try { localStorage.setItem(CHAVE_BG, bgAtivo ? "1" : "0"); } catch (e) {}
        if (bgAtivo) {
            usuarioPausou = false;
            manterAudioContext();
            ligarAudioSilencioso();
            atualizarMediaSession();
            iniciarVigilancia();
            if (avisando) avisar("<b>Segundo plano ativado</b><br>A mídia continua tocando com a tela desligada.");
        } else {
            desligarAudioSilencioso();
            pararVigilancia();
            if (avisando) avisar("<b>Segundo plano desativado</b>");
        }
        refletirEstadoBotoes();
    }

    document.addEventListener("visibilitychange", () => {
        if (!bgAtivo) return;
        if (document.hidden) {
            ligarAudioSilencioso();
            manterAudioContext();
            if (!usuarioPausou && !pipAtivo()) tocar();
        } else {
            manterAudioContext();
            // ao voltar, NÃO forçamos play: apenas ressincronizamos o estado
            if (!usuarioPausou && !pipAtivo()) setTimeout(() => tocar(), 250);
            refletirEstadoBotoes();
        }
    });

    // ---------- PICTURE-IN-PICTURE ----------
    function limparPontesYtPip() {
        if (timerSondaPip) { clearInterval(timerSondaPip); timerSondaPip = null; }
        if (ouvinteMensagemPip) {
            try { window.removeEventListener("message", ouvinteMensagemPip); } catch (e) {}
            try { janelaDocPip && janelaDocPip.removeEventListener("message", ouvinteMensagemPip); } catch (e) {}
            ouvinteMensagemPip = null;
        }
        iframeYtPip = null;
    }

    function devolverConteudoDoPip() {
        try {
            if (modoDocPip === "youtube") {
                // devolve o vídeo ao player principal no tempo em que parou
                limparPontesYtPip();
                if (ancoraPip && ancoraPip.parentNode) ancoraPip.parentNode.removeChild(ancoraPip);
                ancoraPip = null;
                const conteudo = elPlayerContent();
                if (conteudo) conteudo.classList.remove("pip-oculto");
                if (ytDisponivel()) {
                    try {
                        if (tempoYtPip > 0) ytPlayer.seekTo(tempoYtPip, true);
                        if (!usuarioPausou) ytPlayer.playVideo();
                    } catch (e) {}
                }
            } else {
                const conteudo = janelaDocPip && janelaDocPip.document
                    ? janelaDocPip.document.querySelector(".player-content")
                    : null;
                if (conteudo && ancoraPip && ancoraPip.parentNode) {
                    ancoraPip.parentNode.replaceChild(conteudo, ancoraPip);
                } else if (ancoraPip && ancoraPip.parentNode) {
                    ancoraPip.parentNode.removeChild(ancoraPip);
                }
                ancoraPip = null;
            }
        } catch (e) {}
        modoDocPip = null;
        janelaDocPip = null;
        refletirEstadoBotoes();
    }

    function pararCanvasPip() {
        if (timerCanvas) { clearInterval(timerCanvas); timerCanvas = null; }
        try {
            if (videoCanvasPip) {
                videoCanvasPip.pause();
                if (videoCanvasPip.srcObject) {
                    videoCanvasPip.srcObject.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
                }
                videoCanvasPip.remove();
            }
        } catch (e) {}
        videoCanvasPip = null;
        canvasPip = null;
    }

    async function fecharPip() {
        try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); } catch (e) {}
        try {
            const v = document.getElementById("raw-player");
            if (v && typeof v.webkitSetPresentationMode === "function" && v.webkitPresentationMode === "picture-in-picture") {
                v.webkitSetPresentationMode("inline");
            }
        } catch (e) {}
        try { if (janelaDocPip && !janelaDocPip.closed) janelaDocPip.close(); } catch (e) {}
        devolverConteudoDoPip();
        pararCanvasPip();
        refletirEstadoBotoes();
    }

    function estilosBaseParaPip(win) {
        try {
            document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
                const novo = win.document.createElement("link");
                novo.rel = "stylesheet"; novo.href = l.href;
                win.document.head.appendChild(novo);
            });
            const base = win.document.createElement("style");
            base.textContent =
                "html,body{margin:0;padding:0;background:#000;overflow:hidden;height:100%;width:100%}" +
                ".player-content{display:block!important;width:100%!important;height:100%!important;max-height:none!important;position:absolute;inset:0}" +
                ".player-content iframe,.player-content video,.player-content>div{width:100%!important;height:100%!important;border:0;display:block}" +
                "#pip-frame{position:absolute;inset:0;width:100%;height:100%;border:0}" +
                ".hidden{display:none!important}";
            win.document.head.appendChild(base);
            win.document.body.className = document.body.className;
        } catch (e) {}
    }

    // --- Document PiP dedicado ao YouTube ---
    // Correção: mover o <iframe> do YouTube entre documentos o recarrega e
    // quebra a API. Aqui criamos um player novo na janela flutuante já no
    // tempo atual, pausamos o principal e, ao fechar, devolvemos o tempo.
    async function abrirDocumentPipYoutube() {
        const id = idYoutubeAtual();
        if (!id || !("documentPictureInPicture" in window)) return false;

        let inicio = 0;
        try { inicio = Math.max(0, Math.floor(ytPlayer.getCurrentTime() || 0)); } catch (e) { inicio = 0; }
        tempoYtPip = inicio;

        const conteudo = elPlayerContent();
        try {
            const largura = Math.max(400, Math.round((conteudo && conteudo.offsetWidth) || 480));
            const altura = Math.max(225, Math.round((conteudo && conteudo.offsetHeight) || 270));
            const win = await window.documentPictureInPicture.requestWindow({ width: largura, height: altura });
            janelaDocPip = win;
            modoDocPip = "youtube";
            estilosBaseParaPip(win);

            const origem = encodeURIComponent(window.location.origin);
            const frame = win.document.createElement("iframe");
            frame.id = "pip-frame";
            frame.allow = "autoplay; encrypted-media; picture-in-picture";
            frame.setAttribute("allowfullscreen", "");
            frame.src = "https://www.youtube.com/embed/" + id +
                "?autoplay=1&playsinline=1&enablejsapi=1&rel=0&start=" + inicio + "&origin=" + origem;
            win.document.body.appendChild(frame);
            iframeYtPip = frame;

            // pausa o player principal para não tocar duas vezes
            try { ytPlayer.pauseVideo(); } catch (e) {}

            // aviso no lugar do player principal
            ancoraPip = document.createElement("div");
            ancoraPip.className = "player-content pip-placeholder";
            ancoraPip.innerHTML = '<div class="pip-aviso">Reproduzindo na janela flutuante (PiP)</div>';
            if (conteudo && conteudo.parentNode) {
                conteudo.parentNode.insertBefore(ancoraPip, conteudo);
                conteudo.classList.add("pip-oculto");
            }

            // ponte de tempo: handshake com a API do iframe do YouTube
            tempoYtPip = inicio;
            ouvinteMensagemPip = (ev) => {
                try {
                    if (!ev.data || typeof ev.data !== "string") return;
                    const dados = JSON.parse(ev.data);
                    const info = dados && dados.info;
                    if (info && typeof info.currentTime === "number") tempoYtPip = info.currentTime;
                } catch (e) {}
            };
            try { win.addEventListener("message", ouvinteMensagemPip); } catch (e) {}
            const enviar = (func, args) => {
                try {
                    frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: func, args: args || [] }), "*");
                } catch (e) {}
            };
            frame.addEventListener("load", () => {
                try { frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "pip-frame" }), "*"); } catch (e) {}
                enviar("playVideo");
            });
            timerSondaPip = setInterval(() => {
                try { frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "pip-frame" }), "*"); } catch (e) {}
            }, 1000);

            win.addEventListener("pagehide", devolverConteudoDoPip, { once: true });
            win.addEventListener("unload", devolverConteudoDoPip, { once: true });
            refletirEstadoBotoes();
            return true;
        } catch (e) {
            janelaDocPip = null;
            modoDocPip = null;
            return false;
        }
    }

    // --- Document PiP genérico (Drive, Archive, outros iframes) ---
    async function abrirDocumentPipMovendo() {
        const conteudo = elPlayerContent();
        if (!conteudo || !("documentPictureInPicture" in window)) return false;
        try {
            const largura = Math.max(400, Math.round(conteudo.offsetWidth || 480));
            const altura = Math.max(225, Math.round(conteudo.offsetHeight || 270));
            const win = await window.documentPictureInPicture.requestWindow({ width: largura, height: altura });
            janelaDocPip = win;
            modoDocPip = "mover";
            estilosBaseParaPip(win);

            ancoraPip = document.createElement("div");
            ancoraPip.className = "player-content pip-placeholder";
            ancoraPip.innerHTML = '<div class="pip-aviso">Reproduzindo na janela flutuante (PiP)</div>';
            conteudo.parentNode.insertBefore(ancoraPip, conteudo);
            win.document.body.appendChild(conteudo);

            win.addEventListener("pagehide", devolverConteudoDoPip, { once: true });
            win.addEventListener("unload", devolverConteudoDoPip, { once: true });
            refletirEstadoBotoes();
            return true;
        } catch (e) {
            janelaDocPip = null;
            modoDocPip = null;
            return false;
        }
    }

    // ---------- Fallback universal: miniatura em canvas ----------
    function desenharCanvas() {
        if (!canvasPip) return;
        const ctx = canvasPip.getContext("2d");
        if (!ctx) return;
        const L = canvasPip.width, A = canvasPip.height;
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, L, A);
        if (capaCarregada && capaCarregada.complete && capaCarregada.naturalWidth) {
            const escala = Math.max(L / capaCarregada.naturalWidth, A / capaCarregada.naturalHeight);
            const cl = capaCarregada.naturalWidth * escala, ca = capaCarregada.naturalHeight * escala;
            try { ctx.drawImage(capaCarregada, (L - cl) / 2, (A - ca) / 2, cl, ca); } catch (e) {}
            ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, L, A);
        }
        ctx.fillStyle = "#fff";
        ctx.font = "bold 26px Arial, sans-serif";
        ctx.textAlign = "center";
        const texto = String(tituloAtual()).slice(0, 40);
        ctx.fillText(texto, L / 2, A / 2);
        ctx.font = "16px Arial, sans-serif";
        ctx.fillStyle = "#bbb";
        ctx.fillText(usuarioPausou ? "StreamHub • pausado" : "StreamHub • tocando", L / 2, A / 2 + 32);
    }

    function esperarEvento(el, evento, ms) {
        return new Promise((resolve) => {
            let pronto = false;
            const fim = () => { if (!pronto) { pronto = true; resolve(); } };
            el.addEventListener(evento, fim, { once: true });
            setTimeout(fim, ms || 3000);
        });
    }

    async function abrirCanvasPip() {
        try {
            if (!document.pictureInPictureEnabled) return false;
            pararCanvasPip();
            canvasPip = document.createElement("canvas");
            canvasPip.width = 640; canvasPip.height = 360;
            const capa = capaAtual();
            capaCarregada = null;
            if (capa) {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => { capaCarregada = img; desenharCanvas(); };
                img.onerror = () => { capaCarregada = null; };
                img.src = capa;
            }
            desenharCanvas();
            // Correção: 5 fps + PiP imediato falhava ("metadata not loaded").
            // Agora capturamos a 15 fps, desenhamos antes e esperamos os metadados.
            const stream = canvasPip.captureStream(15);
            videoCanvasPip = document.createElement("video");
            videoCanvasPip.muted = true;
            videoCanvasPip.autoplay = true;
            videoCanvasPip.playsInline = true;
            videoCanvasPip.setAttribute("playsinline", "");
            videoCanvasPip.className = "pip-canvas-oculto";
            videoCanvasPip.srcObject = stream;
            document.body.appendChild(videoCanvasPip);
            timerCanvas = setInterval(desenharCanvas, 500);
            if (videoCanvasPip.readyState < 1) await esperarEvento(videoCanvasPip, "loadedmetadata", 3000);
            try { await videoCanvasPip.play(); } catch (e) {}
            if (videoCanvasPip.readyState < 2) await esperarEvento(videoCanvasPip, "loadeddata", 2000);
            await videoCanvasPip.requestPictureInPicture();
            videoCanvasPip.addEventListener("leavepictureinpicture", () => { pararCanvasPip(); refletirEstadoBotoes(); }, { once: true });
            refletirEstadoBotoes();
            return true;
        } catch (e) {
            pararCanvasPip();
            return false;
        }
    }

    async function alternarPip() {
        if (pipAtivo()) { await fecharPip(); return; }

        // 1) Vídeo direto (mp4/webm/mkv): PiP nativo do navegador
        const v = elVideoBruto();
        if (v) {
            // iOS/Safari usam a API webkit de "presentation mode"
            try {
                if (typeof v.webkitSupportsPresentationMode === "function" &&
                    v.webkitSupportsPresentationMode("picture-in-picture")) {
                    if (v.readyState === 0) { try { v.load(); } catch (e) {} }
                    if (v.readyState < 1) await esperarEvento(v, "loadedmetadata", 3000);
                    v.webkitSetPresentationMode("picture-in-picture");
                    refletirEstadoBotoes();
                    return;
                }
            } catch (e) {}
            if (document.pictureInPictureEnabled && !v.disablePictureInPicture) {
                try {
                    if (v.readyState === 0) { try { v.load(); } catch (e) {} }
                    // Correção: era preciso aguardar os metadados antes do pedido
                    if (v.readyState < 1) await esperarEvento(v, "loadedmetadata", 3000);
                    await v.requestPictureInPicture();
                    v.addEventListener("leavepictureinpicture", refletirEstadoBotoes, { once: true });
                    refletirEstadoBotoes();
                    return;
                } catch (e) {}
            }
        }

        // 2) YouTube: janela flutuante com player próprio (sem recarregar do zero)
        if (ytDisponivel() && await abrirDocumentPipYoutube()) return;

        // 3) Demais iframes (Drive, Archive...): Document PiP movendo o conteúdo
        if (iframeUniversal() && await abrirDocumentPipMovendo()) return;

        // 4) Último recurso: miniatura flutuante (mantém o áudio tocando na aba)
        if (await abrirCanvasPip()) {
            avisar("<b>Janela flutuante ativa</b><br>O vídeo continua tocando no app e o áudio segue em segundo plano.");
            return;
        }

        avisar("<b>Picture-in-Picture indisponível</b><br>Este navegador não permite janela flutuante nesta mídia.");
    }

    // Sincroniza o botão quando o PiP é aberto/fechado por fora do app
    document.addEventListener("enterpictureinpicture", refletirEstadoBotoes, true);
    document.addEventListener("leavepictureinpicture", () => { setTimeout(refletirEstadoBotoes, 50); }, true);
    try {
        if (window.documentPictureInPicture && window.documentPictureInPicture.addEventListener) {
            window.documentPictureInPicture.addEventListener("enter", () => { refletirEstadoBotoes(); });
        }
    } catch (e) {}

    // ---------- BOTÕES ----------
    function criarBotao(id, titulo, icone, alvo, grupo) {
        let b = document.getElementById(id);
        if (!b) {
            b = document.createElement("button");
            b.id = id; b.type = "button"; b.className = "btn-player-action";
            b.innerHTML = '<i class="' + icone + '"></i>';
            if (alvo) alvo.insertAdjacentElement("beforebegin", b); else grupo.appendChild(b);
        }
        b.title = titulo;
        b.setAttribute("aria-label", titulo);
        if (!b.dataset.ligado) {
            b.dataset.ligado = "1";
            b.addEventListener("click", (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                destravarAudio();
                if (id === "btn-pip") alternarPip();
                else definirSegundoPlano(!bgAtivo, true);
            });
        }
        return b;
    }

    function garantirBotoesPipEBg() {
        const grupo = document.querySelector("#player-container .player-controls-group");
        if (!grupo) return;
        const alvo = document.getElementById("btn-cast");
        criarBotao("btn-pip", "Picture-in-Picture (janela flutuante)", "fas fa-clone", alvo, grupo);
        criarBotao("btn-bg-play", "Reproduzir com a tela desligada", "fas fa-mobile-screen-button", alvo, grupo);
        refletirEstadoBotoes();
    }

    // Fecha o PiP ao fechar o player
    document.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest("#btn-close-player")) {
            usuarioPausou = true;
            fecharPip();
            desligarAudioSilencioso();
        }
    });

    // Ao trocar de mídia, o PiP do YouTube precisa acompanhar
    function aoTrocarFaixa() {
        usuarioPausou = false;
        tempoYtPip = 0;
        atualizarMediaSession();
        desenharCanvas();
        if (bgAtivo) ligarAudioSilencioso();
        if (modoDocPip === "youtube" && janelaDocPip && !janelaDocPip.closed) {
            const id = idYoutubeAtual();
            if (id && iframeYtPip) {
                try {
                    iframeYtPip.src = "https://www.youtube.com/embed/" + id +
                        "?autoplay=1&playsinline=1&enablejsapi=1&rel=0&origin=" + encodeURIComponent(window.location.origin);
                    try { ytPlayer.pauseVideo(); } catch (e) {}
                } catch (e) {}
            }
        }
        refletirEstadoBotoes();
    }

    function ligarEstadoYoutube() {
        try {
            if (typeof ytPlayer === "undefined" || !ytPlayer || typeof ytPlayer.addEventListener !== "function") return;
            if (ytPlayer.__shPipLigado) return;
            ytPlayer.__shPipLigado = true;
            ytPlayer.addEventListener("onStateChange", (e) => {
                if (!e) return;
                if (e.data === 1) { usuarioPausou = false; if (bgAtivo) ligarAudioSilencioso(); }
                if (e.data === 2 && !document.hidden) usuarioPausou = true;
                if ("mediaSession" in navigator) {
                    try { navigator.mediaSession.playbackState = usuarioPausou ? "paused" : "playing"; } catch (err) {}
                }
            });
        } catch (e) {}
    }

    function iniciar() {
        garantirBotoesPipEBg();
        atualizarMediaSession();
        if (bgAtivo) definirSegundoPlano(true, false);

        const titulo = document.getElementById("current-track-title");
        if (titulo) {
            try {
                new MutationObserver(aoTrocarFaixa)
                    .observe(titulo, { childList: true, characterData: true, subtree: true });
            } catch (e) {}
        }

        const v = document.getElementById("raw-player");
        if (v) {
            v.setAttribute("playsinline", "");
            v.setAttribute("webkit-playsinline", "");
            v.addEventListener("play", () => { usuarioPausou = false; atualizarMediaSession(); if (bgAtivo) ligarAudioSilencioso(); });
            v.addEventListener("pause", () => {
                if (bgAtivo && document.hidden && !usuarioPausou) {
                    const p = v.play(); if (p && p.catch) p.catch(() => {});
                } else if (!document.hidden) {
                    usuarioPausou = true;
                    if ("mediaSession" in navigator) { try { navigator.mediaSession.playbackState = "paused"; } catch (e) {} }
                }
            });
            v.addEventListener("enterpictureinpicture", refletirEstadoBotoes);
            v.addEventListener("leavepictureinpicture", () => setTimeout(refletirEstadoBotoes, 50));
        }

        ligarEstadoYoutube();
        setInterval(ligarEstadoYoutube, 2000);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
    setTimeout(garantirBotoesPipEBg, 1500);
    setTimeout(garantirBotoesPipEBg, 4000);
    window.addEventListener("pagehide", () => { desligarAudioSilencioso(); });

    // Expõe para uso externo, sem alterar nada mais do app
    window.streamhubPip = { alternar: alternarPip, fechar: fecharPip, segundoPlano: definirSegundoPlano };
})();


// ==========================================
// FAVORITOS: MENU COMPLETO (MIDIAS, CATEGORIAS, SUBCATEGORIAS, PASTAS E NOTAS)
// ==========================================
let favoritos = { midias: [], categorias: [], subcategorias: [], pastas: [] };
let favUI = { aba: 'midias', busca: '', ordem: 'recentes', pasta: '__todas', filtroNota: 0, selecionados: new Set() };

function carregarFavoritosDoPerfil(dados) {
    const agora = Date.now();
    const arr = (v) => Array.isArray(v) ? v : [];
    favoritos = {
        midias: arr(dados && dados.midias).map((m, i) => Object.assign({ nota: 0, pasta: '', adicionadoEm: agora - i }, m)),
        categorias: arr(dados && dados.categorias).map((c, i) => Object.assign({ nota: 0, adicionadoEm: agora - i }, c)),
        subcategorias: arr(dados && dados.subcategorias).map((c, i) => Object.assign({ nota: 0, adicionadoEm: agora - i }, c)),
        pastas: arr(dados && dados.pastas)
    };
    atualizarBotaoFavoritoDoPlayer();
}

function salvarFavoritos() {
    try { salvarPreferenciaNoFirebase({ favoritos: favoritos }); } catch (e) {}
}

function chaveFavorito(info) {
    if (!info) return "";
    if (info.tipo === 'categoria') return `cat::${info.categoria || ''}`;
    if (info.tipo === 'subcategoria') return `sub::${info.categoria || ''}::${info.subcategoria || ''}`;
    const t = info.track || {};
    return `mid::${(t.link || '').trim()}`;
}

function ehFavorito(info) {
    if (!info) return false;
    const chave = chaveFavorito(info);
    if (info.tipo === 'categoria') return favoritos.categorias.some(c => `cat::${c.categoria}` === chave);
    if (info.tipo === 'subcategoria') return favoritos.subcategorias.some(c => `sub::${c.categoria}::${c.subcategoria}` === chave);
    return favoritos.midias.some(m => `mid::${(m.link || '').trim()}` === chave);
}

function alternarFavorito(info) {
    if (!info) return;
    const jaEra = ehFavorito(info);
    const agora = Date.now();
    if (info.tipo === 'categoria') {
        favoritos.categorias = jaEra
            ? favoritos.categorias.filter(c => c.categoria !== info.categoria)
            : favoritos.categorias.concat([{ categoria: info.categoria, capa: capaDaCategoria(info.categoria), nota: 0, adicionadoEm: agora }]);
    } else if (info.tipo === 'subcategoria') {
        favoritos.subcategorias = jaEra
            ? favoritos.subcategorias.filter(c => !(c.categoria === info.categoria && c.subcategoria === info.subcategoria))
            : favoritos.subcategorias.concat([{ categoria: info.categoria, subcategoria: info.subcategoria, capa: capaDaSubcategoria(info.categoria, info.subcategoria), nota: 0, adicionadoEm: agora }]);
    } else {
        const t = info.track || {};
        const link = (t.link || '').trim();
        if (!link) return;
        favoritos.midias = jaEra
            ? favoritos.midias.filter(m => (m.link || '').trim() !== link)
            : favoritos.midias.concat([{ título: t.título || t.titulo || 'Mídia', link: link, capa: t.capa || '', categoria: t.categoria || '', subcategoria: t.subcategoria || '', nota: 0, pasta: '', adicionadoEm: agora }]);
    }
    salvarFavoritos();
    atualizarBotaoFavoritoDoPlayer();
    try { renderMosaic(); } catch (e) {}
    if (!document.getElementById('favorites-modal')?.classList.contains('hidden')) renderizarFavoritos();
}

function capaDaCategoria(cat) {
    const m = database.find(i => i.categoria === cat);
    if (m) return m.capa || '';
    try {
        const nodeName = btoa(unescape(encodeURIComponent(cat))).replace(/=/g, "");
        return canaisDinamicos[nodeName] ? canaisDinamicos[nodeName].thumb : '';
    } catch (e) { return ''; }
}

function capaDaSubcategoria(cat, sub) {
    const m = database.find(i => i.categoria === cat && i.subcategoria === sub);
    return m ? (m.capa || '') : '';
}

function abrirModalFavoritos() {
    favUI.selecionados = new Set();
    renderizarFavoritos();
    document.getElementById('favorites-modal')?.classList.remove('hidden');
}

function fecharModalFavoritos() {
    document.getElementById('favorites-modal')?.classList.add('hidden');
}

// ---------- Utilidades do menu ----------
function favEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function favIdPasta() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function favNomePasta(id) { const p = favoritos.pastas.find(x => x.id === id); return p ? p.nome : ''; }

async function favCriarPasta(nomeSugerido) {
    const nome = (await uiPrompt('Nome da nova pasta:', nomeSugerido || '') || '').trim();
    if (!nome) return null;
    if (favoritos.pastas.some(p => p.nome.toLowerCase() === nome.toLowerCase())) { uiAlert('Já existe uma pasta com esse nome.'); return null; }
    const cores = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c'];
    const pasta = { id: favIdPasta(), nome, cor: cores[favoritos.pastas.length % cores.length], criadaEm: Date.now() };
    favoritos.pastas.push(pasta);
    salvarFavoritos();
    return pasta;
}
async function favRenomearPasta(id) {
    const p = favoritos.pastas.find(x => x.id === id); if (!p) return;
    const nome = (await uiPrompt('Novo nome da pasta:', p.nome) || '').trim();
    if (!nome) return;
    p.nome = nome; salvarFavoritos(); renderizarFavoritos();
}
async function favExcluirPasta(id) {
    const p = favoritos.pastas.find(x => x.id === id); if (!p) return;
    if (!await uiConfirm(`Excluir a pasta "${p.nome}"? As mídias continuam nos favoritos, apenas saem da pasta.`)) return;
    favoritos.pastas = favoritos.pastas.filter(x => x.id !== id);
    favoritos.midias.forEach(m => { if (m.pasta === id) m.pasta = ''; });
    if (favUI.pasta === id) favUI.pasta = '__todas';
    salvarFavoritos(); renderizarFavoritos();
}
async function favMoverParaPasta(midias, pastaId) {
    if (pastaId === '__nova') { const p = await favCriarPasta(); if (!p) { renderizarFavoritos(); return; } pastaId = p.id; }
    midias.forEach(m => { m.pasta = pastaId || ''; });
    salvarFavoritos(); renderizarFavoritos();
}
function favDefinirNota(item, nota) {
    item.nota = item.nota === nota ? 0 : nota;
    salvarFavoritos(); renderizarFavoritos();
}
function favTocarLista(lista, aleatorio) {
    if (!lista.length) return;
    let fila = lista.slice();
    if (aleatorio) for (let i = fila.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [fila[i], fila[j]] = [fila[j], fila[i]]; }
    currentPlaylist = fila;
    fecharModalFavoritos();
    playTrack(0);
}
function favOrdenar(lista, titulo) {
    const l = lista.slice();
    const tit = (x) => (titulo(x) || '').toLowerCase();
    switch (favUI.ordem) {
        case 'antigos': l.sort((a, b) => (a.adicionadoEm || 0) - (b.adicionadoEm || 0)); break;
        case 'az': l.sort((a, b) => tit(a).localeCompare(tit(b), 'pt-BR')); break;
        case 'za': l.sort((a, b) => tit(b).localeCompare(tit(a), 'pt-BR')); break;
        case 'nota': l.sort((a, b) => (b.nota || 0) - (a.nota || 0) || (b.adicionadoEm || 0) - (a.adicionadoEm || 0)); break;
        default: l.sort((a, b) => (b.adicionadoEm || 0) - (a.adicionadoEm || 0));
    }
    return l;
}
function favFiltrar(lista, campos) {
    const q = favUI.busca.trim().toLowerCase();
    return lista.filter(x => (!q || campos(x).join(' ').toLowerCase().includes(q)) && (x.nota || 0) >= favUI.filtroNota);
}
function favExportar() {
    const blob = new Blob([JSON.stringify(favoritos, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'streamhub-favoritos.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function favImportar() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => {
            try {
                const d = JSON.parse(r.result);
                const links = new Set(favoritos.midias.map(m => (m.link || '').trim()));
                (d.pastas || []).forEach(p => { if (p && p.id && !favoritos.pastas.some(x => x.id === p.id)) favoritos.pastas.push(p); });
                (d.midias || []).forEach(m => { if (m && m.link && !links.has(m.link.trim())) favoritos.midias.push(m); });
                (d.categorias || []).forEach(c => { if (c && !favoritos.categorias.some(x => x.categoria === c.categoria)) favoritos.categorias.push(c); });
                (d.subcategorias || []).forEach(c => { if (c && !favoritos.subcategorias.some(x => x.categoria === c.categoria && x.subcategoria === c.subcategoria)) favoritos.subcategorias.push(c); });
                salvarFavoritos(); renderizarFavoritos(); try { renderMosaic(); } catch (e) {}
                uiAlert('Favoritos importados com sucesso!');
            } catch (e) { uiAlert('Arquivo inválido.'); }
        };
        r.readAsText(f);
    };
    inp.click();
}
async function favLimparTudo() {
    if (!await uiConfirm('Remover TODOS os favoritos e pastas? Essa ação não pode ser desfeita.')) return;
    favoritos = { midias: [], categorias: [], subcategorias: [], pastas: [] };
    salvarFavoritos(); atualizarBotaoFavoritoDoPlayer(); try { renderMosaic(); } catch (e) {} renderizarFavoritos();
}

function favEstrelas(nota) {
    let h = '<div class="fav-estrelas" title="Sua nota">';
    for (let i = 1; i <= 5; i++) h += `<button type="button" class="fav-estrela${i <= (nota || 0) ? ' on' : ''}" data-nota="${i}" aria-label="Nota ${i}"><i class="${i <= (nota || 0) ? 'fas' : 'far'} fa-star"></i></button>`;
    return h + '</div>';
}
function favOpcoesPasta(atual) {
    return `<option value="">Sem pasta</option>` +
        favoritos.pastas.map(p => `<option value="${favEsc(p.id)}"${p.id === atual ? ' selected' : ''}>${favEsc(p.nome)}</option>`).join('') +
        `<option value="__nova">+ Nova pasta...</option>`;
}

// ---------- Render principal ----------
function renderizarFavoritos() {
    const corpo = document.getElementById('favorites-body');
    if (!corpo) return;
    const nMid = favoritos.midias.length, nCat = favoritos.categorias.length, nSub = favoritos.subcategorias.length, nPas = favoritos.pastas.length;

    const abas = [
        ['midias', 'fa-play-circle', 'Mídias', nMid],
        ['pastas', 'fa-folder', 'Pastas', nPas],
        ['categorias', 'fa-th-large', 'Categorias', nCat],
        ['subcategorias', 'fa-layer-group', 'Subcategorias', nSub]
    ];

    corpo.innerHTML = `
        <div class="fav-menu-abas">${abas.map(a => `<button type="button" class="fav-aba${favUI.aba === a[0] ? ' ativa' : ''}" data-aba="${a[0]}"><i class="fas ${a[1]}"></i> ${a[2]} <span>${a[3]}</span></button>`).join('')}</div>
        <div class="fav-toolbar">
            <div class="fav-busca"><i class="fas fa-search"></i><input type="text" id="fav-busca-input" placeholder="Buscar nos favoritos..." value="${favEsc(favUI.busca)}"></div>
            <select id="fav-ordem" title="Ordenar">
                <option value="recentes">Mais recentes</option><option value="antigos">Mais antigos</option>
                <option value="az">A → Z</option><option value="za">Z → A</option><option value="nota">Maior nota</option>
            </select>
            <select id="fav-filtro-nota" title="Filtrar por nota">
                <option value="0">Todas as notas</option><option value="1">★ 1+</option><option value="2">★ 2+</option>
                <option value="3">★ 3+</option><option value="4">★ 4+</option><option value="5">★ 5</option>
            </select>
            <div class="fav-mais-wrap">
                <button type="button" class="fav-btn" id="fav-btn-mais" title="Mais opções"><i class="fas fa-ellipsis-v"></i></button>
                <div class="fav-mais-menu hidden" id="fav-mais-menu">
                    <button type="button" data-mais="nova-pasta"><i class="fas fa-folder-plus"></i> Nova pasta</button>
                    <button type="button" data-mais="exportar"><i class="fas fa-file-export"></i> Exportar favoritos</button>
                    <button type="button" data-mais="importar"><i class="fas fa-file-import"></i> Importar favoritos</button>
                    <button type="button" data-mais="limpar" class="perigo"><i class="fas fa-trash"></i> Limpar tudo</button>
                </div>
            </div>
        </div>
        <div id="fav-conteudo"></div>`;

    corpo.querySelector('#fav-ordem').value = favUI.ordem;
    corpo.querySelector('#fav-filtro-nota').value = String(favUI.filtroNota);

    corpo.querySelectorAll('.fav-aba').forEach(b => b.addEventListener('click', () => { favUI.aba = b.dataset.aba; favUI.selecionados = new Set(); renderizarFavoritos(); }));
    const busca = corpo.querySelector('#fav-busca-input');
    busca.addEventListener('input', () => { favUI.busca = busca.value; renderizarConteudoFavoritos(); });
    corpo.querySelector('#fav-ordem').addEventListener('change', (e) => { favUI.ordem = e.target.value; renderizarConteudoFavoritos(); });
    corpo.querySelector('#fav-filtro-nota').addEventListener('change', (e) => { favUI.filtroNota = parseInt(e.target.value, 10) || 0; renderizarConteudoFavoritos(); });
    const menuMais = corpo.querySelector('#fav-mais-menu');
    corpo.querySelector('#fav-btn-mais').addEventListener('click', (e) => { e.stopPropagation(); menuMais.classList.toggle('hidden'); });
    menuMais.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-mais]'); if (!b) return;
        menuMais.classList.add('hidden');
        const a = b.dataset.mais;
        if (a === 'nova-pasta') { if (await favCriarPasta()) { favUI.aba = 'pastas'; renderizarFavoritos(); } }
        else if (a === 'exportar') favExportar();
        else if (a === 'importar') favImportar();
        else if (a === 'limpar') favLimparTudo();
    });

    renderizarConteudoFavoritos();
}

function renderizarConteudoFavoritos() {
    const alvo = document.getElementById('fav-conteudo');
    if (!alvo) return;
    alvo.innerHTML = '';
    const total = favoritos.categorias.length + favoritos.subcategorias.length + favoritos.midias.length + favoritos.pastas.length;
    if (total === 0) {
        alvo.innerHTML = '<p class="fav-vazio">Você ainda não favoritou nada. Toque no coração dos cards de mídias, categorias ou subcategorias para salvar aqui. Depois, organize em pastas e dê notas de 1 a 5 estrelas.</p>';
        return;
    }
    if (favUI.aba === 'pastas') return renderFavPastas(alvo);
    if (favUI.aba === 'categorias') return renderFavGrupos(alvo, 'categoria');
    if (favUI.aba === 'subcategorias') return renderFavGrupos(alvo, 'subcategoria');
    return renderFavMidias(alvo);
}

function renderFavMidias(alvo) {
    // Filtro de pasta
    const chips = [['__todas', 'Todas', favoritos.midias.length], ['', 'Sem pasta', favoritos.midias.filter(m => !m.pasta).length]]
        .concat(favoritos.pastas.map(p => [p.id, p.nome, favoritos.midias.filter(m => m.pasta === p.id).length, p.cor]));
    const barraPastas = document.createElement('div');
    barraPastas.className = 'fav-chips';
    barraPastas.innerHTML = chips.map(c => `<button type="button" class="fav-chip${favUI.pasta === c[0] ? ' ativo' : ''}" data-pasta="${favEsc(c[0])}">${c[3] ? `<i class="fas fa-folder" style="color:${favEsc(c[3])}"></i> ` : ''}${favEsc(c[1])} <span>${c[2]}</span></button>`).join('')
        + `<button type="button" class="fav-chip fav-chip-nova" data-pasta="__nova"><i class="fas fa-plus"></i> Pasta</button>`;
    barraPastas.addEventListener('click', async (e) => {
        const b = e.target.closest('.fav-chip'); if (!b) return;
        if (b.dataset.pasta === '__nova') { const p = await favCriarPasta(); if (p) favUI.pasta = p.id; renderizarFavoritos(); return; }
        favUI.pasta = b.dataset.pasta; favUI.selecionados = new Set(); renderizarConteudoFavoritos();
    });
    alvo.appendChild(barraPastas);

    let lista = favoritos.midias.filter(m => favUI.pasta === '__todas' ? true : (m.pasta || '') === favUI.pasta);
    lista = favOrdenar(favFiltrar(lista, m => [m.título, m.categoria, m.subcategoria, favNomePasta(m.pasta)]), m => m.título);

    // Ações em massa
    const acoes = document.createElement('div');
    acoes.className = 'fav-acoes';
    const nSel = favUI.selecionados.size;
    acoes.innerHTML = `
        <button type="button" class="fav-btn primario" data-acao="tocar"${lista.length ? '' : ' disabled'}><i class="fas fa-play"></i> Tocar tudo</button>
        <button type="button" class="fav-btn" data-acao="aleatorio"${lista.length ? '' : ' disabled'}><i class="fas fa-random"></i> Aleatório</button>
        <label class="fav-sel-todos"><input type="checkbox" data-acao="sel-todos"${lista.length && lista.every(m => favUI.selecionados.has(m.link)) ? ' checked' : ''}> Selecionar</label>
        ${nSel ? `<span class="fav-sel-info">${nSel} selecionada(s)</span>
            <select class="fav-select" data-acao="mover-massa"><option value="__x">Mover para...</option>${favOpcoesPasta('__x')}</select>
            <button type="button" class="fav-btn" data-acao="tocar-sel"><i class="fas fa-play"></i></button>
            <button type="button" class="fav-btn perigo" data-acao="remover-sel"><i class="fas fa-heart-crack"></i></button>` : ''}`;
    alvo.appendChild(acoes);
    const selecionadas = () => favoritos.midias.filter(m => favUI.selecionados.has(m.link));
    acoes.addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-acao]'); if (!b) return;
        const a = b.dataset.acao;
        if (a === 'tocar') favTocarLista(lista, false);
        else if (a === 'aleatorio') favTocarLista(lista, true);
        else if (a === 'tocar-sel') favTocarLista(lista.filter(m => favUI.selecionados.has(m.link)), false);
        else if (a === 'remover-sel') {
            if (!await uiConfirm(`Remover ${favUI.selecionados.size} mídia(s) dos favoritos?`)) return;
            favoritos.midias = favoritos.midias.filter(m => !favUI.selecionados.has(m.link));
            favUI.selecionados = new Set();
            salvarFavoritos(); atualizarBotaoFavoritoDoPlayer(); try { renderMosaic(); } catch (er) {} renderizarFavoritos();
        }
    });
    acoes.addEventListener('change', (e) => {
        const a = e.target.dataset.acao;
        if (a === 'sel-todos') { favUI.selecionados = e.target.checked ? new Set(lista.map(m => m.link)) : new Set(); renderizarConteudoFavoritos(); }
        else if (a === 'mover-massa' && e.target.value !== '__x') { const s = selecionadas(); favUI.selecionados = new Set(); favMoverParaPasta(s, e.target.value); }
    });

    if (!lista.length) {
        const p = document.createElement('p'); p.className = 'fav-vazio';
        p.innerText = 'Nenhuma mídia encontrada com esses filtros.';
        alvo.appendChild(p); return;
    }

    const ul = document.createElement('div');
    ul.className = 'fav-lista';
    lista.forEach(m => {
        const div = document.createElement('div');
        div.className = 'fav-item fav-item-midia' + (favUI.selecionados.has(m.link) ? ' selecionado' : '');
        const pastaNome = favNomePasta(m.pasta);
        div.innerHTML = `
            <input type="checkbox" class="fav-check"${favUI.selecionados.has(m.link) ? ' checked' : ''} aria-label="Selecionar">
            <img src="${favEsc(m.capa || 'https://placehold.co/160x90?text=Sem+Capa')}" alt="">
            <div class="fav-item-info">
                <strong>${favEsc(m.título)}</strong>
                <span>${favEsc([m.categoria, m.subcategoria].filter(Boolean).join(' • '))}${pastaNome ? ` <em class="fav-tag-pasta"><i class="fas fa-folder"></i> ${favEsc(pastaNome)}</em>` : ''}</span>
                ${favEstrelas(m.nota)}
            </div>
            <div class="fav-item-acoes">
                <select class="fav-select fav-mover" title="Mover para pasta">${favOpcoesPasta(m.pasta)}</select>
                <button type="button" class="fav-icone" data-a="play" title="Tocar"><i class="fas fa-play"></i></button>
                <button type="button" class="fav-icone" data-a="copiar" title="Copiar link"><i class="fas fa-link"></i></button>
                <button type="button" class="fav-icone perigo" data-a="remover" title="Remover dos favoritos"><i class="fas fa-heart-crack"></i></button>
            </div>`;
        div.addEventListener('click', (e) => {
            if (e.target.closest('.fav-check, select')) return;
            const est = e.target.closest('.fav-estrela'); if (est) { e.stopPropagation(); favDefinirNota(m, parseInt(est.dataset.nota, 10)); return; }
            const b = e.target.closest('[data-a]');
            const a = b ? b.dataset.a : 'play';
            if (a === 'play') { currentPlaylist = lista.slice(); fecharModalFavoritos(); playTrack(lista.indexOf(m)); }
            else if (a === 'copiar') { try { navigator.clipboard.writeText(m.link); b.innerHTML = '<i class="fas fa-check"></i>'; } catch (er) {} }
            else if (a === 'remover') alternarFavorito({ tipo: 'midia', track: m });
        });
        div.querySelector('.fav-check').addEventListener('change', (e) => {
            if (e.target.checked) favUI.selecionados.add(m.link); else favUI.selecionados.delete(m.link);
            renderizarConteudoFavoritos();
        });
        div.querySelector('.fav-mover').addEventListener('change', (e) => favMoverParaPasta([m], e.target.value));
        ul.appendChild(div);
    });
    alvo.appendChild(ul);
}

function renderFavPastas(alvo) {
    const topo = document.createElement('div');
    topo.className = 'fav-acoes';
    topo.innerHTML = `<button type="button" class="fav-btn primario"><i class="fas fa-folder-plus"></i> Nova pasta</button>`;
    topo.querySelector('button').addEventListener('click', async () => { if (await favCriarPasta()) renderizarFavoritos(); });
    alvo.appendChild(topo);

    const q = favUI.busca.trim().toLowerCase();
    let pastas = favoritos.pastas.filter(p => !q || p.nome.toLowerCase().includes(q));
    pastas = favOrdenar(pastas.map(p => Object.assign({}, p, { adicionadoEm: p.criadaEm })), p => p.nome).map(p => favoritos.pastas.find(x => x.id === p.id));

    if (!pastas.length) {
        const p = document.createElement('p'); p.className = 'fav-vazio';
        p.innerText = 'Nenhuma pasta ainda. Crie pastas para organizar suas mídias favoritas do seu jeito.';
        alvo.appendChild(p); return;
    }
    const grade = document.createElement('div');
    grade.className = 'fav-grade-pastas';
    pastas.forEach(p => {
        const itens = favoritos.midias.filter(m => m.pasta === p.id);
        const capas = itens.slice(0, 4).map(m => `<img src="${favEsc(m.capa || 'https://placehold.co/160x90?text=+')}" alt="">`).join('');
        const card = document.createElement('div');
        card.className = 'fav-pasta-card';
        card.style.setProperty('--pasta-cor', p.cor || 'var(--theme-color)');
        card.innerHTML = `
            <div class="fav-pasta-capa">${capas || '<i class="fas fa-folder-open"></i>'}</div>
            <div class="fav-pasta-info"><strong><i class="fas fa-folder"></i> ${favEsc(p.nome)}</strong><span>${itens.length} mídia(s)</span></div>
            <div class="fav-pasta-acoes">
                <button type="button" class="fav-icone" data-a="abrir" title="Abrir"><i class="fas fa-folder-open"></i></button>
                <button type="button" class="fav-icone" data-a="tocar" title="Tocar pasta"${itens.length ? '' : ' disabled'}><i class="fas fa-play"></i></button>
                <button type="button" class="fav-icone" data-a="aleatorio" title="Tocar aleatório"${itens.length ? '' : ' disabled'}><i class="fas fa-random"></i></button>
                <label class="fav-icone fav-cor" title="Cor da pasta"><i class="fas fa-palette"></i><input type="color" value="${favEsc(/^#[0-9a-f]{6}$/i.test(p.cor || '') ? p.cor : '#ff0000')}"></label>
                <button type="button" class="fav-icone" data-a="renomear" title="Renomear"><i class="fas fa-pen"></i></button>
                <button type="button" class="fav-icone perigo" data-a="excluir" title="Excluir pasta"><i class="fas fa-trash"></i></button>
            </div>`;
        card.addEventListener('click', (e) => {
            if (e.target.closest('.fav-cor')) return;
            const b = e.target.closest('[data-a]');
            const a = b ? b.dataset.a : 'abrir';
            if (a === 'abrir') { favUI.aba = 'midias'; favUI.pasta = p.id; renderizarFavoritos(); }
            else if (a === 'tocar') favTocarLista(favOrdenar(itens, m => m.título), false);
            else if (a === 'aleatorio') favTocarLista(itens, true);
            else if (a === 'renomear') favRenomearPasta(p.id);
            else if (a === 'excluir') favExcluirPasta(p.id);
        });
        card.querySelector('.fav-cor input').addEventListener('change', (e) => { p.cor = e.target.value; salvarFavoritos(); renderizarConteudoFavoritos(); });
        grade.appendChild(card);
    });
    alvo.appendChild(grade);
}

function renderFavGrupos(alvo, tipo) {
    const ehCat = tipo === 'categoria';
    const fonte = ehCat ? favoritos.categorias : favoritos.subcategorias;
    const titulo = (c) => ehCat ? c.categoria : c.subcategoria;
    const lista = favOrdenar(favFiltrar(fonte, c => [c.categoria, c.subcategoria]), titulo);
    if (!lista.length) {
        const p = document.createElement('p'); p.className = 'fav-vazio';
        p.innerText = ehCat ? 'Nenhuma categoria favoritada encontrada.' : 'Nenhuma subcategoria favoritada encontrada.';
        alvo.appendChild(p); return;
    }
    const ul = document.createElement('div');
    ul.className = 'fav-lista';
    lista.forEach(c => {
        const div = document.createElement('div');
        div.className = 'fav-item';
        div.innerHTML = `<img src="${favEsc(c.capa || 'https://placehold.co/160x90?text=Sem+Capa')}" alt="">
            <div class="fav-item-info"><strong>${favEsc(titulo(c))}</strong><span>${favEsc(ehCat ? 'Categoria' : c.categoria)}</span>${favEstrelas(c.nota)}</div>
            <div class="fav-item-acoes">
                <button type="button" class="fav-icone" data-a="abrir" title="Abrir"><i class="fas fa-arrow-right"></i></button>
                <button type="button" class="fav-icone perigo" data-a="remover" title="Remover dos favoritos"><i class="fas fa-heart-crack"></i></button>
            </div>`;
        div.addEventListener('click', (e) => {
            const est = e.target.closest('.fav-estrela'); if (est) { favDefinirNota(c, parseInt(est.dataset.nota, 10)); return; }
            const b = e.target.closest('[data-a]');
            if (b && b.dataset.a === 'remover') { alternarFavorito(ehCat ? { tipo: 'categoria', categoria: c.categoria } : { tipo: 'subcategoria', categoria: c.categoria, subcategoria: c.subcategoria }); return; }
            selectedCategory = c.categoria;
            selectedSubcategory = ehCat ? '' : c.subcategoria;
            currentView = ehCat ? 'subcategories' : 'tracks';
            fecharModalFavoritos(); renderMosaic();
        });
        ul.appendChild(div);
    });
    alvo.appendChild(ul);
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('fav-mais-menu');
    if (menu && !menu.classList.contains('hidden') && !e.target.closest('.fav-mais-wrap')) menu.classList.add('hidden');
});

function faixaAtualDoPlayer() {
    return currentPlaylist && currentPlaylist[currentTrackIndex] ? currentPlaylist[currentTrackIndex] : null;
}

function atualizarBotaoFavoritoDoPlayer() {
    const btn = document.getElementById('btn-fav-current');
    if (!btn) return;
    const faixa = faixaAtualDoPlayer();
    const ativo = faixa ? ehFavorito({ tipo: 'midia', track: faixa }) : false;
    btn.classList.toggle('ativo', ativo);
    btn.title = ativo ? 'Remover dos favoritos' : 'Favoritar esta mídia';
    btn.innerHTML = `<i class="${ativo ? 'fas' : 'far'} fa-heart"></i>`;
}

// ==========================================
// DESCRICAO DO VIDEO EM REPRODUCAO
// ==========================================
let cacheDescricoes = {};

async function abrirDescricaoDoVideo() {
    const faixa = faixaAtualDoPlayer();
    const modal = document.getElementById('video-desc-modal');
    const elTitulo = document.getElementById('video-desc-title');
    const elTexto = document.getElementById('video-desc-text');
    if (!modal || !elTexto) return;

    modal.classList.remove('hidden');
    if (!faixa) { if (elTitulo) elTitulo.innerText = ''; elTexto.innerText = 'Nenhuma mídia em reprodução.'; return; }

    if (elTitulo) elTitulo.innerText = faixa.título || '';
    const vid = extractYoutubeId((faixa.link || '').trim());

    if (!vid) {
        elTexto.innerText = faixa.descricao || faixa["descrição"] || 'Esta mídia não possui descrição disponível.';
        return;
    }

    if (cacheDescricoes[vid] !== undefined) {
        elTexto.innerText = cacheDescricoes[vid] || 'Este vídeo não possui descrição.';
        return;
    }

    elTexto.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Carregando descrição...';
    try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${vid}&key=${CONFIG.YT_API_KEY}`);
        const data = await res.json();
        const desc = data.items && data.items[0] ? (data.items[0].snippet.description || '') : '';
        cacheDescricoes[vid] = desc;
        elTexto.innerText = desc || 'Este vídeo não possui descrição.';
    } catch (e) {
        elTexto.innerText = 'Não foi possível carregar a descrição agora.';
    }
}

// ==========================================
// EVENTOS DOS FAVORITOS E DA DESCRICAO
// ==========================================
document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-favorites') || e.target.closest('#btn-favorites-mobile')) {
        e.preventDefault();
        abrirModalFavoritos();
        return;
    }
    if (e.target.closest('#btn-close-favorites')) { fecharModalFavoritos(); return; }
    if (e.target.closest('#favorites-modal') && !e.target.closest('.modal-box')) { fecharModalFavoritos(); return; }

    if (e.target.closest('#btn-video-desc')) { e.preventDefault(); abrirDescricaoDoVideo(); return; }
    if (e.target.closest('#btn-close-video-desc')) { document.getElementById('video-desc-modal')?.classList.add('hidden'); return; }
    if (e.target.closest('#video-desc-modal') && !e.target.closest('.modal-box')) { document.getElementById('video-desc-modal')?.classList.add('hidden'); return; }

    if (e.target.closest('#btn-fav-current')) {
        e.preventDefault();
        const faixa = faixaAtualDoPlayer();
        if (faixa) alternarFavorito({ tipo: 'midia', track: faixa });
        return;
    }
});

document.addEventListener('DOMContentLoaded', atualizarBotaoFavoritoDoPlayer);


/* ==========================================
   REPRODUÇÃO DE ARQUIVOS DE ÁUDIO NO PLAYER
   (WAV, MP3, AAC, M4A, APE, OGG, WMA, MP2...)
   Mantém todas as funções já existentes do player:
   volume, mudo, anterior/próxima, aleatório, favoritos,
   compartilhar, PiP, tela desligada, Cast e comentários.
   Como áudio não tem imagem, exibimos a capa da mídia:
   1) capa embutida nas tags do arquivo (ID3 / MP4 / FLAC / OGG)
   2) capa cadastrada no acervo
   3) logo do StreamHub como último recurso
   ========================================== */

const EXTENSOES_AUDIO = [
    'mp3','mpga','mp2','wav','wave','flac','aac','m4a','m4b','mp4a','alac',
    'ogg','oga','opus','spx','weba','webma','wma','ape','aif','aiff','aifc',
    'amr','au','snd','caf','dsf','dff','wv','mpc','mka','ra','ram','mid','midi','3ga'
];
// Formatos que a maioria dos navegadores NÃO decodifica nativamente
const EXTENSOES_AUDIO_LIMITADAS = ['ape','wma','wv','mpc','dsf','dff','ra','ram','mid','midi','mp2','aif','aiff','aifc','au','snd','caf','amr'];

// MIME correto por extensão: sem isso alguns servidores entregam
// "application/octet-stream" e o navegador recusa arquivos válidos (ex.: FLAC).
const MIME_AUDIO = {
    mp3: 'audio/mpeg', mpga: 'audio/mpeg', mp2: 'audio/mpeg',
    wav: 'audio/wav', wave: 'audio/wav',
    flac: 'audio/flac',
    aac: 'audio/aac',
    m4a: 'audio/mp4', m4b: 'audio/mp4', mp4a: 'audio/mp4', alac: 'audio/mp4',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg; codecs=opus', spx: 'audio/ogg',
    weba: 'audio/webm', webma: 'audio/webm', mka: 'audio/webm',
    wma: 'audio/x-ms-wma', ape: 'audio/x-ape', wv: 'audio/x-wavpack', mpc: 'audio/x-musepack',
    aif: 'audio/aiff', aiff: 'audio/aiff', aifc: 'audio/aiff',
    amr: 'audio/amr', au: 'audio/basic', snd: 'audio/basic', caf: 'audio/x-caf',
    dsf: 'audio/x-dsf', dff: 'audio/x-dff', ra: 'audio/vnd.rn-realaudio', ram: 'audio/vnd.rn-realaudio',
    mid: 'audio/midi', midi: 'audio/midi', '3ga': 'audio/3gpp'
};

function mimeDoAudio(url) {
    return MIME_AUDIO[extensaoDoArquivo(url)] || '';
}

// O navegador consegue tocar este arquivo?
function navegadorSuportaAudio(url) {
    try {
        const teste = document.createElement('audio');
        const mime = mimeDoAudio(url);
        if (!mime) return true;
        if (teste.canPlayType(mime)) return true;
        // alguns navegadores só respondem ao MIME alternativo
        const alternativos = {
            'audio/flac': ['audio/x-flac', 'audio/ogg; codecs=flac'],
            'audio/wav': ['audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
            'audio/aac': ['audio/mp4; codecs=mp4a.40.2', 'audio/aacp'],
            'audio/mp4': ['audio/mp4; codecs=mp4a.40.2', 'audio/x-m4a'],
            'audio/mpeg': ['audio/mp3']
        };
        const lista = alternativos[mime] || [];
        for (let i = 0; i < lista.length; i++) { if (teste.canPlayType(lista[i])) return true; }
        return false;
    } catch (e) { return true; }
}

function extensaoDoArquivo(url) {
    try {
        const limpa = (url || '').split('#')[0].split('?')[0].trim().toLowerCase();
        const ponto = limpa.lastIndexOf('.');
        return ponto === -1 ? '' : limpa.slice(ponto + 1);
    } catch (e) { return ''; }
}

function ehArquivoDeAudio(url) {
    return EXTENSOES_AUDIO.indexOf(extensaoDoArquivo(url)) !== -1;
}

function esconderPalcoDeAudio() {
    const palco = document.getElementById('audio-stage');
    if (palco) palco.classList.add('hidden');
    const container = document.getElementById('player-container');
    if (container) container.classList.remove('audio-mode');
    const aviso = document.getElementById('audio-warning');
    if (aviso) { aviso.classList.add('hidden'); aviso.innerText = ''; }
}

function definirCapaDoAudio(src) {
    const img = document.getElementById('audio-cover');
    if (img && src) img.src = src;
}

function capaPadraoDoAudio(track) {
    return (track && track.capa) ? track.capa : 'logo.png';
}

// Lê a capa embutida no arquivo (quando o servidor permitir a leitura)
function buscarCapaEmbutida(link, aoEncontrar) {
    if (typeof window.jsmediatags === 'undefined') return;
    try {
        window.jsmediatags.read(link, {
            onSuccess: (tag) => {
                try {
                    const dados = tag && tag.tags ? tag.tags : {};
                    const imagem = dados.picture;
                    if (imagem && imagem.data && imagem.data.length) {
                        let binario = '';
                        const bytes = imagem.data;
                        for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
                        aoEncontrar('data:' + (imagem.format || 'image/jpeg') + ';base64,' + window.btoa(binario), dados);
                    } else {
                        aoEncontrar(null, dados);
                    }
                } catch (e) {}
            },
            onError: () => {}
        });
    } catch (e) {}
}

function atualizarMetadadosDoSistema(titulo, artista, capa) {
    try {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.metadata = new window.MediaMetadata({
            title: titulo || 'StreamHub',
            artist: artista || '',
            album: 'StreamHub',
            artwork: capa ? [{ src: capa, sizes: '512x512', type: 'image/jpeg' }] : []
        });
        try { navigator.mediaSession.setActionHandler('previoustrack', () => voltarFaixa()); } catch (e) {}
        try { navigator.mediaSession.setActionHandler('nexttrack', () => avancarFaixa()); } catch (e) {}
    } catch (e) {}
}

function tocarAudioNoPlayer(track, link, rawPlayerEl) {
    const container = document.getElementById('player-container');
    const palco = document.getElementById('audio-stage');
    const tituloEl = document.getElementById('audio-title');
    const artistaEl = document.getElementById('audio-artist');
    const aviso = document.getElementById('audio-warning');

    if (container) container.classList.add('audio-mode');
    if (palco) palco.classList.remove('hidden');
    if (tituloEl) tituloEl.innerText = (track && track.título) ? track.título : 'Áudio';
    if (artistaEl) artistaEl.innerText = extensaoDoArquivo(link).toUpperCase();
    if (aviso) { aviso.classList.add('hidden'); aviso.innerText = ''; }

    const capaInicial = capaPadraoDoAudio(track);
    definirCapaDoAudio(capaInicial);
    atualizarMetadadosDoSistema(track && track.título, '', capaInicial);

    buscarCapaEmbutida(link, (capa, dados) => {
        if (capa) {
            definirCapaDoAudio(capa);
            atualizarMetadadosDoSistema(track && track.título, dados && dados.artist, capa);
        }
        if (artistaEl && dados) {
            const partes = [];
            if (dados.artist) partes.push(dados.artist);
            if (dados.album) partes.push(dados.album);
            partes.push(extensaoDoArquivo(link).toUpperCase());
            artistaEl.innerText = partes.join(' • ');
        }
    });

    if (!rawPlayerEl) return;
    rawPlayerEl.classList.remove('hidden');
    rawPlayerEl.classList.add('as-audio');
    rawPlayerEl.setAttribute('poster', '');

    // Informa o tipo correto ao navegador (FLAC, OPUS, AAC etc.)
    try { while (rawPlayerEl.firstChild) rawPlayerEl.removeChild(rawPlayerEl.firstChild); } catch (e) {}
    try { rawPlayerEl.removeAttribute('src'); } catch (e) {}
    const fonte = document.createElement('source');
    fonte.src = link;
    const mime = mimeDoAudio(link);
    if (mime) fonte.type = mime;
    fonte.onerror = () => { if (rawPlayerEl.onerror) rawPlayerEl.onerror(); };
    rawPlayerEl.appendChild(fonte);
    try { rawPlayerEl.load(); } catch (e) {}

    rawPlayerEl.onended = () => { avancarFaixa(); };
    rawPlayerEl.onerror = () => {
        // 2ª tentativa: alguns servidores só funcionam com src direto (sem type)
        if (!rawPlayerEl.dataset.tentativaDireta) {
            rawPlayerEl.dataset.tentativaDireta = '1';
            try { while (rawPlayerEl.firstChild) rawPlayerEl.removeChild(rawPlayerEl.firstChild); } catch (e) {}
            rawPlayerEl.src = link;
            try { rawPlayerEl.load(); } catch (e) {}
            const p2 = rawPlayerEl.play();
            if (p2 && p2.catch) p2.catch(() => {});
            return;
        }
        if (!aviso) return;
        aviso.classList.remove('hidden');
        const ext = extensaoDoArquivo(link).toUpperCase();
        aviso.innerText = !navegadorSuportaAudio(link)
            ? `Este navegador não reproduz o formato ${ext} nativamente. Converta para MP3, FLAC, M4A, OGG/OPUS ou WAV.`
            : 'Não foi possível carregar este áudio. Verifique o link do arquivo (ou as permissões do servidor).';
    };
    delete rawPlayerEl.dataset.tentativaDireta;
    if (aviso && !navegadorSuportaAudio(link)) {
        aviso.classList.remove('hidden');
        aviso.innerText = `Formato ${extensaoDoArquivo(link).toUpperCase()} pode não ser suportado por este navegador. Tentando reproduzir mesmo assim...`;
    }
    const promessa = rawPlayerEl.play();
    if (promessa && promessa.catch) promessa.catch(() => {});
    aplicarVolume();
}


/* ==========================================================================
   MODO "ACESSO SEM LOGIN" (MINI YOUTUBE)
   Interface pública de navegação no YouTube usando a API Key global.
   Funções do acervo (salvar mídias, favoritos, admin) exigem login.
   ========================================================================== */
(function () {
    "use strict";

    const YT_BASE = "https://www.googleapis.com/youtube/v3";
    const GUEST_REGION = "BR";

    const gs = {
        montado: false,
        ativo: false,
        view: "home",
        query: "",
        filtro: "video",          // video | channel | playlist
        nextPageToken: "",
        contexto: null,           // dados da view atual (canal, playlist...)
        carregando: false,
        logado: false,
        historico: []
    };

    // ==========================================================
    // HISTÓRICO DE NAVEGAÇÃO (setas voltar / avançar)
    // + PERSISTÊNCIA DE TUDO QUE FOI ACESSADO
    // ==========================================================
    const CHAVE_ESTADO = "sh_mini_yt_estado";
    const nav = { pilha: [], pos: -1, restaurando: false };
    let acaoPendente = null;

    function salvarPersistencia(extra) {
        try {
            const base = {
                pilha: nav.pilha.slice(-50),
                pos: Math.min(nav.pos, 49),
                aberto: !!gs.ativo,
                logado: !!gs.logado,
                query: gs.query || "",
                pendente: acaoPendente || null,
                retomar: false
            };
            const anterior = lerPersistencia() || {};
            localStorage.setItem(CHAVE_ESTADO, JSON.stringify(Object.assign({}, anterior, base, extra || {})));
        } catch (e) { }
    }

    function lerPersistencia() {
        try { return JSON.parse(localStorage.getItem(CHAVE_ESTADO) || "null"); } catch (e) { return null; }
    }

    function restaurarPersistencia() {
        const d = lerPersistencia();
        if (!d || !Array.isArray(d.pilha) || !d.pilha.length) return null;
        nav.pilha = d.pilha;
        nav.pos = (typeof d.pos === "number" && d.pos >= 0 && d.pos < d.pilha.length) ? d.pos : d.pilha.length - 1;
        gs.query = d.query || "";
        return d;
    }

    function empilhar(estado) {
        if (nav.restaurando || !estado) return;
        const atual = nav.pilha[nav.pos];
        try { if (atual && JSON.stringify(atual) === JSON.stringify(estado)) return; } catch (e) { }
        nav.pilha = nav.pilha.slice(0, nav.pos + 1);
        nav.pilha.push(estado);
        if (nav.pilha.length > 60) nav.pilha.shift();
        nav.pos = nav.pilha.length - 1;
        atualizarSetas();
        salvarPersistencia();
        gravarUrlGuest(estado);
    }

    // ---------- URL própria para cada ação (#/yt/...) ----------
    const encY = (v) => encodeURIComponent(String(v == null ? "" : v));
    const decY = (v) => { try { return decodeURIComponent(v || ""); } catch (e) { return v || ""; } };
    function hashDoEstado(st) {
        if (!st) return "#/yt";
        if (st.tipo === "home") return st.categoriaId ? "#/yt/em-alta/" + encY(st.categoriaId) : "#/yt";
        if (st.tipo === "search") return "#/yt/busca/" + encY(st.filtro || "video") + "/" + encY(st.query || "");
        if (st.tipo === "channel") return "#/yt/canal/" + encY(st.id);
        if (st.tipo === "playlist") return "#/yt/playlist/" + encY(st.id);
        if (st.tipo === "watch") return "#/yt/video/" + encY(st.id);
        return "#/yt";
    }
    function estadoDoHash(hash) {
        const h = String(hash || "");
        if (!/^#\/yt(\/|$)/.test(h)) return null;
        const p = h.replace(/^#\/yt\/?/, "").split("/");
        if (!p[0]) return { tipo: "home", categoriaId: "" };
        if (p[0] === "em-alta") return { tipo: "home", categoriaId: decY(p[1]) };
        if (p[0] === "busca" && p.length >= 3) return { tipo: "search", filtro: decY(p[1]) || "video", query: decY(p.slice(2).join("/")) };
        if (p[0] === "canal" && p[1]) return { tipo: "channel", id: decY(p[1]) };
        if (p[0] === "playlist" && p[1]) return { tipo: "playlist", id: decY(p[1]) };
        if (p[0] === "video" && p[1]) return { tipo: "watch", id: decY(p[1]) };
        return { tipo: "home", categoriaId: "" };
    }
    window.estadoGuestDoHash = estadoDoHash;
    function gravarUrlGuest(st) {
        if (!gs.ativo || !st) return;
        const destino = hashDoEstado(st);
        if (location.hash === destino) return;
        try { history.replaceState(history.state, "", location.pathname + location.search + destino); } catch (e) { }
    }
    function limparUrlGuest() {
        if (!/^#\/yt/.test(location.hash || "")) return;
        try { history.replaceState(history.state, "", location.pathname + location.search); } catch (e) { }
    }
    window.addEventListener("hashchange", () => {
        const st = estadoDoHash(location.hash);
        if (!st) return;
        const atual = nav.pilha[nav.pos];
        if (gs.ativo && atual && hashDoEstado(atual) === location.hash) return;
        if (!gs.ativo) { window.abrirModoGuest({ restaurar: false, estadoInicial: st }); return; }
        aplicarEstado(st).then(() => empilhar(st));
    });

    async function aplicarEstado(st) {
        if (!st) return;
        gravarUrlGuest(st);
        nav.restaurando = true;
        try {
            if (st.tipo === "home") {
                gs.view = "home";
                renderChips(!st.categoriaId);
                await carregarPopulares(st.categoriaId || "");
            } else if (st.tipo === "search") {
                await pesquisar(st.query, st.filtro || "video", true);
            } else if (st.tipo === "channel") {
                await abrirCanal(st.id);
            } else if (st.tipo === "playlist") {
                await abrirPlaylist(st.id);
            } else if (st.tipo === "watch") {
                await abrirVideo(st.id);
            }
        } catch (e) { } finally {
            nav.restaurando = false;
            atualizarSetas();
        }
    }

    function voltarNav() {
        if (nav.pos <= 0) return;
        nav.pos--;
        salvarPersistencia();
        aplicarEstado(nav.pilha[nav.pos]);
    }

    function avancarNav() {
        if (nav.pos >= nav.pilha.length - 1) return;
        nav.pos++;
        salvarPersistencia();
        aplicarEstado(nav.pilha[nav.pos]);
    }

    function atualizarSetas() {
        const b = document.getElementById("guest-btn-back");
        const f = document.getElementById("guest-btn-fwd");
        if (b) b.disabled = nav.pos <= 0;
        if (f) f.disabled = nav.pos >= nav.pilha.length - 1;
    }

    // ---------- utilidades ----------

    function chaveApi() {
        return (typeof YT_API_KEY_GLOBAL !== "undefined" && YT_API_KEY_GLOBAL) ? YT_API_KEY_GLOBAL : (CONFIG && CONFIG.YT_API_KEY) || "";
    }

    async function ytApi(recurso, params) {
        const url = new URL(`${YT_BASE}/${recurso}`);
        Object.keys(params || {}).forEach(k => {
            if (params[k] !== undefined && params[k] !== null && params[k] !== "") url.searchParams.set(k, params[k]);
        });
        url.searchParams.set("key", chaveApi());
        const res = await fetch(url.toString());
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const motivo = data?.error?.errors?.[0]?.reason || data?.error?.message || `HTTP ${res.status}`;
            throw new Error(motivo);
        }
        return data;
    }

    function esc(txt) {
        return String(txt == null ? "" : txt)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function decodificarHtml(txt) {
        const d = document.createElement("textarea");
        d.innerHTML = String(txt == null ? "" : txt);
        return d.value;
    }

    function thumbDe(snippet) {
        const t = snippet?.thumbnails || {};
        return (t.maxres || t.standard || t.high || t.medium || t.default || {}).url || "https://placehold.co/1920x1080?text=Sem+capa";
    }

    function numeroCompacto(valor) {
        const n = Number(valor || 0);
        if (!isFinite(n)) return "0";
        if (n >= 1e9) return (n / 1e9).toFixed(1).replace(".0", "") + " bi";
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".0", "") + " mi";
        if (n >= 1e3) return (n / 1e3).toFixed(1).replace(".0", "") + " mil";
        return String(n);
    }

    function tempoRelativo(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        if (isNaN(d)) return "";
        const seg = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
        const faixas = [["ano", 31536000], ["mês", 2592000], ["semana", 604800], ["dia", 86400], ["hora", 3600], ["minuto", 60]];
        for (const [nome, s] of faixas) {
            const q = Math.floor(seg / s);
            if (q >= 1) {
                let plural = nome === "mês" ? "meses" : nome + "s";
                return `há ${q} ${q > 1 ? plural : nome}`;
            }
        }
        return "agora mesmo";
    }

    function duracaoLegivel(iso) {
        if (!iso) return "";
        const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
        if (!m) return "";
        const dias = +(m[1] || 0), h = +(m[2] || 0) + dias * 24, mi = +(m[3] || 0), s = +(m[4] || 0);
        const p2 = (v) => String(v).padStart(2, "0");
        return h > 0 ? `${h}:${p2(mi)}:${p2(s)}` : `${mi}:${p2(s)}`;
    }

    function idDoUploads(channelId) {
        return channelId ? "UU" + channelId.slice(2) : "";
    }

    // ---------- bloqueio de recursos que exigem conta ----------

    window.exigirLoginGuest = async function (acao, dados) {
        acaoPendente = dados ? Object.assign({ rotulo: acao || "" }, dados) : (acao ? { rotulo: acao } : null);
        salvarPersistencia();
        const texto = acao ? `Para ${acao} é necessário entrar na sua conta.` : "Esta função é exclusiva para usuários com conta.";
        const box = document.getElementById("guest-login-required");
        if (box) {
            box.querySelector(".guest-lr-text").innerText = texto;
            box.classList.remove("hidden");
        } else {
            if (await uiConfirm(texto + "\n\nDeseja entrar ou criar sua conta agora?")) sairDoModoGuest("login");
        }
    };

    function fecharAvisoLogin() {
        document.getElementById("guest-login-required")?.classList.add("hidden");
    }

    // ---------- montagem da interface ----------

    function montarInterface() {
        if (gs.montado) return;

        const wrap = document.createElement("div");
        wrap.id = "guest-container";
        wrap.className = "guest-wrapper hidden";
        wrap.innerHTML = `
            <header class="guest-header">
                <div class="guest-header-left">
                    <button class="guest-icon-btn guest-menu-btn" id="guest-btn-menu" title="Menu" aria-label="Abrir ou recolher menu" aria-controls="guest-sidebar" aria-expanded="true"><i class="fas fa-bars"></i></button>
                    <div class="guest-nav-arrows">
                        <button class="guest-icon-btn guest-nav-arrow" id="guest-btn-back" title="Voltar" aria-label="Voltar" disabled><i class="fas fa-arrow-left"></i></button>
                        <button class="guest-icon-btn guest-nav-arrow" id="guest-btn-fwd" title="Avançar" aria-label="Avançar" disabled><i class="fas fa-arrow-right"></i></button>
                    </div>
                    <div class="guest-brand" id="guest-brand" title="Início">
                        <i class="fab fa-youtube"></i><span>StreamHub <small>Livre</small></span>
                    </div>
                </div>
                <div class="guest-header-center">
                    <div class="guest-searchbar">
                        <input type="text" id="guest-search-input" placeholder="Pesquisar vídeos, canais ou playlists" autocomplete="off">
                        <button id="guest-search-btn" title="Pesquisar"><i class="fas fa-search"></i></button>
                    </div>
                </div>
                <div class="guest-header-right">
                    <button class="guest-icon-btn guest-only-mobile" id="guest-btn-search-mobile" title="Pesquisar"><i class="fas fa-search"></i></button>
                    <button class="guest-btn-login" id="guest-btn-entrar"><i class="fas fa-right-to-bracket"></i> <span>Entrar / Cadastrar</span></button>
                    <button class="guest-btn-voltar-app" id="guest-btn-voltar-app" title="Voltar para o StreamHub"><i class="fas fa-arrow-right-from-bracket"></i> <span>Voltar ao StreamHub</span></button>
                </div>
            </header>

            <div class="guest-mobile-search hidden" id="guest-mobile-search">
                <div class="guest-searchbar">
                    <input type="text" id="guest-search-input-mobile" placeholder="Pesquisar no YouTube" autocomplete="off">
                    <button id="guest-search-btn-mobile"><i class="fas fa-search"></i></button>
                </div>
            </div>

            <div class="guest-body">
                <div class="guest-sidebar-backdrop" id="guest-sidebar-backdrop" aria-hidden="true"></div>
                <aside class="guest-sidebar" id="guest-sidebar">
                    <button class="guest-side-item active" data-guest-nav="home"><i class="fas fa-house"></i> Início</button>
                    <button class="guest-side-item" data-guest-nav="trending"><i class="fas fa-fire"></i> Em alta</button>
                    <button class="guest-side-item" data-guest-nav="music"><i class="fas fa-music"></i> Música</button>
                    <button class="guest-side-item" data-guest-nav="gaming"><i class="fas fa-gamepad"></i> Games</button>
                    <button class="guest-side-item" data-guest-nav="news"><i class="fas fa-newspaper"></i> Notícias</button>
                    <button class="guest-side-item" data-guest-nav="sports"><i class="fas fa-futbol"></i> Esportes</button>
                    <button class="guest-side-item" data-guest-nav="movies"><i class="fas fa-film"></i> Filmes</button>
                    <hr class="guest-side-sep">
                    <div class="guest-side-title">Sua conta</div>
                    <button class="guest-side-item guest-locked" data-guest-acao="acervo" data-guest-locked="ver seu acervo pessoal"><i class="fas fa-photo-film"></i> Meu acervo <i class="fas fa-lock guest-lock-ico"></i></button>
                    <button class="guest-side-item guest-locked" data-guest-acao="favoritos" data-guest-locked="usar os favoritos"><i class="fas fa-heart"></i> Favoritos <i class="fas fa-lock guest-lock-ico"></i></button>
                    <button class="guest-side-item guest-locked" data-guest-acao="adicionar" data-guest-locked="salvar mídias na sua conta"><i class="fas fa-plus"></i> Adicionar mídia <i class="fas fa-lock guest-lock-ico"></i></button>
                    <button class="guest-side-item guest-locked" data-guest-acao="vincular-canal" data-guest-locked="vincular canais ao seu acervo"><i class="fas fa-tv"></i> Vincular canal <i class="fas fa-lock guest-lock-ico"></i></button>
                    <hr class="guest-side-sep">
                    <p class="guest-side-note">Você está navegando sem login. Crie sua conta gratuita para montar seu próprio acervo de mídias.</p>
                    <button class="guest-side-cta" id="guest-side-cta">Criar minha conta</button>
                </aside>

                <main class="guest-main" id="guest-main">
                    <div class="guest-chips" id="guest-chips"></div>
                    <div id="guest-content" class="guest-content"></div>
                    <div class="guest-loadmore-row" id="guest-loadmore-row"></div>
                </main>
            </div>

            <div class="guest-theme-switcher" role="group" aria-label="Selecionar tema">
                <button type="button" class="theme-btn-toggle btn-t-yt" data-guest-theme="youtube" title="Tema YouTube" aria-label="Tema YouTube"><i class="fab fa-youtube"></i></button>
                <button type="button" class="theme-btn-toggle btn-t-nf" data-guest-theme="netflix" title="Tema Netflix" aria-label="Tema Netflix"><i class="fas fa-play"></i></button>
                <button type="button" class="theme-btn-toggle btn-t-ft" data-guest-theme="futurista" title="Tema Cyberpunk Futurista" aria-label="Tema Cyberpunk Futurista"><i class="fas fa-bolt"></i></button>
                <button type="button" class="theme-btn-toggle btn-t-cl" data-guest-theme="claro" title="Tema Claro Moderno" aria-label="Tema Claro Moderno"><i class="fas fa-sun"></i></button>
            </div>

            <div id="guest-login-required" class="guest-lr-overlay hidden">
                <div class="guest-lr-box">
                    <i class="fas fa-lock guest-lr-ico"></i>
                    <h3>Recurso exclusivo para membros</h3>
                    <p class="guest-lr-text"></p>
                    <div class="guest-lr-actions">
                        <button class="guest-lr-cancel" id="guest-lr-cancel">Continuar sem login</button>
                        <button class="guest-lr-ok" id="guest-lr-login">Entrar</button>
                        <button class="guest-lr-ok guest-lr-alt" id="guest-lr-signup">Criar conta</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);
        gs.montado = true;
        ligarEventos();
    }

    function ligarEventos() {
        const $ = (id) => document.getElementById(id);

        $("guest-brand").onclick = () => irPara("home");
        $("guest-btn-menu").onclick = () => definirSidebarGuest(!sidebarGuestAberta());
        $("guest-sidebar-backdrop").onclick = () => definirSidebarGuest(false);
        $("guest-container").addEventListener("pointerdown", (ev) => {
            if (window.innerWidth > 820 || !sidebarGuestAberta()) return;
            if (ev.target.closest("#guest-sidebar, #guest-btn-menu")) return;
            definirSidebarGuest(false);
        });
        window.addEventListener("resize", () => {
            definirSidebarGuest(window.innerWidth > 820 && !$("guest-container").classList.contains("guest-sidebar-collapsed"));
        });
        $("guest-container").querySelectorAll("[data-guest-theme]").forEach(btn => {
            btn.onclick = () => selecionarTemaGuest(btn.getAttribute("data-guest-theme"));
        });
        $("guest-btn-back").onclick = voltarNav;
        $("guest-btn-fwd").onclick = avancarNav;
        $("guest-btn-voltar-app").onclick = () => fecharMiniYoutube();
        $("guest-btn-entrar").onclick = () => sairDoModoGuest("login");
        $("guest-side-cta").onclick = () => sairDoModoGuest("cadastro");
        $("guest-lr-cancel").onclick = fecharAvisoLogin;
        $("guest-lr-login").onclick = () => { fecharAvisoLogin(); sairDoModoGuest("login"); };
        $("guest-lr-signup").onclick = () => { fecharAvisoLogin(); sairDoModoGuest("cadastro"); };

        const disparar = (inputId) => {
            const v = ($(inputId)?.value || "").trim();
            if (!v) return;
            if (window.innerWidth <= 820) definirSidebarGuest(false);
            $("guest-mobile-search").classList.add("hidden");
            pesquisar(v, gs.filtro || "video");
        };
        $("guest-search-btn").onclick = () => disparar("guest-search-input");
        $("guest-search-input").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); disparar("guest-search-input"); } };
        $("guest-search-btn-mobile").onclick = () => disparar("guest-search-input-mobile");
        $("guest-search-input-mobile").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); disparar("guest-search-input-mobile"); } };
        $("guest-btn-search-mobile").onclick = () => $("guest-mobile-search").classList.toggle("hidden");

        document.querySelectorAll("[data-guest-nav]").forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll("[data-guest-nav]").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                if (window.innerWidth <= 820) definirSidebarGuest(false);
                irPara(btn.getAttribute("data-guest-nav"));
            };
        });
        document.querySelectorAll("[data-guest-locked]").forEach(btn => {
            btn.onclick = (ev) => { ev.stopPropagation(); tratarBotaoRestrito(btn); };
        });

        document.addEventListener("keydown", (ev) => {
            if (!gs.ativo) return;
            if (ev.altKey && ev.key === "ArrowLeft") { ev.preventDefault(); voltarNav(); }
            if (ev.altKey && ev.key === "ArrowRight") { ev.preventDefault(); avancarNav(); }
        });
    }

    function sidebarGuestAberta() {
        const wrap = document.getElementById("guest-container");
        return window.innerWidth <= 820
            ? wrap.classList.contains("guest-sidebar-open")
            : !wrap.classList.contains("guest-sidebar-collapsed");
    }

    function definirSidebarGuest(aberta) {
        const wrap = document.getElementById("guest-container");
        if (!wrap) return;
        wrap.classList.toggle("guest-sidebar-open", window.innerWidth <= 820 && aberta);
        if (window.innerWidth > 820) wrap.classList.toggle("guest-sidebar-collapsed", !aberta);
        document.getElementById("guest-btn-menu")?.setAttribute("aria-expanded", String(aberta));
    }

    const TEMAS_GUEST = ["theme-netflix", "theme-futurista", "theme-claro"];
    function selecionarTemaGuest(tema) {
        const classe = tema === "youtube" ? "" : `theme-${tema}`;
        if (classe && !TEMAS_GUEST.includes(classe)) return;
        document.body.classList.remove(...TEMAS_GUEST);
        if (classe) document.body.classList.add(classe);
        document.querySelectorAll("[data-guest-theme]").forEach(btn => {
            btn.setAttribute("aria-pressed", String(btn.getAttribute("data-guest-theme") === tema));
        });
        try { localStorage.setItem("sh_mini_yt_tema", classe); } catch (e) { }
        if (gs.logado && typeof salvarPreferenciaNoFirebase === "function") salvarPreferenciaNoFirebase({ tema: classe });
    }

    // ==========================================================
    // AÇÕES RESTRITAS: bloqueadas sem login / liberadas logado
    // ==========================================================
    function dadosDoBotao(btn) {
        return {
            acao: btn.getAttribute("data-guest-acao") || "",
            videoId: btn.getAttribute("data-yt-id") || "",
            playlistId: btn.getAttribute("data-yt-playlist") || "",
            channelId: btn.getAttribute("data-yt-channel") || "",
            titulo: btn.getAttribute("data-yt-title") || "",
            capa: btn.getAttribute("data-yt-thumb") || ""
        };
    }

    function tratarBotaoRestrito(btn) {
        const info = dadosDoBotao(btn);
        if (!gs.logado) {
            window.exigirLoginGuest(btn.getAttribute("data-guest-locked"), info);
            return;
        }
        executarAcaoLiberada(info, btn);
    }

    function abrirNoApp(executar) {
        fecharMiniYoutube();
        setTimeout(() => { try { executar(); } catch (e) { } }, 120);
    }

    function clicarSeExistir(id) {
        const el = document.getElementById(id);
        if (el) el.click();
    }

    function abrirAdminNaAba(aba, gatilho) {
        document.getElementById("admin-modal")?.classList.remove("hidden");
        if (typeof switchTabs === "function") switchTabs(aba, gatilho);
    }

    function executarAcaoLiberada(info, btn) {
        const acao = info.acao;

        if (acao === "acervo") { abrirNoApp(() => { }); return; }
        if (acao === "favoritos") { abrirNoApp(() => clicarSeExistir("btn-favorites")); return; }
        if (acao === "adicionar") { abrirNoApp(() => abrirAdminNaAba("add-tab", "tab-trigger-add")); return; }
        if (acao === "vincular-canal" || acao === "vincular-este-canal" || acao === "salvar-canal") {
            abrirNoApp(() => {
                abrirAdminNaAba("channel-tab", "tab-trigger-channel");
                const campo = document.getElementById("search-channel-input");
                if (campo && info.titulo) {
                    campo.value = info.titulo;
                    campo.focus();
                    document.getElementById("btn-search-channel")?.click();
                }
            });
            return;
        }
        if (acao === "salvar-video" && info.videoId) {
            abrirNoApp(() => {
                if (typeof openAdminWithTrack === "function") {
                    openAdminWithTrack({ type: "video", youtubeId: info.videoId, thumb: info.capa, title: info.titulo });
                } else { abrirAdminNaAba("add-tab", "tab-trigger-add"); }
            });
            return;
        }
        if (acao === "salvar-playlist" && info.playlistId) {
            abrirNoApp(() => {
                if (typeof openAdminWithTrack === "function") {
                    openAdminWithTrack({ type: "playlist", youtubeId: info.playlistId, thumb: info.capa, title: info.titulo });
                } else { abrirAdminNaAba("add-tab", "tab-trigger-add"); }
            });
            return;
        }
        if (acao === "favoritar" && info.videoId) {
            try {
                const track = {
                    "título": info.titulo || "Vídeo do YouTube",
                    link: `https://www.youtube.com/embed/${info.videoId}`,
                    capa: info.capa || thumbAltaPorId(info.videoId),
                    categoria: "Mini YouTube",
                    subcategoria: "Favoritos"
                };
                if (typeof alternarFavorito === "function") alternarFavorito({ track });
                const ativo = (typeof ehFavorito === "function") ? ehFavorito({ track }) : true;
                if (btn) {
                    btn.classList.toggle("guest-fav-on", !!ativo);
                    btn.innerHTML = `<i class="fas fa-heart"></i> ${ativo ? "Favoritado" : "Favoritar"}`;
                }
            } catch (e) { }
            return;
        }
        if (acao === "comentar") { montarComposerGuest(); return; }
    }

    // ---------- caixa de comentário (somente logado) ----------
    function montarComposerGuest() {
        const box = document.getElementById("guest-comment-compose");
        if (!box || !gs.logado) return;
        const temToken = (typeof googleAccessToken !== "undefined" && googleAccessToken) &&
            (typeof usuarioEhDoGoogle !== "function" || usuarioEhDoGoogle());
        if (!temToken) {
            box.innerHTML = `
                <div class="guest-compose">
                    <p class="guest-compose-hint">Autorize sua conta Google para comentar direto por aqui.</p>
                    <button type="button" class="guest-compose-google" id="guest-btn-google-coment"><i class="fab fa-google"></i> Autorizar Google</button>
                </div>`;
            const b = document.getElementById("guest-btn-google-coment");
            if (b) b.onclick = async () => {
                if (typeof pedirLoginGoogleParaComentar === "function") {
                    const ok = await pedirLoginGoogleParaComentar();
                    if (ok) montarComposerGuest();
                }
            };
            return;
        }
        box.innerHTML = `
            <div class="guest-compose">
                <textarea id="guest-coment-texto" placeholder="Escreva um comentário público..."></textarea>
                <button type="button" class="guest-compose-send" id="guest-coment-enviar"><i class="fas fa-paper-plane"></i> Comentar</button>
            </div>`;
        document.getElementById("guest-coment-enviar").onclick = enviarComentarioGuest;
    }

    async function enviarComentarioGuest() {
        const campo = document.getElementById("guest-coment-texto");
        const botao = document.getElementById("guest-coment-enviar");
        const videoId = gs.contexto && gs.contexto.tipo === "watch" ? gs.contexto.videoId : "";
        if (!campo || !videoId) return;
        const texto = campo.value.trim();
        if (!texto) { campo.focus(); return; }
        if (botao) { botao.disabled = true; botao.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; }
        try {
            const res = await fetch("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet", {
                method: "POST",
                headers: { "Authorization": "Bearer " + googleAccessToken, "Content-Type": "application/json" },
                body: JSON.stringify({ snippet: { videoId, topLevelComment: { snippet: { textOriginal: texto } } } })
            });
            const dados = await res.json().catch(() => ({}));
            if (dados.error) {
                if (res.status === 401 || res.status === 403) {
                    googleAccessToken = null;
                    try { sessionStorage.removeItem("gToken"); } catch (e) { }
                    uiAlert("Sua autorização do Google expirou. Autorize novamente para comentar.");
                    montarComposerGuest();
                } else {
                    uiAlert("Não foi possível publicar o comentário: " + (dados.error.message || "erro desconhecido"));
                }
                return;
            }
            campo.value = "";
            carregarComentariosGuest(videoId);
        } catch (e) {
            uiAlert("Erro de rede ao publicar o comentário.");
        } finally {
            if (botao) { botao.disabled = false; botao.innerHTML = '<i class="fas fa-paper-plane"></i> Comentar'; }
        }
    }

    // ---------- entrada / saída do modo ----------

    function estaLogado() {
        try { return !!firebase.auth().currentUser; } catch (e) { return false; }
    }

    function aplicarModoLogado(logado) {
        gs.logado = !!logado;
        document.body.classList.toggle("mini-yt-logado", !!logado);
        const cont = document.getElementById("guest-container");
        if (cont) cont.classList.toggle("guest-liberado", !!logado);
    }

    // Abre o Mini YouTube. opcoes.logado = true libera todas as funções.
    window.abrirModoGuest = function (opcoes) {
        const op = opcoes || {};
        montarInterface();
        aplicarModoLogado(estaLogado());
        if (!gs.logado) {
            try { selecionarTemaGuest((localStorage.getItem("sh_mini_yt_tema") || "").replace(/^theme-/, "") || "youtube"); } catch (e) { }
        } else {
            const temaAtual = TEMAS_GUEST.find(t => document.body.classList.contains(t));
            document.querySelectorAll("[data-guest-theme]").forEach(btn => btn.setAttribute("aria-pressed", String(btn.getAttribute("data-guest-theme") === (temaAtual ? temaAtual.replace(/^theme-/, "") : "youtube"))));
        }
        definirSidebarGuest(window.innerWidth > 820 && !document.getElementById("guest-container").classList.contains("guest-sidebar-collapsed"));
        document.getElementById("login-screen")?.classList.add("hidden");
        document.getElementById("app-container")?.classList.add("hidden");
        document.getElementById("guest-container")?.classList.remove("hidden");
        document.body.classList.add("guest-mode-on");
        gs.ativo = true;

        const persistido = restaurarPersistencia();
        const temHistorico = persistido && nav.pilha.length;
        atualizarSetas();

        if (op.estadoInicial) {
            nav.restaurando = false;
            aplicarEstado(op.estadoInicial).then(() => empilhar(op.estadoInicial));
        } else if (op.restaurar !== false && temHistorico) {
            aplicarEstado(nav.pilha[nav.pos]);
        } else {
            irPara("home");
        }
        salvarPersistencia();
    };

    // Atalho usado pelo botão do cabeçalho da área logada
    window.abrirMiniYoutube = function () { window.abrirModoGuest({ logado: true }); };

    // Fecha o Mini YouTube e volta para o StreamHub (usuário logado)
    function fecharMiniYoutube() {
        pararReproducao();
        document.getElementById("guest-container")?.classList.add("hidden");
        document.body.classList.remove("guest-mode-on");
        gs.ativo = false;
        limparUrlGuest();
        salvarPersistencia({ aberto: false });
        document.getElementById("app-container")?.classList.remove("hidden");
    }
    window.fecharMiniYoutube = fecharMiniYoutube;

    function sairDoModoGuest(aba) {
        pararReproducao();
        // Guarda tudo o que foi navegado para retomar exatamente aqui depois do login
        salvarPersistencia({ aberto: true, retomar: true, pendente: acaoPendente || null });
        document.getElementById("guest-container")?.classList.add("hidden");
        document.body.classList.remove("guest-mode-on");
        gs.ativo = false;
        limparUrlGuest();
        if (estaLogado()) {
            document.getElementById("app-container")?.classList.remove("hidden");
            return;
        }
        document.getElementById("login-screen")?.classList.remove("hidden");
        if (typeof alternarAbasLogin === "function") alternarAbasLogin(aba === "cadastro" ? "cadastro" : "login");
    }
    window.sairDoModoGuest = sairDoModoGuest;

    // ---------- retomada automática depois do login ----------
    function retomarAposLogin() {
        const d = lerPersistencia();
        if (!d || !d.retomar) return;
        salvarPersistencia({ retomar: false });
        setTimeout(() => {
            window.abrirModoGuest({ logado: true, restaurar: true });
            const pend = d.pendente;
            if (pend && pend.acao) {
                setTimeout(() => { try { executarAcaoLiberada(pend, null); } catch (e) { } }, 900);
            }
            acaoPendente = null;
            salvarPersistencia({ pendente: null, retomar: false });
        }, 700);
    }

    try {
        firebase.auth().onAuthStateChanged((u) => {
            if (u) retomarAposLogin(); else aplicarModoLogado(false);
        });
    } catch (e) { }

    function pararReproducao() {
        const f = document.getElementById("guest-watch-frame");
        if (f) f.src = "about:blank";
    }

    // ---------- navegação ----------

    const CHIPS = [
        { rotulo: "Tudo", q: "" },
        { rotulo: "Música", q: "música" },
        { rotulo: "Podcasts", q: "podcast" },
        { rotulo: "Shows ao vivo", q: "show ao vivo" },
        { rotulo: "Notícias", q: "notícias" },
        { rotulo: "Games", q: "gameplay" },
        { rotulo: "Receitas", q: "receitas" },
        { rotulo: "Documentários", q: "documentário" },
        { rotulo: "Tecnologia", q: "tecnologia" },
        { rotulo: "Humor", q: "humor" }
    ];

    const CATEGORIA_POR_NAV = { trending: "", music: "10", gaming: "20", news: "25", sports: "17", movies: "1" };

    function irPara(nav) {
        pararReproducao();
        gs.nextPageToken = "";
        if (nav === "home") { gs.view = "home"; renderChips(true); carregarPopulares(""); return; }
        gs.view = "home";
        renderChips(false);
        carregarPopulares(CATEGORIA_POR_NAV[nav] || "");
    }

    function renderChips(mostrar) {
        const box = document.getElementById("guest-chips");
        if (!box) return;
        if (!mostrar) { box.innerHTML = ""; box.classList.add("hidden"); return; }
        box.classList.remove("hidden");
        box.innerHTML = CHIPS.map((c, i) =>
            `<button class="guest-chip ${i === 0 ? "active" : ""}" data-chip="${esc(c.q)}">${esc(c.rotulo)}</button>`).join("");
        box.querySelectorAll("[data-chip]").forEach(btn => {
            btn.onclick = () => {
                box.querySelectorAll(".guest-chip").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                const q = btn.getAttribute("data-chip");
                if (!q) { carregarPopulares(""); } else { pesquisar(q, "video", true); }
            };
        });
    }

    function conteudo() { return document.getElementById("guest-content"); }
    function areaMais() { return document.getElementById("guest-loadmore-row"); }

    function mostrarCarregando(texto) {
        conteudo().innerHTML = `<div class="guest-loading"><i class="fas fa-circle-notch fa-spin"></i> ${esc(texto || "Carregando...")}</div>`;
        areaMais().innerHTML = "";
    }

    function mostrarErro(e) {
        conteudo().innerHTML = `
            <div class="guest-error">
                <i class="fas fa-triangle-exclamation"></i>
                <h3>Não foi possível carregar o conteúdo</h3>
                <p>${esc(e && e.message ? e.message : e)}</p>
                <p class="guest-error-dica">Isso normalmente acontece quando a cota diária da chave do YouTube se esgota ou o domínio não está liberado na chave.</p>
            </div>`;
        areaMais().innerHTML = "";
    }

    function botaoCarregarMais(aoClicar) {
        const area = areaMais();
        if (!gs.nextPageToken) { area.innerHTML = ""; return; }
        area.innerHTML = `<button class="guest-loadmore" id="guest-loadmore">Carregar mais</button>`;
        document.getElementById("guest-loadmore").onclick = async (ev) => {
            ev.currentTarget.innerText = "Carregando...";
            ev.currentTarget.disabled = true;
            await aoClicar();
        };
    }

    // ---------- cards ----------

    function cardVideo(v) {
        const id = v.id;
        const s = v.snippet || {};
        const dur = v.contentDetails?.duration ? duracaoLegivel(v.contentDetails.duration) : "";
        const views = v.statistics?.viewCount ? `${numeroCompacto(v.statistics.viewCount)} visualizações · ` : "";
        return `
        <article class="guest-card" data-video="${esc(id)}">
            <div class="guest-thumb">
                <img loading="lazy" src="${esc(thumbDe(s))}" alt="${esc(decodificarHtml(s.title))}">
                ${dur ? `<span class="guest-dur">${esc(dur)}</span>` : ""}
                <span class="guest-play"><i class="fas fa-play"></i></span>
            </div>
            <div class="guest-card-info">
                <h4 title="${esc(decodificarHtml(s.title))}">${esc(decodificarHtml(s.title))}</h4>
                <span class="guest-card-channel" data-channel="${esc(s.channelId || "")}">${esc(decodificarHtml(s.channelTitle))}</span>
                <span class="guest-card-meta">${views}${esc(tempoRelativo(s.publishedAt))}</span>
            </div>
            <button class="guest-card-save guest-locked" data-guest-acao="salvar-video" data-yt-id="${esc(id)}" data-yt-title="${esc(decodificarHtml(s.title))}" data-yt-thumb="${esc(thumbDe(s))}" data-guest-locked="salvar este vídeo no seu acervo" title="Salvar no meu acervo"><i class="fas fa-plus"></i></button>
        </article>`;
    }

    function cardCanal(c) {
        const s = c.snippet || {};
        const id = c.id?.channelId || c.id;
        const inscritos = c.statistics?.subscriberCount ? `${numeroCompacto(c.statistics.subscriberCount)} inscritos` : "Canal";
        return `
        <article class="guest-card guest-card-channel-item" data-channel="${esc(id)}">
            <div class="guest-chan-avatar"><img loading="lazy" src="${esc(thumbDe(s))}" alt="${esc(decodificarHtml(s.title))}"></div>
            <div class="guest-card-info">
                <h4>${esc(decodificarHtml(s.title))}</h4>
                <span class="guest-card-meta">${esc(inscritos)}</span>
                <span class="guest-card-desc">${esc(decodificarHtml(s.description || "").slice(0, 110))}</span>
            </div>
            <button class="guest-card-save guest-locked" data-guest-acao="salvar-canal" data-yt-channel="${esc(id)}" data-yt-title="${esc(decodificarHtml(s.title))}" data-guest-locked="vincular este canal ao seu acervo" title="Vincular canal ao acervo" aria-label="Vincular canal ao acervo"><i class="fas fa-plus"></i></button>
        </article>`;
    }

    function cardPlaylist(p) {
        const s = p.snippet || {};
        const id = p.id?.playlistId || p.id;
        const qtd = p.contentDetails?.itemCount != null ? `${p.contentDetails.itemCount} vídeos` : "Playlist";
        return `
        <article class="guest-card" data-playlist="${esc(id)}">
            <div class="guest-thumb guest-thumb-playlist">
                <img loading="lazy" src="${esc(thumbDe(s))}" alt="${esc(decodificarHtml(s.title))}">
                <span class="guest-plbadge"><i class="fas fa-list"></i> ${esc(qtd)}</span>
            </div>
            <div class="guest-card-info">
                <h4>${esc(decodificarHtml(s.title))}</h4>
                <span class="guest-card-channel" data-channel="${esc(s.channelId || "")}">${esc(decodificarHtml(s.channelTitle))}</span>
            </div>
            <button class="guest-card-save guest-locked" data-guest-acao="salvar-playlist" data-yt-playlist="${esc(id)}" data-yt-title="${esc(decodificarHtml(s.title))}" data-yt-thumb="${esc(thumbDe(s))}" data-guest-locked="salvar esta playlist no seu acervo" title="Salvar playlist no acervo" aria-label="Salvar playlist no acervo"><i class="fas fa-plus"></i></button>
        </article>`;
    }

    function ligarCliquesDosCards(escopo) {
        (escopo || document).querySelectorAll("[data-video]").forEach(el => {
            el.onclick = (ev) => {
                if (ev.target.closest("[data-guest-locked]")) return;
                if (ev.target.closest("[data-channel]") && ev.target.closest("[data-channel]") !== el) return;
                abrirVideo(el.getAttribute("data-video"));
            };
        });
        (escopo || document).querySelectorAll("[data-channel]").forEach(el => {
            el.onclick = (ev) => {
                const id = el.getAttribute("data-channel");
                if (!id) return;
                ev.stopPropagation();
                abrirCanal(id);
            };
        });
        (escopo || document).querySelectorAll("[data-playlist]").forEach(el => {
            el.onclick = (ev) => {
                if (ev.target.closest("[data-guest-locked], [data-channel]")) return;
                abrirPlaylist(el.getAttribute("data-playlist"));
            };
        });
        (escopo || document).querySelectorAll("[data-guest-locked]").forEach(btn => {
            btn.onclick = (ev) => { ev.stopPropagation(); tratarBotaoRestrito(btn); };
        });
    }

    // ---------- home / populares ----------

    async function carregarPopulares(categoriaId) {
        gs.view = "home";
        gs.nextPageToken = "";
        empilhar({ tipo: "home", categoriaId: categoriaId || "" });
        mostrarCarregando("Carregando vídeos em alta...");
        try {
            const data = await ytApi("videos", {
                part: "snippet,statistics,contentDetails",
                chart: "mostPopular",
                regionCode: GUEST_REGION,
                videoCategoryId: categoriaId || "",
                maxResults: 24
            });
            if (gs.view !== "home") return; // outra tela foi aberta enquanto carregava
            gs.nextPageToken = data.nextPageToken || "";
            gs.contexto = { tipo: "populares", categoriaId };
            conteudo().innerHTML = `
                <h2 class="guest-section-title"><i class="fas fa-fire"></i> Em alta no YouTube</h2>
                <div class="guest-grid" id="guest-grid">${(data.items || []).map(cardVideo).join("")}</div>`;
            ligarCliquesDosCards(conteudo());
            const maisPopulares = async () => {
                const mais = await ytApi("videos", {
                    part: "snippet,statistics,contentDetails", chart: "mostPopular", regionCode: GUEST_REGION,
                    videoCategoryId: categoriaId || "", maxResults: 24, pageToken: gs.nextPageToken
                });
                gs.nextPageToken = mais.nextPageToken || "";
                document.getElementById("guest-grid").insertAdjacentHTML("beforeend", (mais.items || []).map(cardVideo).join(""));
                ligarCliquesDosCards(document.getElementById("guest-grid"));
                botaoCarregarMais(maisPopulares);
            };
            botaoCarregarMais(maisPopulares);
        } catch (e) { mostrarErro(e); }
    }

    // ---------- pesquisa ----------

    async function pesquisar(query, tipo, semScroll) {
        gs.view = "search";
        gs.query = query;
        gs.filtro = tipo || "video";
        gs.nextPageToken = "";
        empilhar({ tipo: "search", query: query, filtro: gs.filtro });
        document.getElementById("guest-chips").classList.add("hidden");
        const inp = document.getElementById("guest-search-input");
        if (inp && inp.value !== query) inp.value = query;
        if (!semScroll) window.scrollTo({ top: 0 });
        mostrarCarregando(`Pesquisando "${query}"...`);
        await executarPesquisa(true);
    }

    async function executarPesquisa(primeira) {
        try {
            const data = await ytApi("search", {
                part: "snippet",
                q: gs.query,
                type: gs.filtro,
                maxResults: 24,
                regionCode: GUEST_REGION,
                relevanceLanguage: "pt",
                pageToken: primeira ? "" : gs.nextPageToken
            });
            gs.nextPageToken = data.nextPageToken || "";
            const itens = data.items || [];
            let html = "";

            if (gs.filtro === "video") {
                const ids = itens.map(i => i.id?.videoId).filter(Boolean).join(",");
                let detalhes = [];
                if (ids) {
                    const d = await ytApi("videos", { part: "snippet,statistics,contentDetails", id: ids });
                    detalhes = d.items || [];
                }
                html = detalhes.map(cardVideo).join("");
            } else if (gs.filtro === "channel") {
                const ids = itens.map(i => i.id?.channelId).filter(Boolean).join(",");
                let detalhes = [];
                if (ids) {
                    const d = await ytApi("channels", { part: "snippet,statistics", id: ids });
                    detalhes = d.items || [];
                }
                html = detalhes.map(cardCanal).join("");
            } else {
                const ids = itens.map(i => i.id?.playlistId).filter(Boolean).join(",");
                let detalhes = [];
                if (ids) {
                    const d = await ytApi("playlists", { part: "snippet,contentDetails", id: ids });
                    detalhes = d.items || [];
                }
                html = detalhes.map(cardPlaylist).join("");
            }

            if (primeira) {
                conteudo().innerHTML = `
                    <div class="guest-search-head">
                        <h2 class="guest-section-title"><i class="fas fa-search"></i> Resultados para “${esc(gs.query)}”</h2>
                        <div class="guest-filters">
                            <button class="guest-filter ${gs.filtro === "video" ? "active" : ""}" data-filtro="video"><i class="fas fa-video"></i> Vídeos</button>
                            <button class="guest-filter ${gs.filtro === "channel" ? "active" : ""}" data-filtro="channel"><i class="fas fa-tv"></i> Canais</button>
                            <button class="guest-filter ${gs.filtro === "playlist" ? "active" : ""}" data-filtro="playlist"><i class="fas fa-list"></i> Playlists</button>
                        </div>
                    </div>
                    <div class="guest-grid" id="guest-grid">${html || `<p class="guest-vazio">Nenhum resultado encontrado.</p>`}</div>`;
                conteudo().querySelectorAll("[data-filtro]").forEach(b => {
                    b.onclick = () => pesquisar(gs.query, b.getAttribute("data-filtro"), true);
                });
            } else {
                document.getElementById("guest-grid").insertAdjacentHTML("beforeend", html);
            }
            ligarCliquesDosCards(conteudo());
            botaoCarregarMais(() => executarPesquisa(false));
        } catch (e) { mostrarErro(e); }
    }

    // ---------- canal ----------

    async function abrirCanal(channelId) {
        pararReproducao();
        gs.view = "channel";
        empilhar({ tipo: "channel", id: channelId });
        window.scrollTo({ top: 0 });
        document.getElementById("guest-chips").classList.add("hidden");
        mostrarCarregando("Abrindo canal...");
        try {
            const d = await ytApi("channels", { part: "snippet,statistics,contentDetails,brandingSettings", id: channelId });
            const c = (d.items || [])[0];
            if (!c) throw new Error("Canal não encontrado.");
            gs.contexto = { tipo: "canal", canal: c };
            const banner = c.brandingSettings?.image?.bannerExternalUrl;
            const st = c.statistics || {};
            conteudo().innerHTML = `
                <section class="guest-channel">
                    ${banner ? `<div class="guest-chan-banner"><img src="${esc(banner)}=w1707" alt="Banner do canal"></div>` : ""}
                    <div class="guest-chan-head">
                        <img class="guest-chan-pic" src="${esc(thumbDe(c.snippet))}" alt="${esc(decodificarHtml(c.snippet.title))}">
                        <div class="guest-chan-txt">
                            <h2>${esc(decodificarHtml(c.snippet.title))}</h2>
                            <span class="guest-card-meta">
                                ${st.subscriberCount ? numeroCompacto(st.subscriberCount) + " inscritos · " : ""}
                                ${st.videoCount ? numeroCompacto(st.videoCount) + " vídeos" : ""}
                            </span>
                            <p class="guest-chan-desc">${esc(decodificarHtml(c.snippet.description || "").slice(0, 300))}</p>
                        </div>
                        <button class="guest-locked guest-chan-sub" data-guest-acao="vincular-este-canal" data-yt-channel="${esc(c.id)}" data-yt-title="${esc(decodificarHtml(c.snippet.title))}" data-guest-locked="vincular este canal ao seu acervo">
                            <i class="fas fa-link"></i> Vincular ao meu acervo
                        </button>
                    </div>
                    <nav class="guest-chan-tabs">
                        <button class="guest-chan-tab active" data-chantab="videos">Vídeos</button>
                        <button class="guest-chan-tab" data-chantab="playlists">Playlists</button>
                        <button class="guest-chan-tab" data-chantab="sobre">Sobre</button>
                    </nav>
                    <div id="guest-chan-body"></div>
                </section>`;
            ligarCliquesDosCards(conteudo());
            conteudo().querySelectorAll("[data-chantab]").forEach(b => {
                b.onclick = () => {
                    conteudo().querySelectorAll("[data-chantab]").forEach(x => x.classList.remove("active"));
                    b.classList.add("active");
                    const aba = b.getAttribute("data-chantab");
                    if (aba === "videos") abaVideosDoCanal(c);
                    else if (aba === "playlists") abaPlaylistsDoCanal(c);
                    else abaSobreDoCanal(c);
                };
            });
            abaVideosDoCanal(c);
        } catch (e) { mostrarErro(e); }
    }
    window.abrirCanalGuest = abrirCanal;

    // ---------- filtros / pesquisa dentro do canal ----------

    function segundosDe(iso) {
        const m = String(iso || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (!m) return 0;
        return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
    }

    function barraFiltrosCanal(tipo) {
        const ehVideo = tipo === "videos";
        const ordens = ehVideo
            ? [["recentes", "Mais recentes"], ["antigos", "Mais antigos"], ["populares", "Mais vistos"], ["curtidos", "Mais curtidos"], ["titulo", "Título (A-Z)"], ["titulo-desc", "Título (Z-A)"], ["longos", "Maior duração"], ["curtos", "Menor duração"]]
            : [["recentes", "Mais recentes"], ["antigos", "Mais antigos"], ["titulo", "Título (A-Z)"], ["titulo-desc", "Título (Z-A)"], ["mais-videos", "Mais vídeos"], ["menos-videos", "Menos vídeos"]];
        const duracoes = ehVideo ? `
            <select class="guest-chan-select" id="guest-chan-dur" aria-label="Filtrar por duração">
                <option value="">Qualquer duração</option>
                <option value="curto">Curtos (até 4 min)</option>
                <option value="medio">Médios (4 a 20 min)</option>
                <option value="longo">Longos (mais de 20 min)</option>
            </select>` : "";
        return `
        <div class="guest-chan-toolbar">
            <form class="guest-chan-search" id="guest-chan-search-form">
                <i class="fas fa-search"></i>
                <input type="search" id="guest-chan-search" placeholder="${ehVideo ? "Pesquisar vídeos neste canal" : "Pesquisar playlists neste canal"}" autocomplete="off">
                <button type="button" class="guest-chan-clear hidden" id="guest-chan-clear" aria-label="Limpar pesquisa"><i class="fas fa-xmark"></i></button>
            </form>
            <div class="guest-chan-selects">
                <select class="guest-chan-select" id="guest-chan-ordem" aria-label="Ordenar">
                    ${ordens.map(o => `<option value="${o[0]}">${o[1]}</option>`).join("")}
                </select>
                ${duracoes}
            </div>
        </div>
        <p class="guest-chan-status" id="guest-chan-status"></p>
        <div id="guest-chan-list"></div>`;
    }

    function ligarBarraFiltros(alvo, aoMudar) {
        const input = alvo.querySelector("#guest-chan-search");
        const limpar = alvo.querySelector("#guest-chan-clear");
        const disparar = () => { limpar.classList.toggle("hidden", !input.value); aoMudar(); };
        alvo.querySelector("#guest-chan-search-form").onsubmit = (ev) => { ev.preventDefault(); disparar(); };
        let t = null;
        input.oninput = () => { limpar.classList.toggle("hidden", !input.value); clearTimeout(t); t = setTimeout(disparar, 600); };
        limpar.onclick = () => { input.value = ""; disparar(); input.focus(); };
        alvo.querySelector("#guest-chan-ordem").onchange = disparar;
        const dur = alvo.querySelector("#guest-chan-dur");
        if (dur) dur.onchange = disparar;
        return () => ({
            termo: input.value.trim(),
            ordem: alvo.querySelector("#guest-chan-ordem").value,
            duracao: dur ? dur.value : ""
        });
    }

    function ordenarItens(lista, ordem, tipo) {
        const data = x => new Date(x.snippet?.publishedAt || 0).getTime();
        const titulo = x => decodificarHtml(x.snippet?.title || "").toLowerCase();
        const l = lista.slice();
        const cmp = {
            "recentes": (a, b) => data(b) - data(a),
            "antigos": (a, b) => data(a) - data(b),
            "populares": (a, b) => (+b.statistics?.viewCount || 0) - (+a.statistics?.viewCount || 0),
            "curtidos": (a, b) => (+b.statistics?.likeCount || 0) - (+a.statistics?.likeCount || 0),
            "titulo": (a, b) => titulo(a).localeCompare(titulo(b), "pt-BR"),
            "titulo-desc": (a, b) => titulo(b).localeCompare(titulo(a), "pt-BR"),
            "longos": (a, b) => segundosDe(b.contentDetails?.duration) - segundosDe(a.contentDetails?.duration),
            "curtos": (a, b) => segundosDe(a.contentDetails?.duration) - segundosDe(b.contentDetails?.duration),
            "mais-videos": (a, b) => (+b.contentDetails?.itemCount || 0) - (+a.contentDetails?.itemCount || 0),
            "menos-videos": (a, b) => (+a.contentDetails?.itemCount || 0) - (+b.contentDetails?.itemCount || 0)
        }[ordem];
        return cmp ? l.sort(cmp) : l;
    }

    function passaDuracao(v, faixa) {
        if (!faixa) return true;
        const s = segundosDe(v.contentDetails?.duration);
        if (faixa === "curto") return s > 0 && s <= 240;
        if (faixa === "medio") return s > 240 && s <= 1200;
        if (faixa === "longo") return s > 1200;
        return true;
    }

    function normalizar(t) {
        return decodificarHtml(String(t || "")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    async function detalhesDeVideos(ids) {
        let out = [];
        for (let i = 0; i < ids.length; i += 50) {
            const lote = ids.slice(i, i + 50).join(",");
            if (!lote) continue;
            const d = await ytApi("videos", { part: "snippet,statistics,contentDetails", id: lote });
            out = out.concat(d.items || []);
        }
        return out;
    }

    async function abaVideosDoCanal(c) {
        const alvo = document.getElementById("guest-chan-body");
        const uploads = c.contentDetails?.relatedPlaylists?.uploads || idDoUploads(c.id);
        alvo.innerHTML = barraFiltrosCanal("videos");
        const lista = alvo.querySelector("#guest-chan-list");
        const status = alvo.querySelector("#guest-chan-status");
        const LIMITE_IDS = 1000;   // teto de vídeos varridos para ordenações completas
        const POR_PAGINA = 24;
        let geracao = 0;

        // Estado da consulta atual
        let st = null;

        const lerFiltros = ligarBarraFiltros(alvo, () => iniciar());

        const renderPagina = async (primeira) => {
            const minhaGeracao = geracao;
            let novos = [];
            if (st.modo === "uploads") {
                // Paginação direta do upload (mais recentes)
                while (novos.length < POR_PAGINA && (primeira && !st.inicioFeito || st.token)) {
                    st.inicioFeito = true;
                    const d = await ytApi("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: 50, pageToken: st.token || "" });
                    st.token = d.nextPageToken || "";
                    const ids = (d.items || []).map(i => i.contentDetails?.videoId).filter(Boolean);
                    let det = await detalhesDeVideos(ids);
                    det = det.filter(v => passaDuracao(v, st.f.duracao));
                    novos = novos.concat(ordenarItens(det, "recentes"));
                    if (!st.f.duracao) break;
                }
            } else {
                // Lista completa de IDs já conhecida: ordena/filtra e mostra em fatias
                while (novos.length < POR_PAGINA && st.cursor < st.ids.length) {
                    const fatia = st.ids.slice(st.cursor, st.cursor + 50);
                    st.cursor += fatia.length;
                    let det = await detalhesDeVideos(fatia);
                    const ordemIdx = new Map(fatia.map((id, i) => [id, i]));
                    det.sort((a, b) => ordemIdx.get(a.id) - ordemIdx.get(b.id));
                    novos = novos.concat(det.filter(v => passaDuracao(v, st.f.duracao)));
                }
            }
            if (minhaGeracao !== geracao) return;
            const html = novos.map(cardVideo).join("");
            if (primeira) lista.innerHTML = `<div class="guest-grid" id="guest-grid">${html || `<p class="guest-vazio">Nenhum vídeo encontrado com esses filtros.</p>`}</div>`;
            else document.getElementById("guest-grid").insertAdjacentHTML("beforeend", html);
            ligarCliquesDosCards(lista);
            const temMais = st.modo === "uploads" ? !!st.token : st.cursor < st.ids.length;
            gs.nextPageToken = temMais ? "mais" : "";
            botaoCarregarMais(() => renderPagina(false));
        };

        const iniciar = async () => {
            const minhaGeracao = ++geracao;
            const f = lerFiltros();
            st = { f, modo: "uploads", token: "", ids: [], cursor: 0 };
            areaMais().innerHTML = "";
            status.textContent = "";
            lista.innerHTML = `<div class="guest-loading"><i class="fas fa-circle-notch fa-spin"></i> ${f.termo ? "Pesquisando no canal..." : "Carregando vídeos..."}</div>`;
            try {
                if (!f.termo && f.ordem === "recentes") {
                    // caminho rápido
                } else if (f.termo) {
                    // Pesquisa dentro do canal (API de busca), depois ordena localmente
                    let ids = [], token = "";
                    const ordemApi = f.ordem === "populares" ? "viewCount" : (f.ordem === "titulo" ? "title" : (f.ordem === "recentes" || f.ordem === "antigos" ? "date" : "relevance"));
                    for (let p = 0; p < 4; p++) {
                        const d = await ytApi("search", { part: "snippet", type: "video", channelId: c.id, q: f.termo, order: ordemApi, maxResults: 50, pageToken: token });
                        ids = ids.concat((d.items || []).map(i => i.id?.videoId).filter(Boolean));
                        token = d.nextPageToken || "";
                        if (!token) break;
                    }
                    if (minhaGeracao !== geracao) return;
                    const det = await detalhesDeVideos(ids);
                    const ordenados = ordenarItens(det, f.ordem);
                    st.modo = "lista";
                    st.ids = ordenados.map(v => v.id);
                    status.textContent = `${ordenados.length} resultado(s) para "${f.termo}"`;
                } else {
                    // Ordenações que exigem varrer o canal: coleta IDs do upload
                    let ids = [], token = "";
                    do {
                        const d = await ytApi("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: 50, pageToken: token });
                        ids = ids.concat((d.items || []).map(i => i.contentDetails?.videoId).filter(Boolean));
                        token = d.nextPageToken || "";
                        if (minhaGeracao !== geracao) return;
                        lista.innerHTML = `<div class="guest-loading"><i class="fas fa-circle-notch fa-spin"></i> Organizando vídeos do canal... (${ids.length})</div>`;
                    } while (token && ids.length < LIMITE_IDS);
                    const truncado = !!token;
                    if (f.ordem === "antigos") {
                        st.ids = ids.reverse();
                    } else {
                        // Para métricas (views, curtidas, duração, título) precisa dos detalhes
                        const det = await detalhesDeVideos(ids);
                        if (minhaGeracao !== geracao) return;
                        st.ids = ordenarItens(det, f.ordem).map(v => v.id);
                    }
                    st.modo = "lista";
                    if (truncado) status.textContent = `Canal muito grande: ordenação aplicada aos ${LIMITE_IDS} vídeos mais recentes${f.ordem === "antigos" ? " (do mais antigo entre eles ao mais novo)" : ""}.`;
                }
                if (minhaGeracao !== geracao) return;
                await renderPagina(true);
            } catch (e) { if (minhaGeracao === geracao) { lista.innerHTML = ""; mostrarErroNoBloco(lista, e); } }
        };

        iniciar();
    }

    async function abaPlaylistsDoCanal(c) {
        const alvo = document.getElementById("guest-chan-body");
        alvo.innerHTML = barraFiltrosCanal("playlists");
        const lista = alvo.querySelector("#guest-chan-list");
        const status = alvo.querySelector("#guest-chan-status");
        const POR_PAGINA = 24;
        let todas = null;      // cache de todas as playlists do canal
        let filtradas = [];
        let cursor = 0;
        let geracao = 0;

        const lerFiltros = ligarBarraFiltros(alvo, () => aplicar());

        const mostrarMais = (primeira) => {
            const fatia = filtradas.slice(cursor, cursor + POR_PAGINA);
            cursor += fatia.length;
            const html = fatia.map(cardPlaylist).join("");
            if (primeira) lista.innerHTML = `<div class="guest-grid" id="guest-grid">${html || `<p class="guest-vazio">Nenhuma playlist encontrada.</p>`}</div>`;
            else document.getElementById("guest-grid").insertAdjacentHTML("beforeend", html);
            ligarCliquesDosCards(lista);
            gs.nextPageToken = cursor < filtradas.length ? "mais" : "";
            botaoCarregarMais(async () => mostrarMais(false));
        };

        const aplicar = async () => {
            const minhaGeracao = ++geracao;
            const f = lerFiltros();
            areaMais().innerHTML = "";
            try {
                if (!todas) {
                    lista.innerHTML = `<div class="guest-loading"><i class="fas fa-circle-notch fa-spin"></i> Carregando playlists...</div>`;
                    let acc = [], token = "", p = 0;
                    do {
                        const d = await ytApi("playlists", { part: "snippet,contentDetails", channelId: c.id, maxResults: 50, pageToken: token });
                        acc = acc.concat(d.items || []);
                        token = d.nextPageToken || "";
                    } while (token && ++p < 20);
                    todas = acc;
                }
                if (minhaGeracao !== geracao) return;
                const termoN = normalizar(f.termo);
                filtradas = ordenarItens(
                    todas.filter(p => !termoN || normalizar(p.snippet?.title).includes(termoN) || normalizar(p.snippet?.description).includes(termoN)),
                    f.ordem
                );
                status.textContent = f.termo ? `${filtradas.length} playlist(s) para "${f.termo}"` : (todas.length ? `${todas.length} playlist(s) no canal` : "");
                cursor = 0;
                if (!todas.length) { lista.innerHTML = `<p class="guest-vazio">Este canal não tem playlists públicas.</p>`; return; }
                mostrarMais(true);
            } catch (e) { lista.innerHTML = ""; mostrarErroNoBloco(lista, e); }
        };

        aplicar();
    }

    function abaSobreDoCanal(c) {
        const alvo = document.getElementById("guest-chan-body");
        areaMais().innerHTML = "";
        const st = c.statistics || {};
        alvo.innerHTML = `
            <div class="guest-about">
                <h3>Descrição</h3>
                <p class="guest-about-desc">${esc(decodificarHtml(c.snippet.description || "Sem descrição."))}</p>
                <h3>Estatísticas</h3>
                <ul class="guest-about-list">
                    <li><i class="fas fa-users"></i> ${st.subscriberCount ? numeroCompacto(st.subscriberCount) + " inscritos" : "Inscritos ocultos"}</li>
                    <li><i class="fas fa-video"></i> ${numeroCompacto(st.videoCount)} vídeos</li>
                    <li><i class="fas fa-eye"></i> ${numeroCompacto(st.viewCount)} visualizações</li>
                    <li><i class="fas fa-calendar"></i> Entrou em ${new Date(c.snippet.publishedAt).toLocaleDateString("pt-BR")}</li>
                    <li><i class="fas fa-globe"></i> ${esc(c.snippet.country || "País não informado")}</li>
                </ul>
            </div>`;
    }

    function mostrarErroNoBloco(alvo, e) {
        alvo.innerHTML = `<div class="guest-error"><i class="fas fa-triangle-exclamation"></i><p>${esc(e.message || e)}</p></div>`;
    }

    // ---------- playlist ----------

    async function abrirPlaylist(playlistId) {
        pararReproducao();
        gs.view = "playlist";
        empilhar({ tipo: "playlist", id: playlistId });
        window.scrollTo({ top: 0 });
        document.getElementById("guest-chips").classList.add("hidden");
        mostrarCarregando("Abrindo playlist...");
        try {
            const dp = await ytApi("playlists", { part: "snippet,contentDetails", id: playlistId });
            const p = (dp.items || [])[0];
            gs.nextPageToken = "";
            const cabecalho = p ? `
                <div class="guest-pl-head">
                    <img src="${esc(thumbDe(p.snippet))}" alt="${esc(decodificarHtml(p.snippet.title))}">
                    <div>
                        <h2>${esc(decodificarHtml(p.snippet.title))}</h2>
                        <span class="guest-card-channel" data-channel="${esc(p.snippet.channelId)}">${esc(decodificarHtml(p.snippet.channelTitle))}</span>
                        <span class="guest-card-meta">${p.contentDetails?.itemCount || 0} vídeos</span>
                        <button class="guest-locked guest-pl-save" data-guest-acao="salvar-playlist" data-yt-playlist="${esc(playlistId)}" data-yt-title="${esc(decodificarHtml(p.snippet.title))}" data-yt-thumb="${esc(thumbDe(p.snippet))}" data-guest-locked="salvar esta playlist no seu acervo"><i class="fas fa-plus"></i> Salvar no meu acervo</button>
                    </div>
                </div>` : "";
            conteudo().innerHTML = cabecalho + `<div class="guest-grid" id="guest-grid"></div>`;
            ligarCliquesDosCards(conteudo());

            const carregar = async (primeira) => {
                const d = await ytApi("playlistItems", {
                    part: "snippet,contentDetails", playlistId, maxResults: 24,
                    pageToken: primeira ? "" : gs.nextPageToken
                });
                gs.nextPageToken = d.nextPageToken || "";
                const ids = (d.items || []).map(i => i.contentDetails?.videoId).filter(Boolean).join(",");
                const det = ids ? (await ytApi("videos", { part: "snippet,statistics,contentDetails", id: ids })).items || [] : [];
                document.getElementById("guest-grid").insertAdjacentHTML("beforeend", det.map(cardVideo).join(""));
                ligarCliquesDosCards(document.getElementById("guest-grid"));
                botaoCarregarMais(() => carregar(false));
            };
            await carregar(true);
        } catch (e) { mostrarErro(e); }
    }
    window.abrirPlaylistGuest = abrirPlaylist;

    // ---------- vídeo (watch) ----------

    async function abrirVideo(videoId) {
        if (!videoId) return;
        gs.view = "watch";
        gs.contexto = { tipo: "watch", videoId };
        empilhar({ tipo: "watch", id: videoId });
        window.scrollTo({ top: 0 });
        document.getElementById("guest-chips").classList.add("hidden");
        mostrarCarregando("Abrindo vídeo...");
        try {
            const d = await ytApi("videos", { part: "snippet,statistics,contentDetails", id: videoId });
            const v = (d.items || [])[0];
            if (!v) throw new Error("Vídeo indisponível.");
            const s = v.snippet, st = v.statistics || {};
            const origem = encodeURIComponent(location.origin);

            conteudo().innerHTML = `
            <div class="guest-watch">
                <div class="guest-watch-main">
                    <div class="guest-player-box">
                        <iframe id="guest-watch-frame"
                            src="https://www.youtube.com/embed/${esc(videoId)}?autoplay=1&rel=0&playsinline=1&origin=${origem}"
                            title="${esc(decodificarHtml(s.title))}"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowfullscreen></iframe>
                    </div>
                    <h1 class="guest-watch-title">${esc(decodificarHtml(s.title))}</h1>
                    <div class="guest-watch-bar">
                        <div class="guest-watch-chan" data-channel="${esc(s.channelId)}">
                            <img id="guest-watch-chanpic" src="https://placehold.co/40x40?text=%20" alt="">
                            <div>
                                <strong>${esc(decodificarHtml(s.channelTitle))}</strong>
                                <span id="guest-watch-subs" class="guest-card-meta"></span>
                            </div>
                        </div>
                        <div class="guest-watch-actions">
                            <span class="guest-pill"><i class="fas fa-thumbs-up"></i> ${numeroCompacto(st.likeCount)}</span>
                            <button class="guest-pill guest-locked" data-guest-acao="favoritar" data-yt-id="${esc(videoId)}" data-yt-title="${esc(decodificarHtml(s.title))}" data-yt-thumb="${esc(thumbDe(s))}" data-guest-locked="favoritar este vídeo"><i class="fas fa-heart"></i> Favoritar</button>
                            <button class="guest-pill guest-locked" data-guest-acao="salvar-video" data-yt-id="${esc(videoId)}" data-yt-title="${esc(decodificarHtml(s.title))}" data-yt-thumb="${esc(thumbDe(s))}" data-guest-locked="salvar este vídeo no seu acervo"><i class="fas fa-plus"></i> Salvar</button>
                            <button class="guest-pill" id="guest-share"><i class="fas fa-share-nodes"></i> Compartilhar</button>
                        </div>
                    </div>
                    <div class="guest-watch-desc">
                        <span class="guest-card-meta">${numeroCompacto(st.viewCount)} visualizações · ${esc(tempoRelativo(s.publishedAt))} · ${esc(duracaoLegivel(v.contentDetails?.duration))}</span>
                        <p>${esc(decodificarHtml(s.description || "Sem descrição.")).replace(/\n/g, "<br>")}</p>
                    </div>
                    <div class="guest-comments">
                        <h3><i class="fas fa-comments"></i> Comentários</h3>
                        <div class="guest-comment-locked guest-locked" data-guest-acao="comentar" data-guest-locked="comentar neste vídeo">
                            <i class="fas fa-lock"></i> Entre com sua conta para comentar
                        </div>
                        <div id="guest-comment-compose"></div>
                        <div id="guest-comments-list"></div>
                    </div>
                </div>
                <aside class="guest-watch-side">
                    <h3>Relacionados</h3>
                    <div id="guest-related"></div>
                </aside>
            </div>`;
            ligarCliquesDosCards(conteudo());
            areaMais().innerHTML = "";

            document.getElementById("guest-share").onclick = async () => {
                const url = `https://www.youtube.com/watch?v=${videoId}`;
                try {
                    if (navigator.share) await navigator.share({ title: decodificarHtml(s.title), url });
                    else { await navigator.clipboard.writeText(url); uiAlert("Link copiado!"); }
                } catch (e) { }
            };

            montarComposerGuest();
            carregarAvatarDoCanal(s.channelId);
            carregarComentariosGuest(videoId);
            carregarRelacionados(s.title, videoId);
        } catch (e) { mostrarErro(e); }
    }
    window.abrirVideoGuest = abrirVideo;

    async function carregarAvatarDoCanal(channelId) {
        try {
            const d = await ytApi("channels", { part: "snippet,statistics", id: channelId });
            const c = (d.items || [])[0];
            if (!c) return;
            const img = document.getElementById("guest-watch-chanpic");
            if (img) img.src = thumbDe(c.snippet);
            const subs = document.getElementById("guest-watch-subs");
            if (subs && c.statistics?.subscriberCount) subs.innerText = `${numeroCompacto(c.statistics.subscriberCount)} inscritos`;
        } catch (e) { }
    }

    async function carregarComentariosGuest(videoId) {
        const alvo = document.getElementById("guest-comments-list");
        if (!alvo) return;
        alvo.innerHTML = `<div class="guest-loading"><i class="fas fa-circle-notch fa-spin"></i> Carregando comentários...</div>`;
        try {
            const d = await ytApi("commentThreads", { part: "snippet", videoId, maxResults: 20, order: "relevance", textFormat: "plainText" });
            const itens = d.items || [];
            if (!itens.length) { alvo.innerHTML = `<p class="guest-vazio">Nenhum comentário.</p>`; return; }
            alvo.innerHTML = itens.map(i => {
                const c = i.snippet.topLevelComment.snippet;
                return `
                <div class="guest-comment">
                    <img src="${esc(c.authorProfileImageUrl)}" alt="">
                    <div>
                        <strong>${esc(c.authorDisplayName)} <span class="guest-card-meta">${esc(tempoRelativo(c.publishedAt))}</span></strong>
                        <p>${esc(c.textDisplay).replace(/\n/g, "<br>")}</p>
                        <span class="guest-card-meta"><i class="fas fa-thumbs-up"></i> ${numeroCompacto(c.likeCount)}</span>
                    </div>
                </div>`;
            }).join("");
        } catch (e) {
            alvo.innerHTML = `<p class="guest-vazio">Os comentários estão desativados neste vídeo.</p>`;
        }
    }

    async function carregarRelacionados(titulo, videoIdAtual) {
        const alvo = document.getElementById("guest-related");
        if (!alvo) return;
        alvo.innerHTML = `<div class="guest-loading"><i class="fas fa-circle-notch fa-spin"></i></div>`;
        try {
            const termo = decodificarHtml(titulo).split(" ").slice(0, 6).join(" ");
            const d = await ytApi("search", { part: "snippet", q: termo, type: "video", maxResults: 15, regionCode: GUEST_REGION });
            const ids = (d.items || []).map(i => i.id?.videoId).filter(id => id && id !== videoIdAtual).join(",");
            const det = ids ? (await ytApi("videos", { part: "snippet,statistics,contentDetails", id: ids })).items || [] : [];
            alvo.innerHTML = det.map(v => `
                <div class="guest-rel" data-video="${esc(v.id)}">
                    <div class="guest-rel-thumb">
                        <img loading="lazy" src="${esc(thumbDe(v.snippet))}" alt="">
                        <span class="guest-dur">${esc(duracaoLegivel(v.contentDetails?.duration))}</span>
                    </div>
                    <div>
                        <h5>${esc(decodificarHtml(v.snippet.title))}</h5>
                        <span class="guest-card-meta">${esc(decodificarHtml(v.snippet.channelTitle))}</span>
                        <span class="guest-card-meta">${numeroCompacto(v.statistics?.viewCount)} visualizações</span>
                    </div>
                </div>`).join("") || `<p class="guest-vazio">Sem sugestões.</p>`;
            ligarCliquesDosCards(alvo);
        } catch (e) {
            alvo.innerHTML = `<p class="guest-vazio">Não foi possível carregar sugestões.</p>`;
        }
    }

    // ---------- inicialização do botão na tela de login ----------

    function prepararBotaoLogin() {
        const btn = document.getElementById("btn-guest-access");
        if (btn) btn.onclick = (e) => { e.preventDefault(); window.abrirModoGuest({ logado: false }); };

        // Link compartilhado do Mini YouTube (#/yt/...): abre direto, sem exigir login
        const stLink = estadoDoHash(location.hash);
        if (stLink) setTimeout(() => window.abrirModoGuest({ restaurar: false, estadoInicial: stLink }), 0);

        // Botões "Mini YouTube" da área logada (desktop no cabeçalho, mobile na engrenagem)
        document.addEventListener("click", (e) => {
            const alvo = e.target.closest("#btn-mini-youtube, #btn-mini-youtube-mobile");
            if (!alvo) return;
            e.preventDefault();
            document.getElementById("dropdown-menu-mobile")?.classList.add("hidden");
            window.abrirModoGuest({ logado: true });
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", prepararBotaoLogin);
    else prepararBotaoLogin();
})();


// ==========================================
// BOTÃO VOLTAR NATIVO (Android / iPhone) E VOLTAR DO NAVEGADOR (desktop)
// Cada toque em "voltar" desfaz a última ação dentro do app
// (fecha janelas, menus, player, retrocede telas) sem fechar o app.
// Também funciona com Alt+←, botão "voltar" do mouse e do navegador.
// ==========================================
(function instalarVoltarNativo() {
    const pilhaTelas = [];
    let restaurandoTela = false;

    const estadoAtual = () => ({ v: currentView, c: selectedCategory, s: selectedSubcategory });
    const iguais = (a, b) => a && b && a.v === b.v && a.c === b.c && a.s === b.s;

    // Registra o histórico de telas sempre que o mosaico é redesenhado
    if (typeof renderMosaic === "function") {
        const renderOriginal = renderMosaic;
        let ultimo = estadoAtual();
        renderMosaic = function () {
            const novo = estadoAtual();
            if (!restaurandoTela && !iguais(novo, ultimo)) {
                pilhaTelas.push(ultimo);
                if (pilhaTelas.length > 100) pilhaTelas.shift();
            }
            ultimo = novo;
            return renderOriginal.apply(this, arguments);
        };
        window.renderMosaic = renderMosaic;
    }

    function clicar(el) { if (el) { el.click(); return true; } return false; }

    function desfazerUltimaAcao() {
        // 1) Menu de compartilhamento
        const share = document.getElementById("share-sheet");
        if (share) { share.remove(); return true; }

        // 2) Aviso de login do modo visitante
        const aviso = document.getElementById("guest-login-required");
        if (aviso && !aviso.classList.contains("hidden")) { aviso.classList.add("hidden"); return true; }

        // 3) Janelas (modais) abertas — fecha a que está por cima
        const modais = Array.from(document.querySelectorAll(".modal-overlay, .profile-modal-overlay"))
            .filter(m => !m.classList.contains("hidden") && getComputedStyle(m).display !== "none");
        if (modais.length) {
            const topo = modais[modais.length - 1];
            if (!clicar(topo.querySelector(".btn-close, .profile-close-btn, [id^='btn-close'], [id^='btn-cancel']"))) topo.classList.add("hidden");
            return true;
        }

        // 4) Menu lateral aberto no celular
        const sidebar = document.getElementById("sidebar");
        if (sidebar && sidebar.classList.contains("open") && window.innerWidth <= 768) {
            const bd = document.getElementById("sidebar-backdrop");
            if (!clicar(bd)) sidebar.classList.remove("open");
            return true;
        }

        // 5) Mini YouTube / modo visitante
        const guest = document.getElementById("guest-container");
        if (guest && !guest.classList.contains("hidden")) {
            const voltarGuest = document.getElementById("guest-btn-back");
            if (voltarGuest && !voltarGuest.disabled) { voltarGuest.click(); return true; }
            const voltarApp = document.getElementById("guest-btn-voltar-app");
            if (voltarApp && getComputedStyle(voltarApp).display !== "none") { voltarApp.click(); return true; }
            return false;
        }

        // 6) Player aberto
        const fecharPlayer = document.getElementById("btn-close-player");
        if (fecharPlayer && fecharPlayer.offsetParent !== null) { fecharPlayer.click(); return true; }

        // 7) Telas anteriores (categorias > subcategorias > mídias > buscas)
        while (pilhaTelas.length) {
            const anterior = pilhaTelas.pop();
            if (iguais(anterior, estadoAtual())) continue;
            currentView = anterior.v; selectedCategory = anterior.c; selectedSubcategory = anterior.s;
            restaurandoTela = true;
            try { renderMosaic(); try { renderSidebar(); } catch (e) {} } finally { restaurandoTela = false; }
            return true;
        }
        return false;
    }

    // Mantém sempre uma entrada "guarda" no histórico para que o voltar
    // nativo nunca saia do app.
    try {
        history.replaceState({ streamhubBase: true }, "", location.href);
        history.pushState({ streamhubGuard: true }, "", location.href);
    } catch (e) {}

    window.addEventListener("popstate", function (ev) {
        // Endereço novo digitado/colado na barra: deixa as rotas tratarem
        // e recoloca a guarda por cima dele.
        if (!ev.state) {
            setTimeout(() => { try { history.pushState({ streamhubGuard: true }, "", location.href); } catch (e) {} }, 0);
            return;
        }
        if (!ev.state.streamhubBase) return;
        let desfez = false;
        try { desfez = desfazerUltimaAcao(); } catch (e) { console.warn("Voltar:", e); }
        if (desfez) {
            // A tela anterior já regravou o endereço; recoloca a guarda com ele
            try { history.pushState({ streamhubGuard: true }, "", location.href); } catch (e) {}
        } else {
            // Nada mais a desfazer: volta normalmente para a página anterior
            try { history.back(); } catch (e) {}
        }
    });
})();

// ==========================================
// PÁGINAS DE NAVEGAÇÃO (categoria, subcategoria, mídia) + ROTAS NA URL
// Cada tela ganha um endereço próprio (#/categoria/..., #/midia/...),
// um cabeçalho de página e as mídias podem ser abertas em página dedicada
// ou diretamente numa página do Mini YouTube.
// ==========================================
(function instalarPaginasDeNavegacao() {
    let midiaPagina = null;       // mídia exibida na página de mídia
    let rotaPendente = null;      // rota lida da URL antes dos dados chegarem
    let aplicandoRota = false;

    const enc = (t) => encodeURIComponent(t || "");
    const dec = (t) => { try { return decodeURIComponent(t || ""); } catch (e) { return t || ""; } };
    const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const nodo = (cat) => { try { return btoa(unescape(encodeURIComponent(cat))).replace(/=/g, ""); } catch (e) { return ""; } };

    function idYoutubeDaMidia(track) {
        const link = (track && track.link) || "";
        if (/videoseries|[?&]list=/.test(link) && !/embed\/[A-Za-z0-9_-]{11}/.test(link)) return null;
        try { return extractYoutubeId(link) || null; } catch (e) { return null; }
    }
    function idPlaylistDaMidia(track) {
        const link = (track && track.link) || "";
        try { return extractPlaylistId(link) || null; } catch (e) { return null; }
    }

    function midiasDaSub(cat, sub) {
        if (sub === "Vídeos Recentes" && currentPlaylist.length && currentPlaylist[0] && currentPlaylist[0].isDinâmico) return currentPlaylist.slice();
        return ordenarFaixas(database.filter((i) => i.categoria === cat && i.subcategoria === sub));
    }
    function capaCat(cat) {
        const m = database.find((i) => i.categoria === cat);
        const n = nodo(cat);
        return (m && m.capa) || (canaisDinamicos[n] && canaisDinamicos[n].thumb) || "";
    }

    // ---------- Mini YouTube ----------
    function abrirNoMiniYoutube(track) {
        const vid = idYoutubeDaMidia(track);
        const pl = idPlaylistDaMidia(track);
        if (!vid && !pl) { try { castAvisar("<b>Esta mídia não é do YouTube</b> — abrindo no player."); } catch (e) {} return false; }
        try { pausarReproducaoLocal(); } catch (e) {}
        const player = document.getElementById("btn-close-player");
        if (player && player.offsetParent !== null) { try { player.click(); } catch (e) {} }
        if (typeof window.abrirModoGuest !== "function") return false;
        window.abrirModoGuest({ logado: true, restaurar: false });
        setTimeout(() => {
            if (vid && typeof window.abrirVideoGuest === "function") window.abrirVideoGuest(vid);
            else if (pl && typeof window.abrirPlaylistGuest === "function") window.abrirPlaylistGuest(pl);
        }, 0);
        return true;
    }
    window.abrirMidiaNoMiniYoutube = abrirNoMiniYoutube;

    // ---------- Abrir mídia em página ----------
    function abrirMidiaEmPagina(track) {
        if (!track) return;
        midiaPagina = track;
        if (track.categoria) selectedCategory = track.categoria;
        if (track.subcategoria) selectedSubcategory = track.subcategoria;
        currentView = "media_page";
        renderMosaic();
        try { document.querySelector(".mosaic-container")?.scrollTo({ top: 0 }); window.scrollTo({ top: 0 }); } catch (e) {}
    }
    window.abrirMidiaEmPagina = abrirMidiaEmPagina;

    // ---------- Botões extras nos cartões de mídia ----------
    const createCardOriginal = createCard;
    createCard = function (title, imgSrc, showAddButton, isPlaylist, clickCallback, realIndex, shareInfo, favInfo) {
        const card = createCardOriginal.apply(this, arguments);
        const track = favInfo && favInfo.tipo === "midia" ? (favInfo.track || shareInfo) : null;
        if (track) {
            let linha = card.querySelector(".card-actions-row");
            if (!linha) { linha = document.createElement("div"); linha.className = "card-actions-row"; card.appendChild(linha); }
            const bPag = document.createElement("div");
            bPag.className = "page-open-badge"; bPag.title = "Abrir em página"; bPag.setAttribute("aria-label", "Abrir em página");
            bPag.innerHTML = '<i class="fas fa-up-right-from-square"></i>';
            bPag.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); abrirMidiaEmPagina(track); });
            linha.prepend(bPag);
            if (idYoutubeDaMidia(track) || idPlaylistDaMidia(track)) {
                const bYt = document.createElement("div");
                bYt.className = "page-open-badge yt"; bYt.title = "Abrir no Mini YouTube"; bYt.setAttribute("aria-label", "Abrir no Mini YouTube");
                bYt.innerHTML = '<i class="fab fa-youtube"></i>';
                bYt.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); abrirNoMiniYoutube(track); });
                bPag.after(bYt);
            }
        }
        return card;
    };
    window.createCard = createCard;

    // ---------- Cabeçalho das páginas ----------
    function heroEl() {
        let h = document.getElementById("page-hero");
        if (!h) {
            const grid = document.getElementById("mosaic-grid");
            if (!grid) return null;
            h = document.createElement("section");
            h.id = "page-hero"; h.className = "page-hero hidden";
            grid.parentNode.insertBefore(h, document.getElementById("sort-bar") || grid);
        }
        return h;
    }

    function desenharHero() {
        const h = heroEl(); if (!h) return;
        const sortBar = document.getElementById("sort-bar");
        if (sortBar) sortBar.classList.toggle("hidden", currentView === "media_page");
        if (currentView === "subcategories") {
            const subs = new Set(database.filter((i) => i.categoria === selectedCategory).map((i) => i.subcategoria));
            if (canaisDinamicos[nodo(selectedCategory)]) subs.add("Vídeos Recentes");
            const total = database.filter((i) => i.categoria === selectedCategory).length;
            h.innerHTML = `
                <div class="page-hero-cover" style="background-image:url('${esc(capaCat(selectedCategory))}')"></div>
                <div class="page-hero-info">
                    <span class="page-hero-kind"><i class="fas fa-folder-open"></i> Categoria</span>
                    <h2>${esc(selectedCategory)}</h2>
                    <p>${subs.size} subcategoria(s) · ${total} mídia(s)</p>
                    <div class="page-hero-actions"><button type="button" class="page-btn ghost" data-act="home"><i class="fas fa-arrow-left"></i> Início</button></div>
                </div>`;
            h.classList.remove("hidden");
        } else if (currentView === "tracks") {
            const lista = midiasDaSub(selectedCategory, selectedSubcategory);
            const m = lista[0];
            const capa = (m && m.capa) || capaCat(selectedCategory);
            h.innerHTML = `
                <div class="page-hero-cover" style="background-image:url('${esc(capa)}')"></div>
                <div class="page-hero-info">
                    <span class="page-hero-kind"><i class="fas fa-layer-group"></i> Subcategoria · <a href="#" data-act="cat">${esc(selectedCategory)}</a></span>
                    <h2>${esc(selectedSubcategory)}</h2>
                    <p>${selectedSubcategory === "Vídeos Recentes" ? "Vídeos mais recentes do canal" : lista.length + " mídia(s)"}</p>
                    <div class="page-hero-actions">
                        <button type="button" class="page-btn primary" data-act="playall"><i class="fas fa-play"></i> Reproduzir tudo</button>
                        <button type="button" class="page-btn ghost" data-act="cat"><i class="fas fa-arrow-left"></i> ${esc(selectedCategory)}</button>
                    </div>
                </div>`;
            h.classList.remove("hidden");
        } else {
            h.innerHTML = ""; h.classList.add("hidden");
        }
        h.querySelectorAll("[data-act]").forEach((el) => el.addEventListener("click", (e) => {
            e.preventDefault();
            const a = el.getAttribute("data-act");
            if (a === "home") { currentView = "categories"; selectedCategory = ""; selectedSubcategory = ""; renderMosaic(); try { renderSidebar(); } catch (er) {} }
            else if (a === "cat") { currentView = "subcategories"; selectedSubcategory = ""; renderMosaic(); }
            else if (a === "playall") {
                if (currentPlaylist.length) { currentTrackIndex = 0; playTrack(0); }
            }
        }));
    }

    // ---------- Página da mídia ----------
    function desenharPaginaDaMidia() {
        const grid = document.getElementById("mosaic-grid"); if (!grid || !midiaPagina) return;
        const t = midiaPagina;
        const bcCat = document.getElementById("bc-category"); const bcSub = document.getElementById("bc-subcategory");
        if (bcCat && t.categoria) { bcCat.classList.remove("hidden"); bcCat.querySelector(".txt").innerText = t.categoria; }
        if (bcSub && t.subcategoria) { bcSub.classList.remove("hidden"); bcSub.querySelector(".txt").innerText = t.subcategoria; }

        const lista = t.categoria ? midiasDaSub(t.categoria, t.subcategoria) : [t];
        let idx = lista.findIndex((i) => i.link === t.link && i.título === t.título);
        if (idx < 0) { lista.unshift(t); idx = 0; }
        const vid = idYoutubeDaMidia(t);
        const ehYt = !!(vid || idPlaylistDaMidia(t));
        let capa = t.capa || (vid ? thumbAltaPorId(vid) : "") || "https://placehold.co/640x360?text=Sem+Capa";
        let dur = ""; try { dur = formatarDuracao(duracaoDaFaixa(t)); } catch (e) {}
        const fav = (() => { try { return ehFavorito({ tipo: "midia", track: t }); } catch (e) { return false; } })();

        grid.innerHTML = `
        <article class="media-page">
            <div class="media-page-stage" data-act="play" title="Reproduzir">
                <img src="${esc(capa)}" alt="${esc(t.título)}"${vid ? atributoFallbackThumb(vid) : ""}>
                <span class="media-page-play"><i class="fas fa-play"></i></span>
                ${dur ? `<span class="duration-badge"><i class="fas fa-clock"></i> ${esc(dur)}</span>` : ""}
            </div>
            <div class="media-page-info">
                <span class="page-hero-kind"><i class="fas fa-photo-film"></i> Mídia${t.categoria ? ` · <a href="#" data-act="cat">${esc(t.categoria)}</a> › <a href="#" data-act="sub">${esc(t.subcategoria)}</a>` : ""}</span>
                <h2>${esc(t.título)}</h2>
                <div class="page-hero-actions">
                    <button type="button" class="page-btn primary" data-act="play"><i class="fas fa-play"></i> Reproduzir</button>
                    ${ehYt ? `<button type="button" class="page-btn yt" data-act="mini"><i class="fab fa-youtube"></i> Abrir no Mini YouTube</button>` : ""}
                    <button type="button" class="page-btn ghost" data-act="fav"><i class="${fav ? "fas" : "far"} fa-heart"></i> ${fav ? "Favoritado" : "Favoritar"}</button>
                    <button type="button" class="page-btn ghost" data-act="share"><i class="fas fa-share-nodes"></i> Compartilhar</button>
                    ${t.categoria ? `<button type="button" class="page-btn ghost" data-act="sub"><i class="fas fa-arrow-left"></i> Voltar</button>` : ""}
                </div>
            </div>
            ${lista.length > 1 ? `<h3 class="local-result-group-title media-page-more">Mais em ${esc(t.subcategoria || "")}</h3>` : ""}
        </article>`;

        const art = grid.querySelector(".media-page");
        art.querySelectorAll("[data-act]").forEach((el) => el.addEventListener("click", (e) => {
            e.preventDefault(); e.stopPropagation();
            const a = el.getAttribute("data-act");
            if (a === "play") { currentPlaylist = lista; playTrack(idx); }
            else if (a === "mini") abrirNoMiniYoutube(t);
            else if (a === "fav") { try { alternarFavorito({ tipo: "midia", track: t }); } catch (er) {} desenharPaginaDaMidia(); }
            else if (a === "share") compartilharMidia(t);
            else if (a === "cat") { selectedCategory = t.categoria; selectedSubcategory = ""; currentView = "subcategories"; renderMosaic(); }
            else if (a === "sub") { selectedCategory = t.categoria; selectedSubcategory = t.subcategoria; currentView = "tracks"; renderMosaic(); }
        }));

        lista.forEach((track, i) => {
            if (i === idx) return;
            const card = createCard(track.título, track.capa, false, false, () => abrirMidiaEmPagina(track), -1, track, { tipo: "midia", track });
            grid.appendChild(card);
        });
    }

    // ---------- Rotas (URL) ----------
    function rotaAtual() {
        if (currentView === "subcategories" && selectedCategory) return `#/categoria/${enc(selectedCategory)}`;
        if (currentView === "tracks" && selectedCategory) return `#/categoria/${enc(selectedCategory)}/${enc(selectedSubcategory)}`;
        if (currentView === "media_page" && midiaPagina) {
            const t = midiaPagina;
            return t.categoria ? `#/midia/${enc(t.categoria)}/${enc(t.subcategoria)}/${enc(t.link)}` : `#/midia/-/-/${enc(t.link)}`;
        }
        return "";
    }
    function gravarRota() {
        if (aplicandoRota) return;
        const destino = rotaAtual();
        const atual = location.hash || "";
        if (/^#\/yt/.test(atual) && document.body.classList.contains("guest-mode-on")) return;
        if (destino === atual || (!destino && !atual)) return;
        try { history.replaceState(history.state, "", location.pathname + location.search + destino); } catch (e) {}
    }
    function lerRota(hash) {
        const p = String(hash || "").replace(/^#\/?/, "").split("/");
        if (p[0] === "categoria" && p[1]) return { tipo: p[2] != null ? "sub" : "cat", c: dec(p[1]), s: dec(p[2]) };
        if (p[0] === "midia" && p[3]) return { tipo: "midia", c: dec(p[1]), s: dec(p[2]), l: dec(p.slice(3).join("/")) };
        return null;
    }
    function aplicarRota(r) {
        if (!r) return false;
        aplicandoRota = true;
        try {
            if (r.tipo === "cat") { selectedCategory = r.c; selectedSubcategory = ""; currentView = "subcategories"; }
            else if (r.tipo === "sub") { selectedCategory = r.c; selectedSubcategory = r.s; currentView = "tracks"; }
            else if (r.tipo === "midia") {
                const t = database.find((i) => i.link === r.l && (r.c === "-" || i.categoria === r.c)) || { título: "Mídia", link: r.l };
                midiaPagina = t; selectedCategory = t.categoria || ""; selectedSubcategory = t.subcategoria || ""; currentView = "media_page";
            }
        } finally { aplicandoRota = false; }
        renderMosaic();
        try { renderSidebar(); } catch (e) {}
        return true;
    }

    // ---------- Encaixe no renderMosaic ----------
    const renderAnterior = renderMosaic;
    renderMosaic = function () {
        const r = renderAnterior.apply(this, arguments);
        try {
            if (currentView === "media_page") desenharPaginaDaMidia();
            desenharHero();
            gravarRota();
        } catch (e) { console.warn("Páginas:", e); }
        return r;
    };
    window.renderMosaic = renderMosaic;

    // Restaura a rota da URL assim que o acervo carregar
    rotaPendente = lerRota(location.hash);
    const recarregarOriginal = recarregarDadosDoBanco;
    recarregarDadosDoBanco = async function () {
        const r = await recarregarOriginal.apply(this, arguments);
        if (rotaPendente) { const alvo = rotaPendente; rotaPendente = null; aplicarRota(alvo); }
        return r;
    };
    window.recarregarDadosDoBanco = recarregarDadosDoBanco;

    // Links colados/editados manualmente na barra de endereço
    window.addEventListener("hashchange", () => {
        const r = lerRota(location.hash);
        if (r && location.hash !== rotaAtual()) aplicarRota(r);
    });

    // Início sempre limpa a rota
    document.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest("#bc-home, #bc-root")) {
            setTimeout(gravarRota, 0);
        }
    }, true);
})();


/* ==========================================================================
   STREAMS / TRANSMISSÕES AO VIVO
   Detecta HLS (.m3u8), DASH (.mpd), FLV/MPEG-TS, rádios Icecast/Shoutcast,
   playlists .m3u/.pls e links sem extensão (sondagem de Content-Type).
   Mídias diretas sempre tocam no <video> interno — nunca em iframe —
   para evitar que celulares forcem o download do arquivo.
   ========================================================================== */
const streamEstado = { hls: null, dash: null, mpegts: null, token: 0, tentativas: 0, link: '', tipo: '', temVideo: null };

/* Rótulo do selo de formato:
   - Link com extensão de arquivo comum -> mostra a extensão (MP4, MP3, MKV...)
   - Extensões próprias de stream (m3u, m3u8, mpd, ts...) -> "VideoTS" ou "AudioTS"
   - Sem extensão -> "IPTV" (vídeo ao vivo) ou "RÁDIO" (áudio ao vivo) */
const EXT_STREAM = /^(m3u|m3u8|mpd|ts|m2ts|mts|flv|pls|xspf|ism|isml|asx|ram|f4m|smil)$/;
function _extensaoDoLink(url) {
    const limpa = _urlLimpa(url).replace(/\/manifest(\(.*\))?$/, '');
    const ultimo = limpa.split('/').pop() || '';
    const m = ultimo.match(/\.([a-z0-9]{1,5})$/);
    if (!m) return '';
    if (/^(html?|php|aspx?|jsp|cgi)$/.test(m[1])) return '';
    if (/^\d+$/.test(m[1])) return '';
    return m[1];
}
function rotuloFormatoStream(link, tipo, temVideo) {
    let ext = _extensaoDoLink(link);
    if (!ext && /[?&](type|format)=(m3u8|hls)/i.test(link || '')) ext = 'm3u8';
    if (!ext && /[?&](type|format)=(mpd|dash)/i.test(link || '')) ext = 'mpd';
    if (temVideo === null || temVideo === undefined) {
        // Palpite inicial até a mídia revelar se tem trilha de vídeo
        temVideo = tipo === 'radio' ? false : (tipo === 'playlist' && /^(pls|xspf|m3u)$/.test(ext)) ? false : (tipo !== 'radio');
    }
    if (ext && EXT_STREAM.test(ext)) return temVideo ? 'VideoTS' : 'AudioTS';
    if (ext) return ext.toUpperCase();
    return temVideo ? 'IPTV' : 'STREAM';
}
function _definirTemVideo(valor) {
    if (valor === null || valor === undefined || streamEstado.temVideo === valor) return;
    streamEstado.temVideo = valor;
    const fmt = document.getElementById('stream-badge-format');
    if (fmt) fmt.innerText = rotuloFormatoStream(streamEstado.link, streamEstado.tipo, valor);
    if (valor) { try { esconderPalcoDeAudio(); const c = document.getElementById('player-container'); if (c) c.classList.remove('audio-mode'); } catch (e) {} }
}
function _detectarVideoNoElemento(video) {
    if (!video) return;
    if (video.videoWidth > 0 || video.videoHeight > 0) return _definirTemVideo(true);
    if (video.readyState >= 1) _definirTemVideo(false);
}

function _urlLimpa(url) { return (url || '').split('#')[0].split('?')[0].trim().toLowerCase(); }

function detectarStream(url) {
    if (!url) return null;
    const u = url.trim().toLowerCase();
    const limpa = _urlLimpa(url);
    if (/\.m3u8$/.test(limpa) || /[?&](type|format)=(m3u8|hls)/.test(u) || /\/hls\//.test(limpa) || /\/playlist\.m3u8|manifest\(format=m3u8/.test(u)) return 'hls';
    if (/\.mpd$/.test(limpa) || /manifest\(format=mpd/.test(u) || /[?&](type|format)=(mpd|dash)/.test(u)) return 'dash';
    if (/\.isml?\/manifest$/.test(limpa)) return 'dash';
    if (/\.flv$/.test(limpa)) return 'flv';
    if (/\.ts$/.test(limpa) || /\.m2ts$/.test(limpa)) return 'mpegts';
    if (/\.(m3u|pls|xspf)$/.test(limpa)) return 'playlist';
    if (/^(rtmp|rtmps|rtsp|mms|mmsh):\/\//.test(u)) return 'protocolo';
    // Rádios Icecast/Shoutcast e afins
    if (/;stream|\/;$|\/stream(\/|$)|\/live(\/|$)|\/listen(\/|$)|\/radio(\/|$)|icecast|shoutcast|zeno\.fm|streamtheworld|radio\.co|\/autodj|:\d{4,5}\/?($|;|stream|live)/.test(u) && !/\.(mp4|mkv|webm|mp3|html?|php)$/.test(limpa)) return 'radio';
    return null;
}

// Links sem extensão de mídia conhecida e que não são páginas de serviços conhecidos
function linkPrecisaSondagem(url) {
    const u = (url || '').toLowerCase();
    if (!/^https?:\/\//.test(u)) return false;
    if (/youtube|youtu\.be|drive\.google|docs\.google|archive\.org|vimeo|dailymotion|twitch|facebook|instagram|tiktok|spotify|soundcloud|deezer/.test(u)) return false;
    const ext = extensaoDoArquivo(url);
    if (/^(html?|php|aspx?|jsp)$/.test(ext)) return false;
    return /^(mp4|m4v|webm|ogv|mov|3gp|mkv|avi|wmv)$/.test(ext) || ext === '' || ext.length > 5 || /download|media|video|file|stream|cdn|get/.test(u);
}

function pararStreamAtual() {
    streamEstado.token++;
    try { if (streamEstado.hls) streamEstado.hls.destroy(); } catch (e) {}
    try { if (streamEstado.dash) streamEstado.dash.reset(); } catch (e) {}
    try { if (streamEstado.mpegts) { streamEstado.mpegts.pause(); streamEstado.mpegts.unload(); streamEstado.mpegts.detachMediaElement(); streamEstado.mpegts.destroy(); } } catch (e) {}
    streamEstado.hls = streamEstado.dash = streamEstado.mpegts = null;
    streamEstado.link = ''; streamEstado.tipo = ''; streamEstado.temVideo = null;
    mostrarSeloStream(false);
    mostrarStatusStream(null);
    const c = document.getElementById('player-container'); if (c) c.classList.remove('stream-mode', 'stream-live');
}

function mostrarSeloStream(ativo, formato, aoVivo) {
    const selo = document.getElementById('stream-badge');
    const c = document.getElementById('player-container');
    if (!selo) return;
    if (!ativo) { selo.classList.add('hidden'); return; }
    selo.classList.remove('hidden');
    selo.classList.toggle('is-vod', aoVivo === false);
    document.getElementById('stream-badge-text').innerText = aoVivo === false ? 'STREAM' : 'AO VIVO';
    document.getElementById('stream-badge-format').innerText = streamEstado.link ? rotuloFormatoStream(streamEstado.link, streamEstado.tipo, streamEstado.temVideo) : (formato || '');
    if (c) { c.classList.add('stream-mode'); c.classList.toggle('stream-live', aoVivo !== false); }
}

function mostrarStatusStream(texto, erro) {
    const el = document.getElementById('stream-status');
    if (!el) return;
    if (!texto) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.classList.toggle('is-error', !!erro);
    el.innerHTML = (erro ? '<i class="fas fa-triangle-exclamation"></i> ' : '<i class="fas fa-circle-notch fa-spin"></i> ') + '<span></span>';
    el.querySelector('span').innerText = texto;
}

function _iniciarReproducao(video) {
    try { aplicarVolume(); } catch (e) {}
    const p = video.play();
    if (p && p.catch) p.catch(() => {
        // Autoplay bloqueado: tenta sem som e avisa
        video.muted = true;
        video.play().then(() => mostrarStatusStream('Toque no player para ativar o som', false)).catch(() => mostrarStatusStream('Toque em ▶ para iniciar a transmissão', false));
        setTimeout(() => mostrarStatusStream(null), 4000);
    });
}

function _prepararVideoStream(video, ehAudio, track) {
    const c = document.getElementById('player-container');
    video.classList.remove('hidden');
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
    video.setAttribute('autoplay', ''); video.preload = 'auto';
    video.crossOrigin = null; video.removeAttribute('crossorigin');
    if (ehAudio) {
        try { tocarPalcoStreamAudio(track); } catch (e) {}
    } else { esconderPalcoDeAudio(); if (c) c.classList.remove('audio-mode'); }
    video.onended = () => { if (!c || !c.classList.contains('stream-live')) avancarFaixa(); };
    video.onplaying = () => { mostrarStatusStream(null); streamEstado.tentativas = 0; _detectarVideoNoElemento(video); };
    video.onresize = () => _detectarVideoNoElemento(video);
    video.onwaiting = () => mostrarStatusStream('Carregando transmissão...');
    video.onloadedmetadata = () => {
        const aoVivo = !isFinite(video.duration) || video.duration === 0 || video.duration > 86400;
        _detectarVideoNoElemento(video);
        const selo = document.getElementById('stream-badge-format');
        mostrarSeloStream(true, selo ? selo.innerText : '', aoVivo);
    };
}

function tocarPalcoStreamAudio(track) {
    const container = document.getElementById('player-container');
    const palco = document.getElementById('audio-stage');
    if (container) container.classList.add('audio-mode');
    if (palco) palco.classList.remove('hidden');
    const t = document.getElementById('audio-title'); if (t) t.innerText = (track && track.título) || 'Rádio ao vivo';
    const a = document.getElementById('audio-artist'); if (a) a.innerText = 'Transmissão ao vivo';
    const capa = capaPadraoDoAudio(track); definirCapaDoAudio(capa);
    atualizarMetadadosDoSistema(track && track.título, 'Ao vivo', capa);
}

function _falhaStream(track, link, tipo, video, msg) {
    if (streamEstado.tentativas < 2) {
        streamEstado.tentativas++;
        mostrarStatusStream('Reconectando à transmissão (' + streamEstado.tentativas + ')...');
        const tk = streamEstado.token;
        setTimeout(() => { if (tk === streamEstado.token) tocarStream(track, link, tipo, video, true); }, 1500);
        return;
    }
    mostrarStatusStream(msg || 'Não foi possível reproduzir esta transmissão.', true);
}

async function tocarStream(track, link, tipo, video, ehRetentativa) {
    if (!video) return;
    if (!ehRetentativa) streamEstado.tentativas = 0;
    // limpa instâncias anteriores sem zerar contador
    const linkOrig = streamEstado.link, tipoOrig = streamEstado.tipo, videoOrig = streamEstado.temVideo;
    const tent = streamEstado.tentativas; pararStreamAtual(); streamEstado.tentativas = tent;
    if (ehRetentativa && linkOrig) { streamEstado.link = linkOrig; streamEstado.tipo = tipoOrig; streamEstado.temVideo = videoOrig; }
    else { streamEstado.link = link; streamEstado.tipo = tipo; streamEstado.temVideo = null; }
    const tk = streamEstado.token;
    const nomes = { hls: 'HLS', dash: 'DASH', flv: 'FLV', mpegts: 'MPEG-TS', radio: 'RADIO', playlist: 'PLAYLIST', protocolo: 'RTMP/RTSP', progressivo: 'DIRETO' };
    mostrarSeloStream(true, nomes[tipo] || 'STREAM', tipo === 'progressivo' ? false : true);
    mostrarStatusStream('Conectando à transmissão...');
    try { atualizarMetadadosDoSistema(track && track.título, 'Ao vivo', capaPadraoDoAudio(track)); } catch (e) {}

    if (tipo === 'protocolo') {
        video.classList.add('hidden');
        mostrarStatusStream('Protocolo RTMP/RTSP não é suportado por navegadores. Use a versão HLS (.m3u8) do link.', true);
        return;
    }

    if (tipo === 'playlist') {
        const real = await resolverPlaylist(link);
        if (tk !== streamEstado.token) return;
        if (!real) { mostrarStatusStream('Não foi possível ler a playlist da rádio.', true); return; }
        return tocarStream(track, real, detectarStream(real) || 'radio', video, true);
    }

    const ehAudio = tipo === 'radio';
    _prepararVideoStream(video, ehAudio, track);
    video.onerror = () => { if (tk === streamEstado.token) _falhaStream(track, link, tipo, video); };

    if (tipo === 'hls') {
        const nativo = video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL');
        if (window.Hls && window.Hls.isSupported()) {
            const hls = new window.Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 60, maxBufferLength: 30, manifestLoadingMaxRetry: 4, levelLoadingMaxRetry: 4, fragLoadingMaxRetry: 6 });
            streamEstado.hls = hls;
            hls.on(window.Hls.Events.MANIFEST_PARSED, (_, d) => {
                try {
                    const lv = (d && d.levels) || [];
                    if (lv.length) _definirTemVideo(lv.some(l => (l.width || l.height) || (l.videoCodec) || (l.attrs && l.attrs.RESOLUTION)) || (d.video === true));
                    if (lv.length && lv.every(l => !l.width && !l.videoCodec && l.audioCodec)) _definirTemVideo(false);
                } catch (e) {}
                _iniciarReproducao(video);
            });
            hls.on(window.Hls.Events.LEVEL_LOADED, (_, d) => { if (d && d.details) mostrarSeloStream(true, 'HLS', !!d.details.live); });
            hls.on(window.Hls.Events.ERROR, (_, d) => {
                if (!d || !d.fatal) return;
                if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR) { try { hls.recoverMediaError(); return; } catch (e) {} }
                if (d.type === window.Hls.ErrorTypes.NETWORK_ERROR && nativo) { try { hls.destroy(); } catch (e) {} streamEstado.hls = null; video.src = link; _iniciarReproducao(video); return; }
                _falhaStream(track, link, tipo, video, 'A transmissão está fora do ar ou bloqueia acesso externo.');
            });
            hls.loadSource(link); hls.attachMedia(video);
        } else if (nativo) {
            video.src = link; _iniciarReproducao(video);
        } else { video.src = link; _iniciarReproducao(video); }
        return;
    }

    if (tipo === 'dash') {
        if (window.dashjs && window.dashjs.supportsMediaSource && window.dashjs.supportsMediaSource()) {
            const p = window.dashjs.MediaPlayer().create();
            streamEstado.dash = p;
            p.updateSettings({ streaming: { lowLatencyEnabled: true, abr: { autoSwitchBitrate: { video: true } } } });
            p.on(window.dashjs.MediaPlayer.events.ERROR, () => { if (tk === streamEstado.token) _falhaStream(track, link, tipo, video); });
            p.on(window.dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => { try { _definirTemVideo((p.getTracksFor('video') || []).length > 0); mostrarSeloStream(true, 'DASH', p.isDynamic()); } catch (e) {} });
            p.initialize(video, link, true);
            _iniciarReproducao(video);
        } else { video.src = link; _iniciarReproducao(video); }
        return;
    }

    if (tipo === 'flv' || tipo === 'mpegts') {
        if (window.mpegts && window.mpegts.isSupported()) {
            const p = window.mpegts.createPlayer({ type: tipo === 'flv' ? 'flv' : 'mse', isLive: true, url: link }, { enableWorker: true, liveBufferLatencyChasing: true, lazyLoad: false });
            streamEstado.mpegts = p;
            p.on(window.mpegts.Events.ERROR, () => { if (tk === streamEstado.token) _falhaStream(track, link, tipo, video); });
            p.attachMediaElement(video); p.load();
            _iniciarReproducao(video);
        } else { video.src = link; _iniciarReproducao(video); }
        return;
    }

    // rádio / progressivo: elemento nativo
    video.src = link;
    try { video.load(); } catch (e) {}
    _iniciarReproducao(video);
}

async function resolverPlaylist(link) {
    try {
        const r = await fetch(link, { mode: 'cors' });
        const txt = await r.text();
        if (/^#EXTM3U[\s\S]*#EXT-X-/m.test(txt)) return link + (link.includes('#') ? '' : '#.m3u8');
        const linhas = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const l of linhas) {
            const m = l.match(/^File\d+=(.+)$/i); if (m) return m[1].trim();
            const x = l.match(/<location>(.+?)<\/location>/i); if (x) return x[1].trim();
            if (/^https?:\/\//i.test(l)) return l;
        }
    } catch (e) {}
    return null;
}

// Descobre o tipo real de um link sem extensão (Content-Type) e decide o player
async function sondarEReproduzir(track, link, video, iframe, index) {
    const tk = ++streamEstado.token;
    mostrarStatusStream('Analisando mídia...');
    let tipoConteudo = '';
    try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
        let r = await fetch(link, { method: 'HEAD', mode: 'cors', signal: ctrl.signal }).catch(() => null);
        if (!r || !r.ok) r = await fetch(link, { method: 'GET', headers: { Range: 'bytes=0-1' }, mode: 'cors', signal: ctrl.signal }).catch(() => null);
        clearTimeout(t);
        if (r) { tipoConteudo = (r.headers.get('content-type') || '').toLowerCase(); try { r.body && r.body.cancel && r.body.cancel(); } catch (e) {} }
    } catch (e) {}
    if (tk !== streamEstado.token || currentTrackIndex !== index) return;
    mostrarStatusStream(null);

    if (/mpegurl/.test(tipoConteudo)) return tocarStream(track, link, 'hls', video);
    if (/dash\+xml/.test(tipoConteudo)) return tocarStream(track, link, 'dash', video);
    if (/x-flv/.test(tipoConteudo)) return tocarStream(track, link, 'flv', video);
    if (/mp2t/.test(tipoConteudo)) return tocarStream(track, link, 'mpegts', video);
    if (/scpls|x-scpls/.test(tipoConteudo)) return tocarStream(track, link, 'playlist', video);
    if (/^audio\//.test(tipoConteudo)) {
        // Áudio contínuo sem tamanho = rádio
        return tocarStream(track, link, 'radio', video);
    }
    const ehVideoDireto = /^video\/|octet-stream|binary/.test(tipoConteudo) || /^(mp4|m4v|webm|ogv|mov|3gp|mkv)$/.test(extensaoDoArquivo(link));
    if (ehVideoDireto) {
        // Arquivo direto: reproduz no <video> (no iframe o celular baixaria o arquivo)
        mostrarSeloStream(false);
        esconderPalcoDeAudio();
        video.classList.remove('hidden');
        video.setAttribute('playsinline', ''); video.preload = 'auto';
        video.onerror = () => { video.classList.add('hidden'); if (iframe) { iframe.classList.remove('hidden'); iframe.src = link; } };
        video.onended = () => avancarFaixa();
        video.src = link; _iniciarReproducao(video);
        return;
    }
    if (/text\/html/.test(tipoConteudo) || !tipoConteudo) {
        // Página ou CORS bloqueado: tenta <video> primeiro; se falhar, usa iframe (página de player)
        if (!tipoConteudo) {
            let decidiu = false;
            video.classList.remove('hidden'); video.setAttribute('playsinline', '');
            video.onloadedmetadata = () => { decidiu = true; const vivo = !isFinite(video.duration); if (vivo) { streamEstado.link = link; streamEstado.tipo = ''; streamEstado.temVideo = (video.videoWidth > 0 || video.videoHeight > 0); mostrarSeloStream(true, '', true); } };
            video.onplaying = () => { decidiu = true; mostrarStatusStream(null); };
            video.onended = () => avancarFaixa();
            const usarIframe = () => { if (decidiu || tk !== streamEstado.token) return; decidiu = true; video.pause(); video.removeAttribute('src'); try { video.load(); } catch (e) {} video.classList.add('hidden'); if (iframe) { iframe.classList.remove('hidden'); iframe.src = link; } };
            video.onerror = usarIframe;
            setTimeout(usarIframe, 6000);
            video.src = link; _iniciarReproducao(video);
            return;
        }
        if (iframe) { iframe.classList.remove('hidden'); iframe.src = link; }
        return;
    }
    if (iframe) { iframe.classList.remove('hidden'); iframe.src = link; }
}


/* ==========================================================================
   BUSCA DENTRO DA CATEGORIA / SUBCATEGORIA (inclui canais vinculados)
   - Em uma categoria: encontra subcategorias e mídias (acervo + canal vinculado)
   - Em uma subcategoria: encontra apenas as mídias contidas nela
   ========================================================================== */
(function instalarBuscaNoEscopo() {
    let termo = "";
    let chaveEscopo = "";
    let timer = null;
    let token = 0;
    const cacheBuscaCanal = {};

    const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const canalDaCategoria = (cat) => (cat && canaisDinamicos) ? canaisDinamicos[codificarNodoCanal(cat)] : null;
    const chave = () => `${currentView}|${selectedCategory}|${selectedSubcategory}`;
    const escopoAtivo = () => currentView === "subcategories" || currentView === "tracks";

    function mapearVideo(item, cat) {
        const vid = (item.id && item.id.videoId) || (item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId);
        if (!vid) return null;
        return {
            título: item.snippet.title, link: `https://www.youtube.com/embed/${vid}`,
            capa: melhorThumbYoutube(item.snippet) || thumbAltaPorId(vid),
            categoria: cat, subcategoria: "Vídeos Recentes", isDinâmico: true
        };
    }

    // Busca no canal inteiro pela API; se falhar, filtra os envios recentes
    async function buscarNoCanal(canal, cat, q) {
        const k = `${canal.channelId || canal.uploadsPlaylistId}|${q}`;
        if (cacheBuscaCanal[k]) return cacheBuscaCanal[k];
        let lista = [];
        try {
            if (canal.channelId) {
                const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=25&order=relevance&channelId=${encodeURIComponent(canal.channelId)}&q=${encodeURIComponent(q)}&key=${CONFIG.YT_API_KEY}`);
                const d = await r.json();
                if (d && d.items) lista = d.items.map(i => mapearVideo(i, cat)).filter(Boolean);
            }
        } catch (e) {}
        if (!lista.length && canal.uploadsPlaylistId) {
            try {
                const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${canal.uploadsPlaylistId}&key=${CONFIG.YT_API_KEY}`);
                const d = await r.json();
                const nq = norm(q);
                if (d && d.items) lista = d.items.map(i => mapearVideo(i, cat)).filter(t => t && norm(t.título).includes(nq));
            } catch (e) {}
        }
        cacheBuscaCanal[k] = lista;
        return lista;
    }

    function barra() { return document.getElementById("scope-search-bar"); }
    function input() { return document.getElementById("scope-search-input"); }

    function atualizarBarra() {
        const b = barra(); const i = input(); if (!b || !i) return;
        const ativo = escopoAtivo();
        b.classList.toggle("hidden", !ativo);
        if (!ativo) return;
        const temCanal = !!canalDaCategoria(selectedCategory);
        if (currentView === "subcategories") {
            i.placeholder = `Buscar em "${selectedCategory}": subcategorias e mídias${temCanal ? " (inclui o canal vinculado)" : ""}`;
        } else {
            i.placeholder = selectedSubcategory === "Vídeos Recentes"
                ? `Buscar mídias no canal vinculado de "${selectedCategory}"`
                : `Buscar mídias em "${selectedSubcategory}"`;
        }
        const limpar = document.getElementById("scope-search-clear");
        if (limpar) limpar.classList.toggle("hidden", !termo);
    }

    function tituloGrupo(grid, texto) {
        const h = document.createElement("div"); h.className = "local-result-group-title"; h.innerText = texto; grid.appendChild(h); return h;
    }
    function aviso(grid, texto) {
        const h = document.createElement("h3"); h.className = "scope-search-empty"; h.innerText = texto; grid.appendChild(h); return h;
    }
    function cardMidia(track) {
        const idx = currentPlaylist.indexOf(track);
        const realIndex = track.isDinâmico ? -1 : database.findIndex(d => d.link === track.link && d.título === track.título);
        return createCard(track.título, track.capa, false, false, () => { playTrack(idx); }, realIndex, track, { tipo: "midia", track });
    }

    async function desenharResultados() {
        const grid = document.getElementById("mosaic-grid"); if (!grid) return;
        const meu = ++token;
        const q = norm(termo);
        const cat = selectedCategory; const sub = selectedSubcategory;
        const canal = canalDaCategoria(cat);
        grid.innerHTML = "";

        if (currentView === "subcategories") {
            const subs = [...new Set(database.filter(i => i.categoria === cat).map(i => i.subcategoria))].filter(Boolean);
            if (canal && !subs.includes("Vídeos Recentes")) subs.push("Vídeos Recentes");
            const subsAchadas = ordenarNomes(subs.filter(s => norm(s).includes(q)));
            const midias = ordenarFaixas(database.filter(i => i.categoria === cat && norm(i.título || i.titulo).includes(q)));
            currentPlaylist = midias.slice();
            garantirDuracoes(currentPlaylist);

            if (subsAchadas.length) {
                tituloGrupo(grid, `Subcategorias (${subsAchadas.length})`);
                subsAchadas.forEach(s => {
                    const m = database.find(i => i.categoria === cat && i.subcategoria === s);
                    const capa = m ? m.capa : (canal ? canal.thumb : "");
                    grid.appendChild(createCard(s, capa, false, false, () => { selectedSubcategory = s; currentView = "tracks"; renderMosaic(); }, -1, null, { tipo: "subcategoria", categoria: cat, subcategoria: s }));
                });
            }
            if (midias.length) {
                tituloGrupo(grid, `Mídias (${midias.length})`);
                midias.forEach(t => grid.appendChild(cardMidia(t)));
            }
            if (canal) {
                const titulo = tituloGrupo(grid, `Canal vinculado: ${canal.title || cat} (buscando...)`);
                const lista = await buscarNoCanal(canal, cat, termo);
                if (meu !== token) return;
                titulo.innerText = `Canal vinculado: ${canal.title || cat} (${lista.length})`;
                lista.forEach(t => { currentPlaylist.push(t); grid.appendChild(cardMidia(t)); });
                if (!lista.length && !midias.length && !subsAchadas.length) aviso(grid, `Nada encontrado em "${cat}" para "${termo}".`);
            } else if (!midias.length && !subsAchadas.length) {
                aviso(grid, `Nada encontrado em "${cat}" para "${termo}".`);
            }
            return;
        }

        if (currentView === "tracks") {
            let lista;
            if (sub === "Vídeos Recentes" && canal) {
                const h = aviso(grid, "Buscando no canal vinculado...");
                lista = await buscarNoCanal(canal, cat, termo);
                if (meu !== token) return;
                h.remove();
            } else {
                lista = ordenarFaixas(database.filter(i => i.categoria === cat && i.subcategoria === sub && norm(i.título || i.titulo).includes(q)));
            }
            currentPlaylist = lista.slice();
            garantirDuracoes(currentPlaylist);
            if (!lista.length) { aviso(grid, `Nenhuma mídia em "${sub}" para "${termo}".`); return; }
            tituloGrupo(grid, `Mídias (${lista.length})`);
            lista.forEach(t => grid.appendChild(cardMidia(t)));
        }
    }

    // Enquanto houver busca ativa, o feed de "Vídeos Recentes" não sobrescreve os resultados
    const feedOriginal = buscarVideosRecentesDoCanal;
    buscarVideosRecentesDoCanal = function () {
        if (termo && escopoAtivo()) return Promise.resolve();
        return feedOriginal.apply(this, arguments);
    };

    const renderAnterior = renderMosaic;
    renderMosaic = function () {
        const k = chave();
        if (k !== chaveEscopo) {
            chaveEscopo = k; termo = ""; token++;
            const i = input(); if (i) i.value = "";
        }
        const r = renderAnterior.apply(this, arguments);
        atualizarBarra();
        if (termo && escopoAtivo()) desenharResultados();
        return r;
    };
    window.renderMosaic = renderMosaic;

    function aoDigitar() {
        termo = (input()?.value || "").trim();
        clearTimeout(timer);
        timer = setTimeout(() => {
            atualizarBarra();
            if (termo) desenharResultados(); else { token++; renderAnterior(); atualizarBarra(); }
        }, 300);
    }

    function ligar() {
        const i = input(); if (!i || i.dataset.ligado) return;
        i.dataset.ligado = "1";
        i.addEventListener("input", aoDigitar);
        i.addEventListener("keydown", (e) => { if (e.key === "Escape") { i.value = ""; aoDigitar(); } });
        document.getElementById("scope-search-clear")?.addEventListener("click", () => { i.value = ""; aoDigitar(); i.focus(); });
        atualizarBarra();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligar); else ligar();
})();


/* ==========================================================================
   PLAYER ADAPTÁVEL: aspecto da mídia, tamanhos (P/M/G) e botões responsivos
   ========================================================================== */
(function instalarPlayerAdaptavel() {
    const TAMANHOS = { auto: { rotulo: "Automático", tag: "A", largura: null }, pequeno: { rotulo: "Pequeno", tag: "P", largura: 420 }, medio: { rotulo: "Médio", tag: "M", largura: 760 }, grande: { rotulo: "Grande", tag: "G", largura: 1180 } };
    const ORDEM = ["auto", "pequeno", "medio", "grande"];
    let tamanho = "auto";
    try { tamanho = localStorage.getItem("streamhub_player_tamanho") || "auto"; } catch (e) {}
    if (!TAMANHOS[tamanho]) tamanho = "auto";
    let aspecto = 16 / 9;
    const cacheAspecto = {};

    const P = () => document.getElementById("player-container");
    const ehMobile = () => window.innerWidth <= 768;

    function aplicarAspecto(valor) {
        if (!valor || !isFinite(valor)) valor = 16 / 9;
        aspecto = Math.min(Math.max(valor, 0.35), 3);
        const p = P(); if (p) p.style.setProperty("--player-ar", String(aspecto));
        ajustarTamanho();
    }

    function ajustarTamanho() {
        const p = P(); if (!p || p.classList.contains("hidden")) return;
        if (ehMobile() || p.classList.contains("player-free") || p.classList.contains("with-comments")) { ajustarModoCompactoPlayer(); return; }
        const header = p.querySelector(".player-header");
        const alturaHeader = header ? header.offsetHeight : 50;
        const maxW = window.innerWidth - 32;
        const maxH = window.innerHeight - alturaHeader - 48;
        const alvo = TAMANHOS[tamanho].largura || Math.min(window.innerWidth * 0.8, 1250);
        const largura = Math.max(260, Math.min(alvo, maxW, maxH * aspecto));
        p.style.setProperty("width", Math.round(largura) + "px", "important");
        p.style.setProperty("min-width", "0", "important");
        p.style.setProperty("max-width", "none", "important");
        ajustarModoCompactoPlayer();
    }

    function atualizarBotaoTamanho() {
        const b = document.getElementById("btn-player-size"); if (!b) return;
        const t = TAMANHOS[tamanho];
        b.dataset.label = t.rotulo;
        b.title = `Tamanho do player: ${t.rotulo} (clique para trocar)`;
        const tag = b.querySelector(".player-size-tag"); if (tag) tag.textContent = t.tag;
    }

    function trocarTamanho() {
        tamanho = ORDEM[(ORDEM.indexOf(tamanho) + 1) % ORDEM.length];
        try { localStorage.setItem("streamhub_player_tamanho", tamanho); } catch (e) {}
        const p = P();
        if (p) {
            // Volta para a posição central e aplica o tamanho escolhido
            p.classList.remove("player-free");
            ["left", "top", "height", "bottom", "right"].forEach(k => p.style.removeProperty(k));
        }
        atualizarBotaoTamanho();
        ajustarTamanho();
    }

    // Botões do cabeçalho: vão para os três pontos quando não cabem na largura do player
    ajustarModoCompactoPlayer = function () {
        const p = P();
        const header = p?.querySelector(".player-header");
        const grupo = p?.querySelector(".player-controls-group");
        if (!header || !grupo) return;
        let compacto = ehMobile();
        if (!compacto && p.offsetWidth > 0) {
            const estavaAberto = grupo.classList.contains("menu-open");
            header.classList.remove("compact-mode");
            const fechar = document.getElementById("btn-close-player");
            const necessario = grupo.scrollWidth + (fechar && fechar.parentElement !== grupo ? fechar.offsetWidth + 12 : 0) + 140;
            compacto = header.clientWidth < necessario;
            if (estavaAberto && compacto) grupo.classList.add("menu-open");
        }
        header.classList.toggle("compact-mode", compacto);
        if (!compacto) grupo.classList.remove("menu-open");
    };
    window.ajustarModoCompactoPlayer = ajustarModoCompactoPlayer;

    async function detectarAspectoDaFaixa(track) {
        const link = (track && track.link) || "";
        if (/\/shorts\//i.test(link)) { aplicarAspecto(9 / 16); return; }
        const vid = extractYoutubeId(link);
        if (!vid || /list=/.test(link) && !/embed\/[^?]/.test(link)) { aplicarAspecto(16 / 9); return; }
        if (cacheAspecto[vid]) { aplicarAspecto(cacheAspecto[vid]); return; }
        aplicarAspecto(16 / 9);
        try {
            const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=player&maxWidth=1280&id=${vid}&key=${CONFIG.YT_API_KEY}`);
            const d = await r.json();
            const pl = d && d.items && d.items[0] && d.items[0].player;
            if (pl && pl.embedWidth && pl.embedHeight) {
                cacheAspecto[vid] = Number(pl.embedWidth) / Number(pl.embedHeight);
                const atual = currentPlaylist[currentTrackIndex];
                if (atual && extractYoutubeId(atual.link || "") === vid) aplicarAspecto(cacheAspecto[vid]);
            }
        } catch (e) {}
    }

    const tocarAnterior = playTrack;
    playTrack = function (index) {
        const r = tocarAnterior.apply(this, arguments);
        try { detectarAspectoDaFaixa(currentPlaylist[index]); } catch (e) {}
        setTimeout(ajustarTamanho, 60);
        return r;
    };
    window.playTrack = playTrack;

    function ligar() {
        const p = P(); if (!p) return;
        atualizarBotaoTamanho();
        p.style.setProperty("--player-ar", String(aspecto));

        const video = document.getElementById("raw-player");
        if (video) {
            const lerVideo = () => {
                if (video.videoWidth > 0 && video.videoHeight > 0) aplicarAspecto(video.videoWidth / video.videoHeight);
                else aplicarAspecto(16 / 9);
            };
            video.addEventListener("loadedmetadata", lerVideo);
            video.addEventListener("resize", lerVideo);
        }

        document.addEventListener("click", (e) => {
            if (e.target.closest && e.target.closest("#btn-player-size")) { e.preventDefault(); e.stopPropagation(); trocarTamanho(); }
        }, true);

        // Botões acompanham o tamanho real do player (inclusive ao redimensionar arrastando)
        if (window.ResizeObserver) {
            let quadro = 0;
            new ResizeObserver(() => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(ajustarModoCompactoPlayer); }).observe(p);
        }
        new MutationObserver(() => setTimeout(ajustarTamanho, 30)).observe(p, { attributes: true, attributeFilter: ["class"] });
        let t = null;
        window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(ajustarTamanho, 120); });
        ajustarTamanho();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligar); else ligar();
})();

// ==========================================
// COMUNIDADE: MINI REDE SOCIAL (feed, amizades e chat ao vivo)
// Usa o Realtime Database em tempo real (firebase-database-compat).
// Estrutura: comunidade/perfis, posts, pedidos, amigos, chats
// ==========================================
(function moduloComunidade() {
    const C = { uid: null, db: null, perfil: {}, perfis: {}, amigos: {}, pedidos: {}, enviados: {}, aba: "feed", chatCom: null, ouvintes: [], ouvinteChat: null, midia: null };
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const avatar = (p) => (p && p.foto) || "https://placehold.co/80x80/222222/ffffff?text=%F0%9F%91%A4";
    const nomeDe = (uid) => (C.perfis[uid] && C.perfis[uid].nome) || "Usuário";
    const tempo = (t) => { const d = (Date.now() - t) / 1000; if (d < 60) return "agora"; if (d < 3600) return Math.floor(d / 60) + " min"; if (d < 86400) return Math.floor(d / 3600) + " h"; return new Date(t).toLocaleDateString("pt-BR"); };
    const ref = (p) => C.db.ref("comunidade/" + p);
    const idChat = (a, b) => [a, b].sort().join("_");

    function ouvir(r, ev, fn) { r.on(ev, fn); C.ouvintes.push(() => r.off(ev, fn)); }

    async function iniciar(user) {
        // O botão fica sempre visível; sem login, o clique pede para entrar.
        document.querySelectorAll(".btn-comunidade-trigger").forEach((b) => b.classList.remove("hidden"));
        if (!firebase.database) { console.warn("Comunidade: SDK do Realtime Database não carregado."); return; }
        C.ouvintes.forEach((f) => f()); C.ouvintes = [];
        C.uid = user ? user.uid : null;
        if (!user) { fechar(); return; }
        C.db = firebase.database();
        // Publica um perfil público mínimo (nome + foto) para a comunidade
        try {
            const snap = await C.db.ref("usuarios/" + C.uid).once("value");
            const p = snap.val() || {};
            C.perfil = { nome: ((p.nome || user.displayName || (user.email || "").split("@")[0] || "Usuário") + (p.sobrenome ? " " + p.sobrenome : "")).trim(), foto: p.foto || user.photoURL || "", cidade: p.cidade || "", atualizado: Date.now() };
        } catch (e) { C.perfil = { nome: user.displayName || (user.email || "Usuário").split("@")[0], foto: user.photoURL || "", atualizado: Date.now() }; }
        ref("perfis/" + C.uid).update(C.perfil).catch((e) => console.warn("Comunidade perfil:", e));
        const online = ref("online/" + C.uid);
        online.set(true).catch(() => {}); online.onDisconnect().remove();

        ouvir(ref("perfis"), "value", (s) => { C.perfis = s.val() || {}; renderizar(); });
        ouvir(ref("amigos/" + C.uid), "value", (s) => { C.amigos = s.val() || {}; renderizar(); });
        ouvir(ref("pedidos/" + C.uid), "value", (s) => { C.pedidos = s.val() || {}; atualizarBadge(); renderizar(); });
        ouvir(ref("enviados/" + C.uid), "value", (s) => { C.enviados = s.val() || {}; renderizar(); });
        ouvir(ref("online"), "value", (s) => { C.online = s.val() || {}; renderizar(); });
        ouvir(ref("posts").orderByChild("criado").limitToLast(60), "value", (s) => { C.posts = s.val() || {}; renderizar(); });
    }

    function atualizarBadge() {
        const n = Object.keys(C.pedidos || {}).length;
        document.querySelectorAll(".comunidade-badge").forEach((b) => { b.textContent = n; b.classList.toggle("hidden", !n); });
    }

    function abrir() {
        $("dropdown-menu-mobile")?.classList.add("hidden");
        if (!C.uid) {
            const u = firebase.auth().currentUser;
            if (u) { iniciar(u).then(() => C.uid && abrir()); return; }
            uiAlert("Entre na sua conta para acessar a Comunidade.");
            return;
        } $("comunidade-screen").classList.remove("hidden"); document.body.classList.add("comunidade-aberta"); $("dropdown-menu-mobile")?.classList.add("hidden"); trocarAba(C.aba); }
    function fechar() { $("comunidade-screen")?.classList.add("hidden"); document.body.classList.remove("comunidade-aberta"); fecharChat(); }

    function trocarAba(aba) {
        C.aba = aba;
        document.querySelectorAll(".com-tab").forEach((t) => t.classList.toggle("active", t.dataset.aba === aba));
        document.querySelectorAll(".com-painel").forEach((p) => p.classList.toggle("hidden", p.id !== "com-painel-" + aba));
        renderizar();
    }

    function renderizar() {
        if (!C.uid || $("comunidade-screen")?.classList.contains("hidden")) return;
        if (C.aba === "feed") renderFeed();
        if (C.aba === "pessoas") renderPessoas();
        if (C.aba === "amigos") renderAmigos();
    }

    /* ---------- AVATAR DE COMENTÁRIO (foto ou iniciais em cor RGB aleatória) ---------- */
    const coresAvatar = {};
    function corAleatoria(uid) {
        if (coresAvatar[uid]) return coresAvatar[uid];
        const salvas = JSON.parse(localStorage.getItem("com_cores_avatar") || "{}");
        if (!salvas[uid]) {
            const r = () => 40 + Math.floor(Math.random() * 176);
            salvas[uid] = `rgb(${r()}, ${r()}, ${r()})`;
            try { localStorage.setItem("com_cores_avatar", JSON.stringify(salvas)); } catch (e) {}
        }
        return (coresAvatar[uid] = salvas[uid]);
    }
    function iniciais(nome) {
        const partes = String(nome || "U").trim().split(/\s+/).filter(Boolean);
        return ((partes[0] || "U")[0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
    }
    function avatarMini(uid) {
        const p = C.perfis[uid] || {};
        if (p.foto) return `<img class="com-avatar-mini" src="${esc(p.foto)}" alt="" onerror="this.outerHTML='<span class=&quot;com-avatar-mini com-avatar-iniciais&quot; style=&quot;background:${corAleatoria(uid)}&quot;>${esc(iniciais(p.nome))}</span>'">`;
        return `<span class="com-avatar-mini com-avatar-iniciais" style="background:${corAleatoria(uid)}">${esc(iniciais(p.nome))}</span>`;
    }

    /* ---------- EMOJIS ---------- */
    const EMOJIS = {
        "Carinhas": "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 😎 🤓 🥳 😏 😒 😔 😢 😭 😤 😠 😡 🤯 😳 🥺 😱 🤔 🤫 🤭 😴 🤤 😷 🤒 🤠 🤡 👻 💀 👽 🤖 💩",
        "Gestos": "👍 👎 👏 🙌 🙏 🤝 👌 🤌 ✌️ 🤞 🤟 🤘 👊 ✊ 💪 👋 ☝️ 👆 👇 👉 👈 ✍️ 🫶",
        "Corações": "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💥 💫 ✨ 🔥 ⭐ 🌟",
        "Mídia": "🎬 🎥 📺 📹 🎞️ 🍿 🎵 🎶 🎤 🎧 🎸 🎹 🥁 🎷 🎺 🎻 📻 🎮 🕹️ 📱 💻 📷 📸 🎙️ 📀 💿",
        "Diversos": "🎉 🎊 🎁 🏆 ⚽ 🏀 🎯 🚀 ✈️ 🚗 🏠 🌍 🌈 ☀️ 🌙 ⚡ ☔ ❄️ 🌹 🌻 🍕 🍔 🍟 🍫 🍰 ☕ 🍺 🐶 🐱 🦁 🐵 🦄 ✅ ❌ ⚠️ ❓ ❗ 🆕 🆗"
    };
    function montarEmojis() {
        const el = $("com-emojis"); if (el.dataset.ok) return; el.dataset.ok = "1";
        el.innerHTML = Object.entries(EMOJIS).map(([cat, lista]) => `<div class="com-emoji-cat">${cat}</div>` + lista.split(" ").map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")).join("");
    }
    function inserirEmoji(e) {
        const ta = $("com-post-texto"), ini = ta.selectionStart ?? ta.value.length, fim = ta.selectionEnd ?? ta.value.length;
        ta.value = ta.value.slice(0, ini) + e + ta.value.slice(fim);
        ta.focus(); ta.selectionStart = ta.selectionEnd = ini + e.length;
    }

    /* ---------- PAINÉIS DO FORMULÁRIO ---------- */
    function alternarPainel(id) {
        ["com-emojis", "com-yt-painel", "com-minhas-painel"].forEach((p) => { if (p !== id) $(p).classList.add("hidden"); });
        const el = $(id); el.classList.toggle("hidden");
        return !el.classList.contains("hidden");
    }
    function fecharPaineis() { ["com-emojis", "com-yt-painel", "com-minhas-painel"].forEach((p) => $(p)?.classList.add("hidden")); }
    function mostrarPrevia(m) {
        C.midia = m; $("com-post-link").value = ""; $("com-post-link").classList.add("hidden");
        const rotulo = m.tipo === "colecao" ? ({ midia: "Mídia", subcategoria: "Subcategoria", categoria: "Categoria" }[m.nivel] + ` · ${m.itens.length} mídia(s)`) : "Vídeo do YouTube";
        $("com-preview").innerHTML = `<div class="com-previa-midia">${m.capa ? `<img src="${esc(m.capa)}" alt="">` : ""}<span><strong>${esc(m.titulo)}</strong><br><small>${esc(rotulo)}</small></span><button type="button" class="btn-icon" id="com-tirar-midia"><i class="fas fa-times"></i></button></div>`;
        fecharPaineis();
    }

    /* ---------- MINI BUSCA NO YOUTUBE ---------- */
    C.ytResultados = [];
    async function buscarYoutube() {
        const termo = $("com-yt-termo").value.trim(), el = $("com-yt-resultados");
        if (!termo) return;
        el.innerHTML = `<p class="com-vazio"><i class="fas fa-spinner fa-spin"></i> Buscando...</p>`;
        try {
            const chave = (typeof CONFIG !== "undefined" && CONFIG.YT_API_KEY) || YT_API_KEY_GLOBAL;
            const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(termo)}&key=${chave}`);
            const j = await r.json();
            if (!r.ok) throw new Error((j.error && j.error.message) || "Erro na busca");
            C.ytResultados = (j.items || []).filter((i) => i.id && i.id.videoId).map((i) => ({ id: i.id.videoId, titulo: i.snippet.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"), canal: i.snippet.channelTitle, capa: (i.snippet.thumbnails.high || i.snippet.thumbnails.medium || i.snippet.thumbnails.default || {}).url || "" }));
            el.innerHTML = C.ytResultados.length ? C.ytResultados.map((v, n) => `<button type="button" class="com-resultado" data-ytpick="${n}"><img src="${esc(v.capa)}" alt="" loading="lazy"><span><strong>${esc(v.titulo)}</strong><small>${esc(v.canal)}</small></span></button>`).join("") : `<p class="com-vazio">Nenhum vídeo encontrado.</p>`;
        } catch (err) { el.innerHTML = `<p class="com-vazio">Não foi possível buscar no YouTube agora.</p>`; console.error(err); }
    }

    /* ---------- MINHAS MÍDIAS ---------- */
    const acervo = () => (typeof database !== "undefined" && Array.isArray(database) ? database : []);
    const limparItem = (i) => ({ "título": i["título"] || i.titulo || "", link: i.link || "", capa: i.capa || "", categoria: i.categoria || "", subcategoria: i.subcategoria || "" });
    function buscarMinhas() {
        const termo = ($("com-minhas-termo").value || "").trim().toLowerCase(), el = $("com-minhas-resultados"), db = acervo();
        if (!db.length) { el.innerHTML = `<p class="com-vazio">Seu acervo está vazio.</p>`; return; }
        const bate = (s) => !termo || String(s || "").toLowerCase().includes(termo);
        C.minhasOpcoes = [];
        const cats = [...new Set(db.map((i) => i.categoria).filter(Boolean))].filter(bate);
        const subs = []; const vistos = new Set();
        db.forEach((i) => { const k = i.categoria + "||" + i.subcategoria; if (i.subcategoria && !vistos.has(k) && bate(i.subcategoria)) { vistos.add(k); subs.push({ categoria: i.categoria, subcategoria: i.subcategoria }); } });
        const midias = db.filter((i) => bate(i["título"]));
        let html = "";
        const opcao = (o, icone, sub) => { C.minhasOpcoes.push(o); return `<button type="button" class="com-resultado" data-minhapick="${C.minhasOpcoes.length - 1}">${o.capa ? `<img src="${esc(o.capa)}" alt="" loading="lazy">` : `<span class="com-res-icone"><i class="${icone}"></i></span>`}<span><strong>${esc(o.titulo)}</strong><small>${esc(sub)}</small></span></button>`; };
        if (cats.length) { html += `<div class="com-res-grupo">Categorias</div>`; cats.slice(0, 20).forEach((c) => { const itens = db.filter((i) => i.categoria === c); html += opcao({ nivel: "categoria", titulo: c, capa: (itens.find((i) => i.capa) || {}).capa || "", itens }, "fas fa-folder", `${itens.length} mídia(s)`); }); }
        if (subs.length) { html += `<div class="com-res-grupo">Subcategorias</div>`; subs.slice(0, 30).forEach((s) => { const itens = db.filter((i) => i.categoria === s.categoria && i.subcategoria === s.subcategoria); html += opcao({ nivel: "subcategoria", titulo: s.subcategoria, categoria: s.categoria, capa: (itens.find((i) => i.capa) || {}).capa || "", itens }, "fas fa-video", `${s.categoria} · ${itens.length} mídia(s)`); }); }
        if (midias.length) { html += `<div class="com-res-grupo">Mídias</div>`; midias.slice(0, 40).forEach((m) => { html += opcao({ nivel: "midia", titulo: m["título"] || "Mídia", capa: m.capa || "", itens: [m] }, "fas fa-play-circle", `${m.categoria || ""}${m.subcategoria ? " · " + m.subcategoria : ""}`); }); }
        el.innerHTML = html || `<p class="com-vazio">Nada encontrado no seu acervo.</p>`;
    }
    function escolherMinha(n) {
        const o = C.minhasOpcoes[n]; if (!o) return;
        const itens = o.itens.slice(0, 500).map(limparItem);
        mostrarPrevia({ tipo: "colecao", nivel: o.nivel, titulo: o.titulo, categoria: o.categoria || (itens[0] && itens[0].categoria) || "", capa: o.capa || "", itens });
    }

    /* ---------- ASSISTIR / ADICIONAR ÀS MINHAS MÍDIAS ---------- */
    function itensDoPost(id) {
        const p = C.posts && C.posts[id]; if (!p || !p.midia) return [];
        const m = p.midia;
        if (m.tipo === "colecao") return Object.values(m.itens || {}).map(limparItem);
        if (m.tipo === "youtube") return [{ "título": m.titulo || "Vídeo", link: `https://www.youtube.com/embed/${m.id}`, capa: m.capa || "", categoria: "Comunidade", subcategoria: "Vídeos da Comunidade" }];
        return [];
    }
    function assistirPost(id) {
        const itens = itensDoPost(id); if (!itens.length) return;
        try { currentPlaylist = itens; fechar(); playTrack(0); }
        catch (err) { uiAlert("Não foi possível abrir o player."); console.error(err); }
    }
    async function adicionarPost(id, btn) {
        const itens = itensDoPost(id); if (!itens.length) return;
        if (typeof database === "undefined" || typeof empurrarBancoIntegralParaServidor !== "function") { uiAlert("Não foi possível acessar suas mídias."); return; }
        const existentes = new Set(database.map((i) => i.categoria + "||" + i.subcategoria + "||" + i.link));
        const novos = itens.filter((i) => i.link && !existentes.has(i.categoria + "||" + i.subcategoria + "||" + i.link));
        if (!novos.length) { uiAlert("Este conteúdo já está nas suas mídias."); return; }
        if (!await uiConfirm(`Adicionar ${novos.length} mídia(s) às suas mídias?`)) return;
        if (btn) btn.disabled = true;
        const backup = database.slice();
        try {
            novos.forEach((i) => database.push({ ...i, categoria: i.categoria || "Comunidade", subcategoria: i.subcategoria || "Geral" }));
            await empurrarBancoIntegralParaServidor();
            if (typeof recarregarDadosDoBanco === "function") await recarregarDadosDoBanco();
            uiAlert(`${novos.length} mídia(s) adicionada(s) às suas mídias!`);
        } catch (err) { database = backup; uiAlert("Erro ao adicionar às suas mídias."); console.error(err); }
        if (btn) btn.disabled = false;
    }

    /* ---------- FEED ---------- */
    function embedMidia(m, postId) {
        if (!m) return "";
        if (m.tipo === "youtube") return `<div class="com-post-video"><iframe src="https://www.youtube.com/embed/${esc(m.id)}" allowfullscreen loading="lazy"></iframe></div>
            <div class="com-colecao-btns" style="padding:8px 0 0"><button data-addmidias="${postId}"><i class="fas fa-plus"></i> Adicionar às minhas mídias</button></div>`;
        if (m.tipo === "colecao") {
            const n = Object.keys(m.itens || {}).length;
            const selo = { midia: '<i class="fas fa-play-circle"></i> Mídia', subcategoria: '<i class="fas fa-video"></i> Subcategoria', categoria: '<i class="fas fa-folder"></i> Categoria' }[m.nivel] || "Mídia";
            return `<div class="com-colecao">
                <div class="com-colecao-capa">${m.capa ? `<img src="${esc(m.capa)}" alt="" loading="lazy">` : ""}<span class="com-colecao-selo">${selo}</span></div>
                <div class="com-colecao-info"><strong>${esc(m.titulo)}</strong><small>${m.nivel !== "midia" ? `${n} mídia(s)` : ""}${m.nivel === "subcategoria" && m.categoria ? ` · ${esc(m.categoria)}` : ""}</small></div>
                <div class="com-colecao-btns"><button class="principal" data-assistir="${postId}"><i class="fas fa-play"></i> Assistir</button><button data-addmidias="${postId}"><i class="fas fa-plus"></i> Adicionar às minhas mídias</button></div>
            </div>`;
        }
        if (m.tipo === "imagem") return `<img class="com-post-img" src="${esc(m.url)}" alt="Imagem do post" loading="lazy">`;
        const yt = (m.url || "").match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);
        if (yt) return `<div class="com-post-video"><iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen loading="lazy"></iframe></div>`;
        if (/\.(mp4|webm|ogg)(\?|$)/i.test(m.url)) return `<video class="com-post-img" src="${esc(m.url)}" controls></video>`;
        if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(m.url)) return `<img class="com-post-img" src="${esc(m.url)}" alt="" loading="lazy">`;
        return `<a class="com-post-link" href="${esc(m.url)}" target="_blank" rel="noopener"><i class="fas fa-link"></i> ${esc(m.url)}</a>`;
    }

    function renderFeed() {
        const lista = Object.entries(C.posts || {}).sort((a, b) => b[1].criado - a[1].criado);
        const el = $("com-feed-lista");
        if (!lista.length) { el.innerHTML = `<p class="com-vazio">Nenhuma publicação ainda. Seja o primeiro a compartilhar algo!</p>`; return; }
        el.innerHTML = lista.map(([id, p]) => {
            const autor = C.perfis[p.uid] || {};
            const curtidas = p.curtidas ? Object.keys(p.curtidas).length : 0;
            const curti = p.curtidas && p.curtidas[C.uid];
            const coments = Object.entries(p.comentarios || {}).sort((a, b) => a[1].criado - b[1].criado);
            return `<article class="com-post">
                <header class="com-post-head">
                    <img class="com-avatar" src="${esc(avatar(autor))}" alt="">
                    <div><strong>${esc(autor.nome || "Usuário")}</strong><small>${tempo(p.criado)}</small></div>
                    ${p.uid === C.uid ? `<button class="btn-icon com-del" data-del="${id}" title="Apagar"><i class="fas fa-trash"></i></button>` : ""}
                </header>
                ${p.texto ? `<p class="com-post-texto">${esc(p.texto)}</p>` : ""}
                ${embedMidia(p.midia, id)}
                <div class="com-post-acoes">
                    <button class="com-acao ${curti ? "ativo" : ""}" data-curtir="${id}"><i class="${curti ? "fas" : "far"} fa-heart"></i> ${curtidas || ""}</button>
                    <span class="com-acao"><i class="far fa-comment"></i> ${coments.length || ""}</span>
                </div>
                <div class="com-comentarios">
                    ${coments.map(([, c]) => `<div class="com-comentario">${avatarMini(c.uid)}<div><strong>${esc(nomeDe(c.uid))}</strong>${esc(c.texto)}</div></div>`).join("")}
                    <form class="com-form-comentario" data-post="${id}"><input maxlength="500" placeholder="Escreva um comentário..."><button type="submit" class="btn-icon"><i class="fas fa-paper-plane"></i></button></form>
                </div>
            </article>`;
        }).join("");
    }

    function comprimirImagem(arquivo) {
        return new Promise((ok, erro) => {
            const leitor = new FileReader();
            leitor.onerror = erro;
            leitor.onload = () => {
                const img = new Image();
                img.onerror = erro;
                img.onload = () => {
                    const max = 1080, f = Math.min(1, max / Math.max(img.width, img.height));
                    const cv = document.createElement("canvas"); cv.width = img.width * f; cv.height = img.height * f;
                    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
                    ok(cv.toDataURL("image/jpeg", 0.72));
                };
                img.src = leitor.result;
            };
            leitor.readAsDataURL(arquivo);
        });
    }

    async function publicar(e) {
        e.preventDefault();
        const texto = $("com-post-texto").value.trim();
        const link = $("com-post-link").value.trim();
        let midia = C.midia || (link ? { tipo: "link", url: link } : null);
        if (midia && midia.tipo === "link") { const yt = midia.url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/); if (yt) midia = { tipo: "youtube", id: yt[1], titulo: "Vídeo do YouTube", capa: `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg` }; }
        if (!texto && !midia) return;
        const btn = $("com-btn-publicar"); btn.disabled = true;
        try {
            await ref("posts").push({ uid: C.uid, texto: texto.slice(0, 2000), midia: midia || null, criado: firebase.database.ServerValue.TIMESTAMP });
            $("com-form-post").reset(); C.midia = null; $("com-preview").innerHTML = ""; $("com-post-link").classList.add("hidden"); fecharPaineis();
        } catch (err) { uiAlert("Não foi possível publicar. Verifique as regras da Comunidade no Firebase."); console.error(err); }
        btn.disabled = false;
    }

    /* ---------- PESSOAS E AMIZADES ---------- */
    function cartaoPessoa(uid, botoes) {
        const p = C.perfis[uid] || {};
        return `<div class="com-pessoa"><span class="com-avatar-wrap"><img class="com-avatar" src="${esc(avatar(p))}" alt="">${C.online && C.online[uid] ? '<i class="com-online"></i>' : ""}</span>
            <div class="com-pessoa-info"><strong>${esc(p.nome || "Usuário")}</strong>${p.cidade ? `<small>${esc(p.cidade)}</small>` : ""}</div>
            <div class="com-pessoa-btns">${botoes}</div></div>`;
    }

    function renderPessoas() {
        const termo = ($("com-busca-pessoas").value || "").toLowerCase();
        const uids = Object.keys(C.perfis).filter((u) => u !== C.uid && (C.perfis[u].nome || "").toLowerCase().includes(termo));
        $("com-pessoas-lista").innerHTML = uids.length ? uids.map((u) => {
            let b;
            if (C.amigos[u]) b = `<button class="btn-success com-btn" data-chat="${u}"><i class="fas fa-comments"></i> Conversar</button>`;
            else if (C.pedidos[u]) b = `<button class="btn-success com-btn" data-aceitar="${u}">Aceitar</button><button class="btn-default com-btn" data-recusar="${u}">Recusar</button>`;
            else if (C.enviados[u]) b = `<button class="btn-default com-btn" data-cancelar="${u}">Pedido enviado ✕</button>`;
            else b = `<button class="btn-primary com-btn" data-adicionar="${u}"><i class="fas fa-user-plus"></i> Adicionar</button>`;
            return cartaoPessoa(u, b);
        }).join("") : `<p class="com-vazio">Nenhuma pessoa encontrada.</p>`;
    }

    function renderAmigos() {
        const ped = Object.keys(C.pedidos || {});
        $("com-pedidos-lista").innerHTML = ped.length ? ped.map((u) => cartaoPessoa(u, `<button class="btn-success com-btn" data-aceitar="${u}">Aceitar</button><button class="btn-default com-btn" data-recusar="${u}">Recusar</button>`)).join("") : `<p class="com-vazio">Nenhum pedido pendente.</p>`;
        const am = Object.keys(C.amigos || {});
        $("com-amigos-lista").innerHTML = am.length ? am.map((u) => cartaoPessoa(u, `<button class="btn-success com-btn" data-chat="${u}"><i class="fas fa-comments"></i> Chat</button><button class="btn-icon com-del" data-desfazer="${u}" title="Desfazer amizade"><i class="fas fa-user-times"></i></button>`)).join("") : `<p class="com-vazio">Você ainda não tem amigos. Adicione pessoas na aba Pessoas.</p>`;
    }

    const raiz = () => C.db.ref("comunidade");
    function adicionar(u) { const up = {}; up[`pedidos/${u}/${C.uid}`] = Date.now(); up[`enviados/${C.uid}/${u}`] = Date.now(); return raiz().update(up); }
    function cancelar(u) { const up = {}; up[`pedidos/${u}/${C.uid}`] = null; up[`enviados/${C.uid}/${u}`] = null; return raiz().update(up); }
    function aceitar(u) { const up = {}; up[`amigos/${C.uid}/${u}`] = true; up[`amigos/${u}/${C.uid}`] = true; up[`pedidos/${C.uid}/${u}`] = null; up[`enviados/${u}/${C.uid}`] = null; return raiz().update(up); }
    function recusar(u) { const up = {}; up[`pedidos/${C.uid}/${u}`] = null; up[`enviados/${u}/${C.uid}`] = null; return raiz().update(up); }
    async function desfazer(u) { if (!await uiConfirm("Desfazer amizade com " + nomeDe(u) + "? O chat será desativado.")) return; const up = {}; up[`amigos/${C.uid}/${u}`] = null; up[`amigos/${u}/${C.uid}`] = null; return raiz().update(up); }

    /* ---------- CHAT AO VIVO (somente amigos) ---------- */
    function abrirChat(u) {
        if (!C.amigos[u]) { uiAlert("O chat só fica disponível depois que a amizade for aceita."); return; }
        fecharChat();
        C.chatCom = u;
        const p = C.perfis[u] || {};
        $("com-chat-avatar").src = avatar(p); $("com-chat-nome").textContent = p.nome || "Usuário";
        $("com-chat").classList.remove("hidden");
        const r = ref("chats/" + idChat(C.uid, u) + "/mensagens").limitToLast(100);
        const fn = (s) => {
            const msgs = Object.values(s.val() || {}).sort((a, b) => a.criado - b.criado);
            const box = $("com-chat-msgs");
            box.innerHTML = msgs.length ? msgs.map((m) => `<div class="com-msg ${m.de === C.uid ? "minha" : ""}"><span>${esc(m.texto)}</span><small>${tempo(m.criado || Date.now())}</small></div>`).join("") : `<p class="com-vazio">Diga olá para ${esc(p.nome || "seu amigo")}! 👋</p>`;
            box.scrollTop = box.scrollHeight;
        };
        r.on("value", fn); C.ouvinteChat = () => r.off("value", fn);
        setTimeout(() => $("com-chat-input").focus(), 50);
    }
    function fecharChat() { if (C.ouvinteChat) C.ouvinteChat(); C.ouvinteChat = null; C.chatCom = null; $("com-chat")?.classList.add("hidden"); }
    function enviarMsg(e) {
        e.preventDefault();
        const inp = $("com-chat-input"), texto = inp.value.trim();
        if (!texto || !C.chatCom) return;
        if (!C.amigos[C.chatCom]) { uiAlert("Vocês não são mais amigos."); fecharChat(); return; }
        inp.value = "";
        ref("chats/" + idChat(C.uid, C.chatCom) + "/mensagens").push({ de: C.uid, para: C.chatCom, texto: texto.slice(0, 1000), criado: firebase.database.ServerValue.TIMESTAMP }).catch((err) => { uiAlert("Mensagem não enviada."); console.error(err); });
    }

    /* ---------- EVENTOS ---------- */
    let ligado = false; // declarado antes de ligar() para evitar erro de inicialização
    document.addEventListener("DOMContentLoaded", ligar);
    if (document.readyState !== "loading") ligar();
    function ligar() {
        if (ligado || !$("comunidade-screen")) return; ligado = true;
        document.querySelectorAll(".btn-comunidade-trigger").forEach((b) => b.addEventListener("click", abrir));
        $("com-fechar").addEventListener("click", fechar);
        document.querySelectorAll(".com-tab").forEach((t) => t.addEventListener("click", () => trocarAba(t.dataset.aba)));
        $("com-form-post").addEventListener("submit", publicar);
        $("com-btn-link").addEventListener("click", () => { fecharPaineis(); $("com-post-link").classList.toggle("hidden"); });
        $("com-btn-emoji").addEventListener("click", () => { montarEmojis(); alternarPainel("com-emojis"); });
        $("com-emojis").addEventListener("click", (e) => { const b = e.target.closest("[data-emoji]"); if (b) inserirEmoji(b.dataset.emoji); });
        $("com-btn-yt").addEventListener("click", () => { if (alternarPainel("com-yt-painel")) $("com-yt-termo").focus(); });
        $("com-yt-buscar").addEventListener("click", buscarYoutube);
        $("com-yt-termo").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); buscarYoutube(); } });
        $("com-yt-resultados").addEventListener("click", (e) => { const b = e.target.closest("[data-ytpick]"); if (!b) return; const v = C.ytResultados[+b.dataset.ytpick]; if (v) mostrarPrevia({ tipo: "youtube", id: v.id, titulo: v.titulo, capa: v.capa }); });
        $("com-btn-minhas").addEventListener("click", () => { if (alternarPainel("com-minhas-painel")) { buscarMinhas(); $("com-minhas-termo").focus(); } });
        $("com-minhas-termo").addEventListener("input", buscarMinhas);
        $("com-minhas-termo").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
        $("com-minhas-resultados").addEventListener("click", (e) => { const b = e.target.closest("[data-minhapick]"); if (b) escolherMinha(+b.dataset.minhapick); });
        $("com-arquivo").addEventListener("change", async (e) => {
            const f = e.target.files[0]; if (!f) return;
            if (!f.type.startsWith("image/")) { uiAlert("Envie uma imagem. Para vídeos, cole o link (YouTube, MP4...)."); return; }
            try { C.midia = { tipo: "imagem", url: await comprimirImagem(f) }; $("com-preview").innerHTML = `<img src="${C.midia.url}" alt=""><button type="button" class="btn-icon" id="com-tirar-midia"><i class="fas fa-times"></i></button>`; }
            catch (err) { uiAlert("Não foi possível ler a imagem."); }
            e.target.value = "";
        });
        $("com-preview").addEventListener("click", (e) => { if (e.target.closest("#com-tirar-midia")) { C.midia = null; $("com-preview").innerHTML = ""; } });
        $("com-busca-pessoas").addEventListener("input", renderPessoas);
        $("com-chat-fechar").addEventListener("click", fecharChat);
        $("com-chat-form").addEventListener("submit", enviarMsg);
        $("comunidade-screen").addEventListener("submit", (e) => {
            const f = e.target.closest(".com-form-comentario"); if (!f) return;
            e.preventDefault(); const inp = f.querySelector("input"), t = inp.value.trim(); if (!t) return;
            ref("posts/" + f.dataset.post + "/comentarios").push({ uid: C.uid, texto: t.slice(0, 500), criado: firebase.database.ServerValue.TIMESTAMP }); inp.value = "";
        });
        $("comunidade-screen").addEventListener("click", async (e) => {
            const b = e.target.closest("button"); if (!b) return; const d = b.dataset;
            if (d.assistir) assistirPost(d.assistir);
            else if (d.addmidias) adicionarPost(d.addmidias, b);
            else if (d.adicionar) adicionar(d.adicionar);
            else if (d.cancelar) cancelar(d.cancelar);
            else if (d.aceitar) aceitar(d.aceitar);
            else if (d.recusar) recusar(d.recusar);
            else if (d.desfazer) desfazer(d.desfazer);
            else if (d.chat) abrirChat(d.chat);
            else if (d.curtir) { const r = ref(`posts/${d.curtir}/curtidas/${C.uid}`); (C.posts[d.curtir].curtidas || {})[C.uid] ? r.remove() : r.set(true); }
            else if (d.del && await uiConfirm("Apagar esta publicação?")) ref("posts/" + d.del).remove();
        });
        firebase.auth().onAuthStateChanged(iniciar);
    }
})();
