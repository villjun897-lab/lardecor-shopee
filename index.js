import fetch from 'node-fetch';
import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;

// ==========================================
// CONFIGURAÇÕES E CREDENCIAIS ATUALIZADAS
// ==========================================

// Lista de até 5 instâncias para redundância/fallback automático
const INSTANCIAS = [
  process.env.EVOLUTION_INSTANCE_NAME || 'lardecor-shopee-2',
  process.env.EVOLUTION_INSTANCE_2 || 'lardecor-shopee-3',
  process.env.EVOLUTION_INSTANCE_3 || 'lardecor-shopee-4',
  process.env.EVOLUTION_INSTANCE_4 || 'lardecor-shopee-5',
  process.env.EVOLUTION_INSTANCE_5 || 'lardecor-shopee'
].filter(Boolean);

const EVOLUTION_BASE_URL = process.env.EVOLUTION_API_URL || 'https://evolution-api-production-1961.up.railway.app';

// Chave específica atualizada da instância lardecor-shopee-2
const EVOLUTION_APIKEY = process.env.EVOLUTION_API_KEY || '200A6B55F0B6-4129-BE1A-2AD93DAF2E46';

// ID Atualizado do Novo Grupo "Ofertas LarDecór"
const WHATSAPP_GRUPO_ID = process.env.WHATSAPP_GROUP_ID || '120363426165901005@g.us';

const SHOPEE_APP_ID = process.env.SHOPEE_APP_ID || '18363541104';
const SHOPEE_APP_SECRET = process.env.SHOPEE_APP_SECRET || 'BAOH7TTUUWYUKL3OPJIKT6Z67IRL2G6E';
const SHOPEE_GRAPHQL_URL = 'https://open-api.affiliate.shopee.com.br/graphql';
const SHOPEE_SUB_ID = process.env.SHOPEE_SUB_ID || 'lardecor';

// Regras e Filtros Comerciais
const PRECO_MINIMO = 30.00;
const COMISSAO_MINIMA_REAIS = 5.00;
const VENDAS_MINIMAS = 50;
const AVALIACAO_MINIMA = 4.3;
const DESCONTO_MINIMO = 15;
const INTERVALO_MINUTOS = 12;

// Conexão com o Banco de Dados Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const NICHOS = [
  "celular smartphone",
  "fone sem fio bluetooth",
  "eletrodomésticos",
  "ferramentas furadeira",
  "produto cabelo",
  "perfume importado",
  "casa cozinha",
  "conjunto feminino",
  "camiseta masculina"
];

