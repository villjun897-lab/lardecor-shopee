import fetch from 'node-fetch';
import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;

// ==========================================
// CONFIGURAÇÕES & CONTINGÊNCIA
// ==========================================

const INSTANCIAS = [
  process.env.EVOLUTION_INSTANCE_NAME || 'lardecor-shopee-2',
  process.env.EVOLUTION_INSTANCE_2    || 'lardecor-shopee-3',
  process.env.EVOLUTION_INSTANCE_3    || 'lardecor-shopee-4',
  process.env.EVOLUTION_INSTANCE_4    || 'lardecor-shopee-5',
  process.env.EVOLUTION_INSTANCE_5    || 'lardecor-shopee'
].filter(Boolean);

const EVOLUTION_BASE_URL = process.env.EVOLUTION_API_URL || 'https://evolution-api-production-1961.up.railway.app';
const EVOLUTION_APIKEY = process.env.EVOLUTION_API_KEY || 'startshopee2026';

const DESTINOS_WHATSAPP = [
  { nome: 'Grupo LarDecór', id: process.env.WHATSAPP_GROUP_ID || '120363426165901005@g.us' }
];

const SHOPEE_APP_ID = process.env.SHOPEE_APP_ID || '18363541104';
const SHOPEE_APP_SECRET = process.env.SHOPEE_APP_SECRET || 'BAOH7TTUUWYUKL3OPJIKT6Z67IRL2G6E';
const SHOPEE_GRAPHQL_URL = 'https://open-api.affiliate.shopee.com.br/graphql';
const SHOPEE_SUB_ID = process.env.SHOPEE_SUB_ID || 'lardecor';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada no Railway.');
}

// ==========================================
// REGRAS COMERCIAIS
// ==========================================

const PRECO_MINIMO = 25.00;
const COMISSAO_MINIMA_REAIS = 5.00;
const VENDAS_MINIMAS = 50;
const AVALIACAO_MINIMA = 4.3;
const DESCONTO_MINIMO = 15;

const MAX_TENTATIVAS_POR_CICLO = 3;
const PAUSA_ENTRE_TENTATIVAS_MS = 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ==========================================
// CONFIGURAÇÃO DE PESOS E PALAVRAS-CHAVE
// ==========================================

const NICHOS_PRIORITARIOS = [
  { nicho: 'casa_cozinha', peso: 30 },
  { nicho: 'eletrodomesticos', peso: 25 },
  { nicho: 'cama_mesa_banho', peso: 20 },
  { nicho: 'moveis_organizacao', peso: 15 },
  { nicho: 'perfume_feminino', peso: 5 },
  { nicho: 'perfume_masculino', peso: 5 }
];

