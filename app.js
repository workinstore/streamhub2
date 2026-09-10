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
        const ehArquivo = /\.(mp4|mkv|webm|mov|mp3|wav|aac|m4a|ape|ogg|oga|opus|wma|mp2|flac)(\?|$)/i.test(link) || link.includes('raw.githubusercontent');
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
                const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${bloco.join(',')}&key=${CONFIG.YT_API_KEY}`);
                const data = await res.json();
                (data.items || []).forEach(item => {
                    duracoesCache[`yt:${item.id}`] = iso8601ParaSegundos(item.contentDetails && item.contentDetails.duration);
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
            return;
        }
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

function handleLogin() {
    const elUser = document.getElementById('login-user');
    const elPass = document.getElementById('login-pass');
    if(!elUser || !elPass) return;
    const inputEmail = elUser.value.trim().toLowerCase();
    const inputPass = elPass.value.trim();
    if (!inputEmail || !inputPass) return alert("Preencha todos os campos!");
    
    const btnLogin = document.getElementById('btn-login');
    btnLogin.innerText = "Autenticando..."; btnLogin.disabled = true;

    firebase.auth().signInWithEmailAndPassword(inputEmail, inputPass)
        .catch((error) => {
            alert("Erro na Autenticação: " + error.message);
            btnLogin.innerText = "Entrar"; btnLogin.disabled = false;
        });
}

// Dispara o e-mail nativo de redefinição de senha do Firebase Auth
function handlePasswordRecovery() {
    const elEmail = document.getElementById('recover-email');
    if (!elEmail) return;
    
    const email = elEmail.value.trim().toLowerCase();
    if (!email) return alert("Por favor, digite o seu e-mail cadastrado!");
    
    const btnRecover = document.getElementById('btn-recover-submit');
    btnRecover.innerText = "Enviando link..."; btnRecover.disabled = true;
    
    firebase.auth().sendPasswordResetEmail(email)
        .then(() => {
            alert(`Link de redefinição enviado com sucesso para: ${email}\nVerifique a sua caixa de entrada ou spam!`);
            document.getElementById('form-recuperar-fluxo').reset();
            alternarAbasLogin('login'); // Retorna automaticamente para a tela de login
        })
        .catch((error) => {
            alert("Erro ao solicitar link: " + error.message);
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
    }
    let htmlContent = `<div class="card-thumb"><img src="${imgSrc || 'https://placehold.co/160x90?text=Sem+Capa'}">${selo}</div><h4 title="${String(title || '').replace(/"/g, '&quot;')}">${title}</h4>`;
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
        mediaDelete.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (confirm(`Excluir a mídia "${title}"?`)) deletarMidiaUnica(realIndex);
        });
    }
    const collectionEdit = card.querySelector('.collection-edit-btn');
    if (collectionEdit && favInfo) {
        collectionEdit.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (favInfo.tipo === 'categoria') {
                const novoNome = prompt('Novo nome para a Categoria:', favInfo.categoria);
                if (novoNome && novoNome.trim() && novoNome.trim() !== favInfo.categoria) renomearCategoriaCompleta(favInfo.categoria, novoNome.trim());
            } else {
                const novoNome = prompt('Novo nome para a Subcategoria:', favInfo.subcategoria);
                if (novoNome && novoNome.trim() && novoNome.trim() !== favInfo.subcategoria) renomearSubcategoriaCompleta(favInfo.categoria, favInfo.subcategoria, novoNome.trim());
            }
        });
    }
    const collectionDelete = card.querySelector('.collection-delete-btn');
    if (collectionDelete && favInfo) {
        collectionDelete.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (favInfo.tipo === 'categoria') {
                if (confirm(`Excluir a categoria "${favInfo.categoria}" e todo o seu conteúdo?`)) deletarCategoriaCompleta(favInfo.categoria);
            } else if (confirm(`Excluir a subcategoria "${favInfo.subcategoria}" e todo o seu conteúdo?`)) {
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
                capa: item.snippet.thumbnails.medium ? item.snippet.thumbnails.medium.url : item.snippet.thumbnails.default.url,
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
        if(!termo) return alert("Digite o nome do canal.");
        
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
                div.innerHTML = `<img src="${item.snippet.thumbnails.default.url}"><div class="info"><h4>${item.snippet.title}</h4></div>`;
                div.onclick = () => {
                    canalSelecionadoProvisorio = { 
                        channelId: item.snippet.channelId, 
                        title: item.snippet.title, 
                        thumb: item.snippet.thumbnails.default.url, 
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
                lastYtSearchResults.push({ type: isPl ? 'playlist' : 'video', youtubeId: isPl ? item.id.playlistId : item.id.videoId, title: item.snippet.title, thumb: item.snippet.thumbnails.medium ? item.snippet.thumbnails.medium.url : 'https://placehold.co/300x200?text=Sem+Capa' });
            });
        }
        renderMosaic();
    } catch (e) { if (grid) grid.innerHTML = '<h3>Erro de rede ao conectar à API.</h3>'; }
}