// ==========================================
// FUNÇÕES DO BANCO DE DADOS
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
    CREATE INDEX IF NOT EXISTS idx_historico_item_group ON historico_ofertas(marketplace, item_id, whatsapp_group_id);
  `);
}

async function produtoJaFoiEnviado(itemId) {
  const res = await pool.query(
    `SELECT 1 FROM historico_ofertas 
     WHERE item_id = $1 AND whatsapp_group_id = $2 
     AND enviado_em > NOW() - INTERVAL '7 days' LIMIT 1`,
    [String(itemId), WHATSAPP_GRUPO_ID]
  );
  return res.rowCount > 0;
}

async function registrarEnvio(produto, operationId, messageId) {
  await pool.query(
    `INSERT INTO historico_ofertas 
     (marketplace, item_id, product_link_original, product_name, whatsapp_group_id, operation_id, evolution_message_id)
     VALUES ('shopee', $1, $2, $3, $4, $5, $6)
     ON CONFLICT (operation_id) DO NOTHING`,
    [
      String(produto.itemId),
      produto.productLink,
      produto.productName,
      WHATSAPP_GRUPO_ID,
      operationId,
      messageId
    ]
  );
}

// ==========================================
// INTEGRAÇÃO SHOPEE
// ==========================================
function obterHeadersShopee(bodyStr) {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseStr = SHOPEE_APP_ID + timestamp + bodyStr + SHOPEE_APP_SECRET;
  const signature = crypto.createHash('sha256').update(baseStr).digest('hex');

  return {
    'Content-Type': 'application/json',
    'Authorization': `SHA256 Credential=${SHOPEE_APP_ID}, Timestamp=${timestamp}, Signature=${signature}`
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
    const json = await response.json();
    return json?.data?.productOfferV2?.nodes || [];
  } catch (err) {
    console.error('❌ Erro na busca:', err.message);
    return [];
  }
}

async function gerarLinkAfiliado(urlOriginal) {
  const mutationGraphQL = {
    query: `
      mutation generateShortLink($originUrl: String!, $subId: String) {
        generateShortLink(input: { originUrl: $originUrl, subIds: [$subId] }) {
          shortLink
        }
      }
    `,
    variables: { originUrl: urlOriginal, subId: SHOPEE_SUB_ID }
  };

  const bodyStr = JSON.stringify(mutationGraphQL);
  try {
    const response = await fetch(SHOPEE_GRAPHQL_URL, {
      method: 'POST',
      headers: obterHeadersShopee(bodyStr),
      body: bodyStr
    });
    const json = await response.json();
    return json?.data?.generateShortLink?.shortLink || urlOriginal;
  } catch (err) {
    return urlOriginal;
  }
}

// ==========================================
// INTEGRAÇÃO EVOLUTION API (COM REDUNDÂNCIA)
// ==========================================
async function dispararImagemWhatsApp(legenda, imageUrl) {
  const baseUrl = EVOLUTION_BASE_URL.replace(/\/+$/, '');

  let mediaUrl = imageUrl;
  if (mediaUrl && mediaUrl.startsWith('//')) {
    mediaUrl = `https:${mediaUrl}`;
  }

  const payload = {
    number: WHATSAPP_GRUPO_ID,
    mediatype: 'image',
    mimetype: 'image/jpeg',
    caption: legenda,
    media: mediaUrl
  };

  let ultimoErro = null;

  // Testa as instâncias na fila até uma conseguir realizar o disparo
  for (const instancia of INSTANCIAS) {
    const urlEnvio = `${baseUrl}/message/sendMedia/${instancia}`;
    console.log(`📡 Tentando disparar pela instância: [${instancia}]...`);

    try {
      new URL(urlEnvio);
      new URL(mediaUrl);

      const response = await fetch(urlEnvio, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_APIKEY
        },
        body: JSON.stringify(payload)
      });

      const textoResposta = await response.text();

      if (response.ok) {
        let json;
        try { json = JSON.parse(textoResposta); } catch (e) { json = {}; }
        console.log(`✅ Sucesso no disparo via [${instancia}]!`);
        return json?.key?.id || json?.messageId || 'id_desconhecido';
      }

      console.warn(`⚠️ Instância [${instancia}] falhou (${response.status}). Tentando a próxima...`);
      ultimoErro = new Error(`Erro [${instancia}]: ${textoResposta}`);
    } catch (err) {
      console.warn(`⚠️ Erro na instância [${instancia}]: ${err.message}`);
      ultimoErro = err;
    }
  }

  // Lança erro caso todas as instâncias falhem
  throw new Error(`Todas as instâncias configuradas falharam. Último erro: ${ultimoErro?.message}`);
}

function normalizarComissao(rateRaw, preco) {
  const rate = parseFloat(rateRaw || 0);
  const percentual = rate < 1 ? rate * 100 : rate;
  const comissaoReais = preco * (percentual / 100);
  return { percentual, comissaoReais };
}

// ==========================================
// CICLO DE EXECUÇÃO DO ROBÔ
// ==========================================
async function executarCiclo() {
  const buscaSorteada = NICHOS[Math.floor(Math.random() * NICHOS.length)];
  console.log(`\n🔍 Garimpando: "${buscaSorteada}"...`);

  const produtos = await buscarOfertasShopee(buscaSorteada);
  if (!produtos || produtos.length === 0) return;

  const qualificados = [];

  for (const p of produtos) {
    const preco = parseFloat(p.price || 0);
    const vendas = parseInt(p.sales || 0, 10);
    const avaliacao = parseFloat(p.ratingStar || 0);
    const desconto = parseFloat(p.priceDiscountRate || 0);
    const { comissaoReais } = normalizarComissao(p.commissionRate, preco);

    if (
      preco >= PRECO_MINIMO &&
      comissaoReais >= COMISSAO_MINIMA_REAIS &&
      vendas >= VENDAS_MINIMAS &&
      avaliacao >= AVALIACAO_MINIMA &&
      desconto >= DESCONTO_MINIMO
    ) {
      const jaEnviado = await produtoJaFoiEnviado(p.itemId);
      if (!jaEnviado) {
        const score = (comissaoReais * 10) + (desconto * 2) + (vendas * 0.05);
        qualificados.push({ produto: p, score, comissaoReais });
      }
    }
  }

  if (qualificados.length === 0) return;

  qualificados.sort((a, b) => b.score - a.score);
  const selecionado = qualificados[0].produto;

  console.log(`🎯 Selecionado: ${selecionado.productName}`);

  const shortLink = await gerarLinkAfiliado(selecionado.productLink);
  const precoAtual = parseFloat(selecionado.price);
  const descontoPercent = parseFloat(selecionado.priceDiscountRate || 0);
  const precoOriginal = descontoPercent > 0 ? precoAtual / (1 - descontoPercent / 100) : precoAtual;

  const nomeExibicao = selecionado.productName.length > 75 
    ? selecionado.productName.slice(0, 75) + '...' 
    : selecionado.productName;

  const textoMensagem = 
`🔥 *SUPER OFERTA SHOPEE* 🔥

🛍️ *${nomeExibicao}*

💸 De: ~R$ ${precoOriginal.toFixed(2).replace('.', ',')}~
💰 Por: *R$ ${precoAtual.toFixed(2).replace('.', ',')}*

📉 Desconto: *${descontoPercent}% OFF*

👉 Compre aqui:
${shortLink}`;

  const operationId = `op_${selecionado.itemId}_${Date.now()}`;
  const messageId = await dispararImagemWhatsApp(textoMensagem, selecionado.imageUrl);

  await registrarEnvio(selecionado, operationId, messageId);
  console.log('✅ Oferta disparada no grupo com sucesso!');
}

async function iniciar() {
  await prepararBanco();
  console.log('🚀 Robô de Ofertas Ativo!');

  while (true) {
    try {
      await executarCiclo();
    } catch (err) {
      console.error('❌ Erro na rotina:', err.message);

      // Tratamento para dar uma pausa se todas as conexões falharem
      if (err.message.includes('Connection Closed') || err.message.includes('Status 500')) {
        console.log('⚠️ Erro de conexão nas instâncias. Aguardando 2 minutos para tentar novamente...');
        await new Promise(resolve => setTimeout(resolve, 2 * 60 * 1000));
      }
    }
    await new Promise(resolve => setTimeout(resolve, INTERVALO_MINUTOS * 60 * 1000));
  }
}

iniciar();