const NICHOS_MAPA = {
  casa_cozinha: [
    'jogo de panelas', 'kit panelas antiaderente', 'frigideira antiaderente', 'panela de pressão',
    'purificador de agua', 'filtro de agua', 'escorredor de louças', 'kit porta temperos completo',
    'kit utensilios cozinha silicone', 'kit utensilios cozinha', 'kit facas cozinha', 'kit tabua de corte cozinha',
    'organizador cozinha', 'organizador geladeira', 'potes hermeticos', 'kit potes hermeticos',
    'garrafa termica', 'jarra vidro', 'lixeira cozinha', 'escorredor alimentos',
    'cesto organizador', 'porta mantimentos', 'suporte microondas', 'suporte temperos',
    'kit porta detergente', 'escova eletrica limpeza'
  ],
  eletrodomesticos: [
    'panela elétrica', 'air fryer', 'cafeteira eletrica', 'liquidificador', 'batedeira',
    'mixer cozinha', 'processador alimentos', 'sanduicheira', 'grill eletrico',
    'forno eletrico', 'microondas', 'aspirador de po', 'aspirador robo', 'lavadora alta pressão'
  ],
  cama_mesa_banho: [
    'jogo de cama casal', 'jogo de cama queen', 'jogo de cama king', 'kit colcha casal',
    'colcha casal', 'edredom casal', 'edredom queen', 'cobertor casal', 'manta sofa',
    'travesseiro ortopedico', 'travesseiro viscoelastico', 'protetor colchao', 'saia box',
    'lençol casal', 'lençol queen', 'toalha banho', 'kit toalhas banho', 'toalha rosto',
    'tapete banheiro', 'jogo americano mesa posta', 'trilho mesa', 'toalha mesa',
    'centro mesa decorativo', 'cortina blackout', 'cortina sala', 'cortina quarto'
  ],
  moveis_organizacao: [
    'mop giratorio', 'rodo magico', 'vassoura magica', 'organizadores casa', 'caixa organizadora',
    'colmeia organizadora', 'organizador guarda roupa', 'organizador gaveta grande', 'sapateira organizadora',
    'kit cabides veludo', 'cabides organizadores', 'cesto roupas', 'prateleira organizadora',
    'armario multiuso', 'nicho decorativo', 'estante organizadora', 'rack para tv', 'painel tv',
    'mesa cabeceira', 'mesa lateral', 'mesa escritorio', 'cadeira escritorio', 'cadeira gamer',
    'escrivaninha', 'estante livros', 'aparador sala', 'buffet sala jantar', 'penteadeira',
    'prateleira decorativa', 'armario cozinha', 'guarda roupa casal', 'comoda quarto', 'sapateira',
    'cabeceira cama', 'poltrona decorativa', 'mesa centro sala'
  ],
  perfume_feminino: [
    'perfume feminino importado', 'perfume feminino original', 'perfume feminino longa duracao',
    'perfume feminino floral', 'perfume feminino doce', 'perfume feminino amadeirado',
    'perfume feminino arabia', 'kit perfume feminino'
  ],
  perfume_masculino: [
    'perfume masculino importado', 'perfume masculino original', 'perfume masculino longa duracao',
    'perfume masculino amadeirado', 'perfume masculino arabia', 'perfume masculino intenso',
    'kit perfume masculino'
  ]
};

let ultimoNichoSorteado = null;
let ultimasPalavrasUsadas = [];

function obterProximoNichoEKeyword() {
  const somaPesos = NICHOS_PRIORITARIOS.reduce((total, item) => total + item.peso, 0);

  let categoriaEscolhida = null;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    let numeroSorteado = Math.random() * somaPesos;
    for (const item of NICHOS_PRIORITARIOS) {
      if (numeroSorteado < item.peso) {
        categoriaEscolhida = item.nicho;
        break;
      }
      numeroSorteado -= item.peso;
    }
    if (categoriaEscolhida && categoriaEscolhida !== ultimoNichoSorteado) break;
  }

  if (!categoriaEscolhida) categoriaEscolhida = 'casa_cozinha';
  ultimoNichoSorteado = categoriaEscolhida;

  const palavrasDisponiveis = NICHOS_MAPA[categoriaEscolhida] || NICHOS_MAPA.casa_cozinha;
  let keywordEscolhida = palavrasDisponiveis[Math.floor(Math.random() * palavrasDisponiveis.length)];

  let tentativasKeyword = 0;
  while (ultimasPalavrasUsadas.includes(keywordEscolhida) && tentativasKeyword < 20) {
    keywordEscolhida = palavrasDisponiveis[Math.floor(Math.random() * palavrasDisponiveis.length)];
    tentativasKeyword++;
  }

  ultimasPalavrasUsadas.push(keywordEscolhida);
  if (ultimasPalavrasUsadas.length > 15) ultimasPalavrasUsadas.shift();

  return { categoria: categoriaEscolhida, keyword: keywordEscolhida };
}

// ==========================================
// HORÁRIO COMERCIAL
// ==========================================

const HORARIO_INICIO_HORA = 7;
const HORARIO_FIM_HORA = 23;

async function verificarEAguardarHorarioComercial() {
  while (true) {
    const agoraStr = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
    const agora = new Date(agoraStr);
    const horaAtual = agora.getHours();

    if (horaAtual >= HORARIO_INICIO_HORA && horaAtual < HORARIO_FIM_HORA) {
      return;
    }

    const proximaAbertura = new Date(agora);
    if (horaAtual >= HORARIO_FIM_HORA) {
      proximaAbertura.setDate(proximaAbertura.getDate() + 1);
    }
    proximaAbertura.setHours(HORARIO_INICIO_HORA, 0, 0, 0);

    const tempoAteAberturaMs = proximaAbertura.getTime() - agora.getTime();
    const horasEsperando = (tempoAteAberturaMs / (1000 * 60 * 60)).toFixed(1);

    console.log('🌙 Fora do horário comercial (07h às 23h).');
    console.log(`😴 Robô pausado por aproximadamente ${horasEsperando}h.`);

    const tempoEsperaChunk = Math.min(tempoAteAberturaMs, 15 * 60 * 1000);
    await aguardar(tempoEsperaChunk);
  }
}