async function peekPlaylistContents(playlistId) {
    try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${CONFIG.YT_API_KEY}`); const data = await res.json();
        if(data.items) { alert(`Mídias:\n\n` + data.items.map((item, idx) => `${idx + 1}. ${item.snippet.title}`).join('\n').substring(0, 1200)); }
    } catch(e) { alert("Erro playlist."); }
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
    if (reproducaoAleatoria && !jaSorteadas.includes(index)) jaSorteadas.push(index);
    if (document.getElementById('player-container')) document.getElementById('player-container').classList.remove('hidden');
    if (document.getElementById('current-track-title')) document.getElementById('current-track-title').innerText = track.título;
    try { atualizarBotaoFavoritoDoPlayer(); } catch (e) {}

    const ytPlayerEl = document.getElementById('yt-player'); const univPlayerEl = document.getElementById('universal-player'); const rawPlayerEl = document.getElementById('raw-player');
    if (univPlayerEl) univPlayerEl.src = ""; if (rawPlayerEl) rawPlayerEl.src = "";
    if (univPlayerEl) univPlayerEl.classList.add('hidden'); if (rawPlayerEl) rawPlayerEl.classList.add('hidden'); if (ytPlayerEl) ytPlayerEl.classList.remove('hidden');
    if (rawPlayerEl) rawPlayerEl.pause(); const linkOriginal = track.link.trim(); const vId = extractYoutubeId(linkOriginal);
    esconderPalcoDeAudio();

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
        const catRow = createCrudRow(cat, 'categoria', () => { let n = prompt("Novo nome para a Categoria:", cat); if(n && n.trim() !== "") renomearCategoriaCompleta(cat, n.trim()); }, () => { if(confirm(`Excluir ${cat}?`)) deletarCategoriaCompleta(cat); }, () => downloadJSON(database.filter(item => item.categoria === cat), `cat_${cat}`));
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
            const subRow = createCrudRow(sub, 'subcategoria', sub === "Vídeos Recentes" ? null : () => { let n = prompt("Novo nome para a Subcategoria:", sub); if(n && n.trim() !== "") renomearSubcategoriaCompleta(cat, sub, n.trim()); }, () => { if(confirm(`Excluir a subcategoria ${sub}?`)) deletarSubcategoria(cat, sub); }, () => downloadJSON(database.filter(item => item.categoria === cat && item.subcategoria === sub), `sub_${sub}`));
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
                        mediaContainer.appendChild(createCrudRow(item.título, 'mídia', () => openAdvancedEditModal(idx), () => { if(confirm(`Excluir a mídia: ${item.título}?`)) deletarMidiaUnica(idx); }, () => downloadJSON(item, item.título)));
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
    } catch(e){ console.error("Erro ao renomear categoria:", e); alert("Erro ao renomear categoria: " + e.message); } 
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
        return alert("Não foi possível identificar a mídia em edição. Reabra a edição e tente novamente.");
    }
    const t = document.getElementById('edit-field-title').value.trim(); const l = document.getElementById('edit-field-link').value.trim();
    const c = document.getElementById('edit-field-capa').value.trim(); const cat = document.getElementById('edit-field-category').value.trim();
    const sub = document.getElementById('edit-field-subcategory').value.trim();
    if(!t || !l || !cat) return alert("Preencha os campos!");

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
        alert("Alteração salva com sucesso!");
    } catch (err) {
        // Desfaz a alteração local se a gravação remota falhar
        database[activeEditingIndex] = itemOriginal;
        alert("Erro ao salvar: " + err.message);
    } finally {
        if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.innerHTML = textoOriginal; }
    }
}

async function saveMediaToDatabase(e) {
    if(e) e.preventDefault(); const url = document.getElementById('manual-media-url').value.trim(); 
    const categoria = document.getElementById('media-category').value.trim(); const subcategoria = document.getElementById('media-subcategory').value.trim();
    if(!url || !categoria) return alert("Preencha os campos."); const pId = extractPlaylistId(url); const btnSave = document.getElementById('btn-save-media');

    try {
        if(pId) {
            btnSave.innerText = "Processando..."; btnSave.disabled = true;
            let urlApi = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${pId}&key=${CONFIG.YT_API_KEY}`;
            let res = await fetch(urlApi); let data = await res.json();
            if(data.error) throw new Error(data.error.message); if(!data.items || data.items.length === 0) throw new Error("Playlist vazia.");
            
            for(let item of data.items) {
                let vId = item.snippet.resourceId.videoId; let título = item.snippet.title;
                let capa = item.snippet.thumbnails.medium ? item.snippet.thumbnails.medium.url : item.snippet.thumbnails.default.url; let linkVideo = `https://www.youtube.com/embed/${vId}`;
                database.push({ título, link: linkVideo, capa, categoria, subcategoria });
            }
            await empurrarBancoIntegralParaServidor();
            alert(`Sucesso! Foram importados ${data.items.length} vídeos.`);
        } else {
            const título = document.getElementById('prev-title').value.trim() || "Nova Mídia"; 
            const capa = document.getElementById('prev-thumb').src;
            database.push({ título, link: url, capa, categoria, subcategoria });
            await empurrarBancoIntegralParaServidor();
            alert("Vídeo salvo!");
        }
        document.getElementById('manual-media-url').value = ""; 
        document.getElementById('admin-modal')?.classList.add('hidden');
        await recarregarDadosDoBanco();
    } catch (err) { alert("Erro: " + err.message); } finally { btnSave.innerText = "Salvar no meu Firebase"; btnSave.disabled = false; }
}

async function processarInjecaoDeDadosAcumulativa(novosItens) {
    if(!Array.isArray(novosItens) || novosItens.length === 0) return alert("Nenhum dado válido para importar.");
    try {
        const res = await dbFetch(CONFIG.FIREBASE_URL); const data = await res.json(); let bancoAtual = [];
        if (data) {
            if (Array.isArray(data)) bancoAtual = data.filter(item => item !== null);
            else Object.keys(data).forEach(k => { if(data[k]) bancoAtual.push(data[k]); });
        }
        novosItens.forEach(novo => {
            const limpo = { título: novo.título, link: novo.link, capa: novo.capa || "", categoria: novo.categoria, subcategoria: novo.subcategoria || "" };
            const jaExiste = bancoAtual.some(velho => velho.link === limpo.link && velho.categoria === limpo.categoria);
            if(!jaExiste) bancoAtual.push(limpo);
        });
        database = bancoAtual;
        await empurrarBancoIntegralParaServidor();
        await recarregarDadosDoBanco(); 
        renderCrudManager();
        alert(`Importação concluída! Total de mídias: ${database.length}`);
    } catch(e) { alert("Falha na mesclagem de dados."); }
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
    catch(e){ database = backup; alert("Erro ao excluir mídia: " + e.message); }
}
async function deletarSubcategoria(cat, sub) {
    const backup = database.slice();
    try { database = database.filter(item => !(item.categoria === cat && item.subcategoria === sub)); await empurrarBancoIntegralParaServidor(); await recarregarDadosDoBanco(); renderCrudManager(); }
    catch(e){ database = backup; alert("Erro ao excluir subcategoria: " + e.message); }
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
    } catch(e){ console.error("Erro ao deletar categoria completa:", e); alert("Erro ao excluir categoria: " + e.message); } 
}