function obterProximoIntervaloMs() {
  const minSegundos = 19 * 60;   
  const maxSegundos = 23 * 60;  

  const segundosSorteados = Math.floor(Math.random() * (maxSegundos - minSegundos + 1)) + minSegundos;
  const minutos = Math.floor(segundosSorteados / 60);
  const segundosRestantes = segundosSorteados % 60;

  console.log(`⏳ Próximo ciclo programado para daqui a ${minutos}min e ${segundosRestantes}seg...`);
  return segundosSorteados * 1000;
}

function aguardar(tempoMs) {
  return new Promise(resolve => setTimeout(resolve, tempoMs));
}

// ==========================================
// BANCO DE DADOS
// ==========================================

async function prepararBanco() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS historico_ofertas (
      id SERIAL PRIMARY KEY,
      marketplace VARCHAR(30) DEFAULT 'shopee',
      item_id VARCHAR(64) NOT NULL,
      product_link_original TEXT NOT NULL,
      product_name TEXT NOT NULL,
      whatsapp_group_id VARCHAR(100) NOT NULL,
      enviado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      operation_id VARCHAR(100) UNIQUE NOT NULL,
      evolution_message_id VARCHAR(100)
    );
    CREATE INDEX IF NOT EXISTS idx_historico_item_group ON historico_ofertas (marketplace, item_id, whatsapp_group_id);
  `);
}

async function produtoJaFoiEnviado(itemId, targetId) {
  const resultado = await pool.query(
    `SELECT 1 FROM historico_ofertas
     WHERE marketplace = 'shopee' AND item_id = $1 AND whatsapp_group_id = $2
     AND enviado_em > NOW() - INTERVAL '7 days' LIMIT 1`,
    [String(itemId), targetId]
  );
  return resultado.rowCount > 0;
}

async function registrarEnvio(produto, targetId, operationId, messageId) {
  await pool.query(
    `INSERT INTO historico_ofertas 
     (marketplace, item_id, product_link_original, product_name, whatsapp_group_id, operation_id, evolution_message_id)
     VALUES ('shopee', $1, $2, $3, $4, $5, $6)
     ON CONFLICT (operation_id) DO NOTHING`,
    [
      String(produto.itemId),
      produto.productLink,
      produto.productName,
      targetId,
      operationId,
      messageId
    ]
  );
}

// ==========================================
// SHOPEE & EVOLUTION
// ==========================================

function obterHeadersShopee(bodyStr) {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseStr = SHOPEE_APP_ID + timestamp + bodyStr + SHOPEE_APP_SECRET;
  const signature = crypto.createHash('sha256').update(baseStr).digest('hex');

  return {
    'Content-Type': 'application/json',
    Authorization: `SHA256 Credential=${SHOPEE_APP_ID}, Timestamp=${timestamp}, Signature=${signature}`
  };
}

async function buscarOfertasShopee(keyword) {
  const page = Math.floor(Math.random() * 5) + 1;
  const queryGraphQL = {
    query: `
      query getProductOfferList($keyword: String, $page: Int) {
        productOfferV2(keyword: $keyword, listType: 0, sortType: 2, page: $page, limit: 30) {
          nodes {
            itemId
            productName
            productLink
            productCatIds
            price
            imageUrl
            sales
            ratingStar
            commissionRate
            priceDiscountRate
          }
        }
      }
    `,
    variables: { keyword, page }
  };

  const bodyStr = JSON.stringify(queryGraphQL);

  try {
    const response = await fetch(SHOPEE_GRAPHQL_URL, {
      method: 'POST',
      headers: obterHeadersShopee(bodyStr),
      body: bodyStr
    });

    const textoResposta = await response.text();
    let json;

    try { json = JSON.parse(textoResposta); } catch {
      console.error('❌ A Shopee retornou uma resposta inválida:', textoResposta.slice(0, 300));
      return [];
    }

    if (!response.ok || json.errors?.length) {
      console.error('❌ Erro na resposta da Shopee:', JSON.stringify(json.errors || json));
      return [];
    }

    return json?.data?.productOfferV2?.nodes || [];
  } catch (err) {
    console.error('❌ Erro durante a busca na Shopee:', err.message);
    return [];
  }
}

async function gerarLinkAfiliado(urlOriginal) {
  const mutationGraphQL = {
    query: `
      mutation generateShortLink($originUrl: String!, $subIds: [String!]) {
        generateShortLink(input: { originUrl: $originUrl, subIds: $subIds }) {
          shortLink
        }
      }
    `,
    variables: { originUrl: urlOriginal, subIds: [SHOPEE_SUB_ID] }
  };

  const bodyStr = JSON.stringify(mutationGraphQL);

  try {
    const response = await fetch(SHOPEE_GRAPHQL_URL, {
      method: 'POST',
      headers: obterHeadersShopee(bodyStr),
      body: bodyStr
    });

    const textoResposta = await response.text();
    let json;
    try { json = JSON.parse(textoResposta); } catch { return urlOriginal; }

    const shortLink = json?.data?.generateShortLink?.shortLink;
    if (shortLink) {
      console.log(`🔗 Link afiliado curto gerado: ${shortLink}`);
      return shortLink;
    }

    console.warn('⚠️ Não foi possível gerar shortLink, usando original:', JSON.stringify(json.errors || json));
    return urlOriginal;
  } catch (err) {
    console.warn('⚠️ Erro ao gerar link curto:', err.message);
    return urlOriginal;
  }
}

async function dispararImagemWhatsApp(legenda, imageUrl, targetId) {
  const baseUrl = EVOLUTION_BASE_URL.replace(/\/+$/, '');
  let mediaUrl = imageUrl?.startsWith('//') ? `https:${imageUrl}` : imageUrl;
  const idLimpo = targetId.replace('@g.us', '').replace('@newsletter', '');

  const payload = {
    number: idLimpo,
    mediatype: 'image',
    mimetype: 'image/jpeg',
    caption: legenda,
    media: mediaUrl
  };

  let ultimoErro = null;

  for (const instancia of INSTANCIAS) {
    const urlEnvio = `${baseUrl}/message/sendMedia/${instancia}`;

    try {
      const response = await fetch(urlEnvio, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_APIKEY },
        body: JSON.stringify(payload)
      });

      const textoResposta = await response.text();

      if (response.ok) {
        let json;
        try { json = JSON.parse(textoResposta); } catch { json = {}; }
        console.log(`  ✅ Disparado via [${instancia}] com sucesso!`);
        return json?.key?.id || json?.messageId || 'id_desconhecido';
      }

      console.warn(`  ⚠️ Instância [${instancia}] falhou com status ${response.status}.`);
      ultimoErro = new Error(`Erro na instância [${instancia}]: ${textoResposta}`);
    } catch (err) {
      console.warn(`  ⚠️ Erro na instância [${instancia}]: ${err.message}`);
      ultimoErro = err;
    }
  }

  throw new Error(`Todas as instâncias falharam para ${targetId}. Último erro: ${ultimoErro?.message || 'desconhecido'}`);
}

function normalizarComissao(rateRaw, preco) {
  const rate = Number.parseFloat(rateRaw || 0);
  const percentual = rate > 0 && rate < 1 ? rate * 100 : rate;
  const comissaoReais = preco * (percentual / 100);
  return { percentual, comissaoReais };
}

function normalizarDesconto(descontoRaw) {
  const desconto = Number.parseFloat(descontoRaw || 0);
  return (desconto > 0 && desconto < 1) ? desconto * 100 : desconto;
}

// ==========================================
// FUNIL DE FILTRAGEM & SORTEIO DO TOP 3
// ==========================================

async function tentarEncontrarProduto() {
  const { categoria, keyword } = obterProximoNichoEKeyword();
  console.log(`\n🔍 Garimpando categoria [${categoria}]: "${keyword}"...`);

  const produtos = await buscarOfertasShopee(keyword);

  if (!produtos?.length) {
    console.log('ℹ️ A Shopee não retornou produtos para esta palavra-chave.');
    return null;
  }

  // CONTADORES DO FUNIL DE PASSO A PASSO
  const recebidos = produtos.length;
  let aposPreco = 0;
  let aposComissao = 0;
  let aposVendas = 0;
  let aposAvaliacao = 0;
  let aposDesconto = 0;
  let aposRepeticao = 0;

  const qualificados = [];

  for (const produto of produtos) {
    const preco = Number.parseFloat(produto.price || 0);
    const vendas = Number.parseInt(produto.sales || 0, 10);
    const avaliacao = Number.parseFloat(produto.ratingStar || 0);
    const desconto = normalizarDesconto(produto.priceDiscountRate);
    const { percentual, comissaoReais } = normalizarComissao(produto.commissionRate, preco);

    if (!produto.itemId || !produto.productName || !produto.productLink || !produto.imageUrl || !Number.isFinite(preco) || preco <= 0) {
      continue;
    }

    // 1. Filtro de Preço
    if (preco < PRECO_MINIMO) continue;
    aposPreco++;

    // 2. Filtro de Comissão
    if (!Number.isFinite(comissaoReais) || comissaoReais < COMISSAO_MINIMA_REAIS) continue;
    aposComissao++;

    // 3. Filtro de Vendas
    if (vendas < VENDAS_MINIMAS) continue;
    aposVendas++;

    // 4. Filtro de Avaliação
    if (avaliacao < AVALIACAO_MINIMA) continue;
    aposAvaliacao++;

    // 5. Filtro de Desconto
    if (desconto < DESCONTO_MINIMO) continue;
    aposDesconto++;

    // 6. Filtro Anti-Repetição (7 Dias)
    const jaEnviado = await produtoJaFoiEnviado(produto.itemId, DESTINOS_WHATSAPP[0].id);
    if (jaEnviado) continue;
    aposRepeticao++;

    // Cálculo do Score
    const scoreComissao = comissaoReais * 15;
    const scoreDesconto = desconto * 3;
    const scoreVendas = Math.min(vendas, 5000) * 0.02;
    const score = scoreComissao + scoreDesconto + scoreVendas;

    qualificados.push({
      produto, score, preco, vendas, avaliacao, desconto, percentual, comissaoReais, categoria
    });
  }

  // EXIBIÇÃO DETALHADA DO FUNIL NO LOG
  console.log(`📊 Funil de seleção para "${keyword}":`);
  console.log(`   📦 Recebidos da Shopee: ${recebidos}`);
  console.log(`   └─ Após preço (>= R$ ${PRECO_MINIMO.toFixed(2)}): ${aposPreco}`);
  console.log(`   └─ Após comissão (>= R$ ${COMISSAO_MINIMA_REAIS.toFixed(2)}): ${aposComissao}`);
  console.log(`   └─ Após vendas (>= ${VENDAS_MINIMAS}): ${aposVendas}`);
  console.log(`   └─ Após avaliação (>= ${AVALIACAO_MINIMA}): ${aposAvaliacao}`);
  console.log(`   └─ Após desconto (>= ${DESCONTO_MINIMO}%): ${aposDesconto}`);
  console.log(`   └─ Aprovados finais (sem repetição): ${aposRepeticao}`);

  if (qualificados.length === 0) {
    console.log('ℹ️ Nenhum produto novo qualificado nesta palavra-chave.');
    return null;
  }

  // Ordena pelo maior score
  qualificados.sort((a, b) => b.score - a.score);

  // SELEÇÃO INTELIGENTE DO TOP 3 (Evita sempre o mesmo campeão fixo)
  const top3 = qualificados.slice(0, 3);
  const escolhido = top3[Math.floor(Math.random() * top3.length)];

  // DETALHAMENTO DO VENCEDOR NO LOG
  console.log(`\n🎯 Selecionado: ${escolhido.produto.productName}`);
  console.log(`⭐ Avaliação: ${escolhido.avaliacao}`);
  console.log(`🛒 Vendas: ${escolhido.vendas.toLocaleString('pt-BR')}`);
  console.log(`📉 Desconto: ${escolhido.desconto.toFixed(0)}%`);
  console.log(`📦 Categoria: ${escolhido.categoria}`);
  console.log(`💵 Preço: R$ ${escolhido.preco.toFixed(2)} | 💰 Comissão: R$ ${escolhido.comissaoReais.toFixed(2)} (${escolhido.percentual.toFixed(2)}%)\n`);

  return escolhido.produto;
}

// ==========================================
// ENVIO
// ==========================================

async function enviarProdutoSelecionado(selecionado) {
  const shortLink = await gerarLinkAfiliado(selecionado.productLink);
  const precoAtual = Number.parseFloat(selecionado.price || 0);
  const descontoPercent = normalizarDesconto(selecionado.priceDiscountRate);

  const precoOriginal = (descontoPercent > 0 && descontoPercent < 100)
    ? precoAtual / (1 - descontoPercent / 100)
    : precoAtual;

  const nomeExibicao = selecionado.productName.length > 75
    ? `${selecionado.productName.slice(0, 75)}...`
    : selecionado.productName;

  const textoMensagem = 
`🔥 *SUPER OFERTA SHOPEE* 🔥