async function renomearSubcategoriaCompleta(cat, antigaSub, novaSub) {
    try {
        database.forEach(item => { if(item.categoria === cat && item.subcategoria === antigaSub) item.subcategoria = novaSub; });
        await empurrarBancoIntegralParaServidor();
        await recarregarDadosDoBanco();
        renderCrudManager();
    } catch(e){ alert("Erro ao renomear subcategoria: " + e.message); }
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
    if (!confirm("Atenção Admin: Deseja apagar permanentemente todas as mídias e preferências deste usuário do banco? (Lembre-se de deletar a credencial dele no painel Firebase Auth)")) return;
    
    try {
        const urlBaseBanco = firebaseConfig.databaseURL.replace(/\/$/, "");
        await dbFetch(`${urlBaseBanco}/usuarios/${uidUsuarioAlvo}.json`, { method: "DELETE" });
        alert("Dados do Realtime Database removidos com sucesso!");
        renderizarListaUsuariosPedidosExclusao();
    } catch(e) {
        alert("Erro técnico ao limpar nó do usuário.");
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

            firebase.auth().signInWithPopup(googleProvider)
                .then((resultado) => { guardarTokenGoogle(resultado); })
                .catch((error) => {
                    alert("Erro ao logar com o Google: " + error.message);
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
                return alert("Por favor, selecione um canal e defina/selecione uma categoria válida.");
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
                
                alert(`Canal vinculado com sucesso na categoria "${catDestino}"!`);
                
                document.getElementById("channel-preview").style.display = "none"; 
                document.getElementById('search-channel-input').value = "";
                if(document.getElementById('channel-target-category-new')) document.getElementById('channel-target-category-new').value = "";
                
                const radExistente = document.querySelector('input[name="cat-mode-channel"][value="existente"]');
                if(radExistente) { radExistente.checked = true; alternarModoCategoriaCanal('existente'); }

                canalSelecionadoProvisorio = null; 
                initApp();
            } catch(err) { 
                alert("Erro ao salvar canal: " + err.message); 
            }
        }

        if (e.target.closest('#btn-request-delete-account')) {
            e.preventDefault();
            if (!confirm("Tem certeza absoluta de que deseja solicitar a exclusão da sua conta? Seu acervo e preferências serão agendados para eliminação pelo administrador.")) return;
            
            try {
                await salvarPreferenciaNoFirebase({ solicitou_exclusao: true });
                alert("Sua solicitação de exclusão foi enviada com sucesso! Você pode fechar o site ou deslogar.");
                fecharModalPerfil();
            } catch(err) {
                alert("Falha ao registrar pedido.");
            }
        }
        
        if (e.target.closest('#btn-fetch-manual')) {
            const url = document.getElementById('manual-media-url').value.trim(); if(!url) return alert("Insira uma URL.");
            const btn = e.target.closest('#btn-fetch-manual'); btn.innerText = "Buscando..."; const vId = extractYoutubeId(url);
            try {
                if (vId) {
                    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${vId}&key=${CONFIG.YT_API_KEY}`); const data = await res.json();
                    if (data.items && data.items.length > 0) { const snip = data.items[0].snippet; document.getElementById('prev-title').value = snip.title; document.getElementById('prev-thumb').src = snip.thumbnails.medium ? snip.thumbnails.medium.url : snip.thumbnails.default.url; } 
                }
            } catch(err) {} finally { btn.innerText = "Capturar Dados"; }
        }

        if (e.target.closest('#btn-export-all-json')) { if (database.length > 0) downloadJSON(database, "backup_completo_streamhub"); else alert("Banco vazio!"); }
        if (e.target.closest('#btn-submit-json-code')) {
            const val = document.getElementById('json-input-field')?.value.trim(); if(!val) return alert("Cole o código JSON");
            try { let p = JSON.parse(val); await processarInjecaoDeDadosAcumulativa(Array.isArray(p) ? p : Object.values(p)); document.getElementById('json-input-field').value = ""; } catch(err) { alert("JSON inválido."); }
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
                return alert("Os campos Nome e Sobrenome não podem ficar vazios!");
            }
            if (novoWhatsapp && !whatsappEhValido(novoWhatsapp)) {
                return alert("Informe um WhatsApp válido com DDD, no formato (99) 99999-9999.");
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
                
                alert("Perfil e preferências salvos com sucesso!");
                fecharModalPerfil();
                
            } catch (err) {
                alert("Erro ao salvar alterações do perfil: " + err.message);
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
            try { let p = JSON.parse(evt.target.result); await processarInjecaoDeDadosAcumulativa(Array.isArray(p) ? p : Object.values(p)); e.target.value = ""; } catch(err) { alert("Erro de arquivo."); }
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
                return alert("Por favor, preencha todos os campos do cadastro!");
            }
            if(!whatsapp || !cidade || !uf) {
                return alert("Informe também o seu WhatsApp, a cidade e a UF.");
            }
            if(!whatsappEhValido(whatsapp)) {
                return alert("Informe um WhatsApp válido com DDD, no formato (99) 99999-9999.");
            }
            
            // TRAVA DE PROVEDOR REAL: Aplica a validação do front-end
            if (!verificarProvedorValido(email)) {
                return alert("Cadastro Bloqueado!\nPor razões de segurança e viabilidade de recuperação de senha, use um e-mail válido pertencente aos grandes provedores (Gmail, Hotmail, Outlook, Yahoo, iCloud, UOL, BOL ou IG).");
            }

            if(senha.length < 6) {
                return alert("A senha precisa ter no mínimo 6 caracteres!");
            }
            if(senha !== senhaConfirm) {
                return alert("As senhas digitadas não batem! Verifique a confirmação.");
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
                
                alert(`Conta criada com absoluto sucesso, ${nome}! Seja bem-vindo.`);
                
                document.getElementById('form-cadastro-fluxo').reset();
                alternarAbasLogin('login');
                
            } catch(error) {
                alert("Erro ao realizar cadastro: " + error.message);
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
        alert("Não foi possível autorizar sua conta Google para comentar: " + (e.message || e));
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
                alert("Sua autorização do Google expirou. Entre novamente com o Google para comentar.");
                montarCaixaDeComentario();
            } else {
                alert("Não foi possível publicar o comentário: " + (dados.error.message || "erro desconhecido"));
            }
            return;
        }
        campo.value = "";
        await carregarComentariosDoVideo(videoIdEmExibicao);
    } catch (e) {
        alert("Erro de rede ao publicar o comentário.");
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

    if (c.siteNome) {
        const titulo = document.getElementById("bc-root");
        if (titulo) titulo.innerText = c.siteNome;
    }
}

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
    if (!ehAdminMaster()) return alert("Acesso restrito ao administrador.");
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
    if (whatsMaster && !whatsappEhValido(whatsMaster)) return alert("WhatsApp inválido. Use o formato (99) 99999-9999.");
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
        alert("Usuário atualizado com sucesso!");
        document.getElementById("master-edit-user-modal")?.classList.add("hidden");
        renderizarUsuariosMaster();
    } catch (e) { alert("Erro ao salvar usuário: " + e.message); }
}

async function excluirUsuarioMaster(uid) {
    if (!confirm("Apagar TODOS os dados deste usuário no banco? (a credencial no Firebase Auth deve ser removida no console)")) return;
    try {
        await dbFetch(`${urlRaizBanco()}/usuarios/${uid}.json`, { method: "DELETE" });
        document.getElementById("master-edit-user-modal")?.classList.add("hidden");
        renderizarUsuariosMaster();
    } catch (e) { alert("Erro ao apagar dados."); }
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
    if (!nome || !email || senha.length < 6) return alert("Preencha nome, e-mail e uma senha de no mínimo 6 caracteres.");
    if (!whatsapp || !cidade || !uf) return alert("Informe também o WhatsApp, a cidade e a UF do novo usuário.");
    if (!whatsappEhValido(whatsapp)) return alert("WhatsApp inválido. Use o formato (99) 99999-9999.");

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
        alert(`Usuário ${nome} cadastrado com sucesso!`);
        ["master-new-name", "master-new-lastname", "master-new-email", "master-new-pass", "master-new-whatsapp", "master-new-cidade", "master-new-uf"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
        trocarAbaMaster("m-users-tab", "tab-trigger-m-users");
        renderizarUsuariosMaster();
    } catch (e) {
        alert("Erro ao cadastrar usuário: " + e.message);
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
        alert("Configurações salvas com sucesso!");
    } catch (e) { alert("Erro ao salvar configurações globais."); }
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
        } catch (err) { alert(err.message); }
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
                siteNome: document.getElementById("master-site-name").value.trim() || "StreamHub"
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
    if (/\.(mp4|m4v|webm|ogv|mov|mkv|mp3|m4a|aac|ogg|m3u8|mpd|flv|avi|wav|opus)(\?|$)/.test(url)) return "media";
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
    if (url.includes(".mp3")) return "audio/mpeg";
    if (url.includes(".m4a") || url.includes(".aac")) return "audio/mp4";
    if (url.includes(".ogg") || url.includes(".ogv")) return "video/ogg";
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
// FAVORITOS: MIDIAS, CATEGORIAS E SUBCATEGORIAS
// ==========================================
let favoritos = { midias: [], categorias: [], subcategorias: [] };

function carregarFavoritosDoPerfil(dados) {
    favoritos = {
        midias: Array.isArray(dados && dados.midias) ? dados.midias : [],
        categorias: Array.isArray(dados && dados.categorias) ? dados.categorias : [],
        subcategorias: Array.isArray(dados && dados.subcategorias) ? dados.subcategorias : []
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
    if (info.tipo === 'categoria') {
        favoritos.categorias = jaEra
            ? favoritos.categorias.filter(c => c.categoria !== info.categoria)
            : favoritos.categorias.concat([{ categoria: info.categoria, capa: capaDaCategoria(info.categoria) }]);
    } else if (info.tipo === 'subcategoria') {
        favoritos.subcategorias = jaEra
            ? favoritos.subcategorias.filter(c => !(c.categoria === info.categoria && c.subcategoria === info.subcategoria))
            : favoritos.subcategorias.concat([{ categoria: info.categoria, subcategoria: info.subcategoria, capa: capaDaSubcategoria(info.categoria, info.subcategoria) }]);
    } else {
        const t = info.track || {};
        const link = (t.link || '').trim();
        if (!link) return;
        favoritos.midias = jaEra
            ? favoritos.midias.filter(m => (m.link || '').trim() !== link)
            : favoritos.midias.concat([{ título: t.título || t.titulo || 'Mídia', link: link, capa: t.capa || '', categoria: t.categoria || '', subcategoria: t.subcategoria || '' }]);
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
    renderizarFavoritos();
    document.getElementById('favorites-modal')?.classList.remove('hidden');
}

function fecharModalFavoritos() {
    document.getElementById('favorites-modal')?.classList.add('hidden');
}

function renderizarFavoritos() {
    const corpo = document.getElementById('favorites-body');
    if (!corpo) return;
    corpo.innerHTML = '';

    const total = favoritos.categorias.length + favoritos.subcategorias.length + favoritos.midias.length;
    if (total === 0) {
        corpo.innerHTML = '<p class="fav-vazio">Você ainda não favoritou nada. Toque no coração dos cards de mídias, categorias ou subcategorias para salvar aqui.</p>';
        return;
    }

    const criarSecao = (titulo, itens, montar) => {
        if (!itens.length) return;
        const h = document.createElement('h4');
        h.className = 'fav-secao-titulo';
        h.innerText = `${titulo} (${itens.length})`;
        corpo.appendChild(h);
        const lista = document.createElement('div');
        lista.className = 'fav-lista';
        itens.forEach(item => lista.appendChild(montar(item)));
        corpo.appendChild(lista);
    };

    const linha = (capa, titulo, subtitulo, aoAbrir, aoRemover) => {
        const div = document.createElement('div');
        div.className = 'fav-item';
        div.innerHTML = `<img src="${capa || 'https://placehold.co/160x90?text=Sem+Capa'}">
            <div class="fav-item-info"><strong>${titulo}</strong><span>${subtitulo || ''}</span></div>
            <button type="button" class="fav-item-remove" title="Remover dos favoritos"><i class="fas fa-heart-crack"></i></button>`;
        div.addEventListener('click', (e) => { if (e.target.closest('.fav-item-remove')) return; aoAbrir(); });
        div.querySelector('.fav-item-remove').addEventListener('click', (e) => { e.stopPropagation(); aoRemover(); });
        return div;
    };

    criarSecao('Categorias', favoritos.categorias, (c) => linha(c.capa, c.categoria, 'Categoria',
        () => { selectedCategory = c.categoria; selectedSubcategory = ''; currentView = 'subcategories'; fecharModalFavoritos(); renderMosaic(); },
        () => alternarFavorito({ tipo: 'categoria', categoria: c.categoria })));

    criarSecao('Subcategorias', favoritos.subcategorias, (c) => linha(c.capa, c.subcategoria, c.categoria,
        () => { selectedCategory = c.categoria; selectedSubcategory = c.subcategoria; currentView = 'tracks'; fecharModalFavoritos(); renderMosaic(); },
        () => alternarFavorito({ tipo: 'subcategoria', categoria: c.categoria, subcategoria: c.subcategoria })));

    criarSecao('Mídias', favoritos.midias, (m) => linha(m.capa, m.título, [m.categoria, m.subcategoria].filter(Boolean).join(' • '),
        () => { currentPlaylist = favoritos.midias.slice(); fecharModalFavoritos(); playTrack(favoritos.midias.indexOf(m)); },
        () => alternarFavorito({ tipo: 'midia', track: m })));
}

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

const EXTENSOES_AUDIO = ['mp3','wav','aac','m4a','ape','ogg','oga','opus','wma','mp2','mpga','flac','aif','aiff'];
const EXTENSOES_AUDIO_LIMITADAS = ['ape','wma','mp2','aif','aiff'];

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
    rawPlayerEl.src = link;
    rawPlayerEl.onended = () => { avancarFaixa(); };
    rawPlayerEl.onerror = () => {
        if (!aviso) return;
        aviso.classList.remove('hidden');
        const ext = extensaoDoArquivo(link).toUpperCase();
        aviso.innerText = EXTENSOES_AUDIO_LIMITADAS.indexOf(extensaoDoArquivo(link)) !== -1
            ? `Este navegador não reproduz o formato ${ext} nativamente. Converta para MP3, M4A, OGG ou WAV.`
            : 'Não foi possível carregar este áudio. Verifique o link do arquivo.';
    };
    const promessa = rawPlayerEl.play();
    if (promessa && promessa.catch) promessa.catch(() => {});
    aplicarVolume();
}