🛍️ *${nomeExibicao}*

💸 De: ~R$ ${precoOriginal.toFixed(2).replace('.', ',')}~
💰 Por: *R$ ${precoAtual.toFixed(2).replace('.', ',')}*

📉 Desconto: *${descontoPercent.toFixed(0)}% OFF*

👉 Compre aqui:
${shortLink}`;

  for (let indice = 0; indice < DESTINOS_WHATSAPP.length; indice++) {
    const destino = DESTINOS_WHATSAPP[indice];
    console.log(`📢 Enviando para [${destino.nome}]...`);

    try {
      const destinoLimpo = destino.id.replace(/[@.]/g, '');
      const operationId = `op_${selecionado.itemId}_${destinoLimpo}_${Date.now()}`;
      const messageId = await dispararImagemWhatsApp(textoMensagem, selecionado.imageUrl, destino.id);

      await registrarEnvio(selecionado, destino.id, operationId, messageId);
      console.log(`  🗄️ Envio registrado no histórico.`);

      if (indice < DESTINOS_WHATSAPP.length - 1) {
        await aguardar(10000);
      }
    } catch (err) {
      console.error(`  ❌ Falha ao enviar para [${destino.nome}]:`, err.message);
    }
  }
}

// ==========================================
// CICLO DE EXECUÇÃO
// ==========================================

async function executarCiclo() {
  console.log('\n==========================================');
  console.log(`🤖 Iniciando ciclo de garimpo às ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_POR_CICLO; tentativa++) {
    console.log(`\n🔎 Tentativa ${tentativa}/${MAX_TENTATIVAS_POR_CICLO}`);

    const produtoSelecionado = await tentarEncontrarProduto();

    if (produtoSelecionado) {
      await enviarProdutoSelecionado(produtoSelecionado);
      console.log('🎉 Ciclo concluído com uma oferta enviada!');
      return true;
    }

    if (tentativa < MAX_TENTATIVAS_POR_CICLO) {
      console.log(`🔄 Nenhuma oferta aprovada. Nova palavra-chave em ${PAUSA_ENTRE_TENTATIVAS_MS / 1000}s...`);
      await aguardar(PAUSA_ENTRE_TENTATIVAS_MS);
    }
  }

  console.log(`ℹ️ Nenhum produto aprovado após ${MAX_TENTATIVAS_POR_CICLO} palavras-chave.`);
  return false;
}

async function iniciar() {
  try {
    await prepararBanco();
    console.log('🚀 Robô de Ofertas Ativo com Funil Detalhado e Sorteio de Top 3!');

    while (true) {
      try {
        await verificarEAguardarHorarioComercial();
        await executarCiclo();
      } catch (err) {
        console.error('❌ Erro na rotina principal:', err.message);
        if (String(err.message).includes('ECONNRESET')) await aguardar(2 * 60 * 1000);
      }

      const proximoIntervaloMs = obterProximoIntervaloMs();
      await aguardar(proximoIntervaloMs);
    }
  } catch (err) {
    console.error('❌ Não foi possível iniciar o robô:', err.message);
    process.exit(1);
  }
}

iniciar();