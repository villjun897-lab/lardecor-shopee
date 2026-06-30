import fetch from 'node-fetch';
import crypto from 'crypto';
import fs from 'fs';

// ==========================================
//   1. CONFIGURAÇÕES DO USUÁRIO & CREDENCIAIS
// ==========================================
const INSTANCIA = 'ofertas-lardecor';
const EVOLUTION_BASE_URL = 'https://evolution-api-production-1961.up.railway.app';
const EVOLUTION_APIKEY = '84E8B2657F31-4176-A102-1C384DE7A1D8';

const SHOPEE_APP_ID = '18363541104';
const SHOPEE_APP_SECRET = 'BAOH7TTUUWYUKL3OPJIKT6Z67IRL2G6E';
const SHOPEE_GRAPHQL_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

// --- FILTROS DE QUALIDADE DA START ---
const PRECO_MINIMO = 30.00; 

const NICHOS = [
  "casa",
  "cozinha",
  "decoração",
  "beleza",
  "moda",
  "infantil",
  "eletrônicos",
  "esporte",
  "fitness",
  "ferramentas",
  "automotivo",
  "pet"
];

// Cache do ID do grupo para evitar requisições repetidas após encontrá-lo
let whatsappGrupoIdCache = null;

// ==========================================
//   2. GERADOR DE AUTENTICAÇÃO SHOPEE
// ==========================================

function carregarEnviados() {
  try {
    return JSON.parse(fs.readFileSync('enviados.json', 'utf8'));
  } catch {
    return [];
  }
}

function salvarEnviados(lista) {
  fs.writeFileSync('enviados.json', JSON.stringify(lista, null, 2));
}

async function buscarCupomOuCampanhaShopee() {
  const queryGraphQL = {
    query: `
      query buscarCampanhas {
        shopeeOfferV2(keyword: "cupom", sortType: 1, page: 1, limit: 5) {
          nodes {
  productName
  productLink
  price
  imageUrl
  sales
  ratingStar
  commissionRate
  priceDiscountRate
}
        }
      }
    `
  };

  const bodyStr = JSON.stringify(queryGraphQL);
  const headers = obterHeadersAutenticados(bodyStr);

  try {
    const response = await fetch(SHOPEE_GRAPHQL_URL, {
      method: 'POST',
      headers,
      body: bodyStr
    });

    const textoBruto = await response.text();
    console.log('\n🎟️ [LOG BRUTO SHOPEE - CUPONS/CAMPANHAS]:', textoBruto);

    const resultado = JSON.parse(textoBruto);
    return resultado?.data?.shopeeOfferV2?.nodes || [];
  } catch (error) {
    console.error('❌ Erro ao buscar campanhas/cupons:', error);
    return [];
  }
}

function obterHeadersAutenticados(bodyStr) {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseStr = SHOPEE_APP_ID + timestamp + bodyStr + SHOPEE_APP_SECRET;
  const signature = crypto.createHash('sha256').update(baseStr).digest('hex');

  return {
    'Content-Type': 'application/json',
    'Authorization': `SHA256 Credential=${SHOPEE_APP_ID}, Timestamp=${timestamp}, Signature=${signature}`
  };
}

// ==========================================
//   3. OPERAÇÕES GRAPHQL DA SHOPEE
// ==========================================
async function garimparMelhoresOfertas() {
  const nichoDoMomento = NICHOS[Math.floor(Math.random() * NICHOS.length)];
  
  const queryGraphQL = {
    query: `
      query getProductOfferList($keyword: String) {
        productOfferV2(keyword: $keyword, listType: 0, sortType: 2, page: 1, limit: 10) {
  nodes {
    productName
    productLink
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
    variables: { keyword: nichoDoMomento }
  };

  const bodyStr = JSON.stringify(queryGraphQL);
  const headers = obterHeadersAutenticados(bodyStr);

  try {
    const response = await fetch(SHOPEE_GRAPHQL_URL, {
      method: 'POST',
      headers: headers,
      body: bodyStr
    });

    const textoBruto = await response.text();
    // Reativado o log bruto da Shopee para validação visual contínua
    console.log(`\n🔍 [LOG BRUTO SHOPEE - BUSCA]:`, textoBruto);

    const resultado = JSON.parse(textoBruto);
    return resultado?.data?.productOfferV2?.nodes || [];
  } catch (error) {
    console.error('❌ Erro crítico no GraphQL da Shopee:', error);
    return [];
  }
}

async function gerarLinkAfiliado(urlProduto) {
  const mutationGraphQL = {
    query: `
      mutation generateShortLink($originUrl: String!) {
        generateShortLink(input: {
          originUrl: $originUrl,
          subIds: ["lardecor"]
        }) {
          shortLink
        }
      }
    `,
    variables: { originUrl: urlProduto }
  };

  const bodyStr = JSON.stringify(mutationGraphQL);
  const headers = obterHeadersAutenticados(bodyStr);

  try {
    const response = await fetch(SHOPEE_GRAPHQL_URL, {
      method: 'POST',
      headers: headers,
      body: bodyStr
    });

    const textoBruto = await response.text();
    console.log(`\n🔍 [LOG BRUTO SHOPEE - LINK]:`, textoBruto);

    const resultado = JSON.parse(textoBruto);
    return resultado?.data?.generateShortLink?.shortLink || urlProduto;
  } catch (error) {
    return urlProduto;
  }
}

async function buscarIdDoGrupoPeloNome() {
  return '120363427655183555@g.us';
}

async function dispararImagemNoWhatsApp(textoMensagem, imagemUrl) {
  const grupoId = await buscarIdDoGrupoPeloNome();

  const urlEnvio = `${EVOLUTION_BASE_URL}/message/sendMedia/${INSTANCIA}`;

  const payload = {
    number: grupoId,
    mediatype: 'image',
    mimetype: 'image/jpeg',
    caption: textoMensagem,
    media: imagemUrl
  };

  const response = await fetch(urlEnvio, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': EVOLUTION_APIKEY
    },
    body: JSON.stringify(payload)
  });

  const textoEvolution = await response.text();

  console.log(`\n📬 [STATUS EVOLUTION IMAGEM]:`, response.status);
  console.log(`📬 [RESPOSTA EVOLUTION IMAGEM]:`, textoEvolution);
}

// Coordenação Geral do Robô
async function executarRoboDeOfertas() {
  console.log('🤖 Iniciando varredura automatizada no GraphQL da Shopee...');
  
  const produtos = await garimparMelhoresOfertas();
  if (!produtos || produtos.length === 0) {
    console.log('⚠️ Nenhuma oferta válida extraída nesta rodada.');
    return;
  }

  const produtosJaEnviados = carregarEnviados();

const produtosValidos = produtos.filter(p => {
  const preco = parseFloat(p.price);
  const vendas = Number(p.sales || 0);
  const nota = parseFloat(p.ratingStar || 0);
  const desconto = Number(p.priceDiscountRate || 0);
  const comissao = parseFloat(p.commissionRate || 0);

  return (
   preco >= PRECO_MINIMO &&
  vendas >= 1000 &&
  nota >= 4.6 &&
  desconto >= 20 &&
  comissao >= 0.06 &&
  !produtosJaEnviados.includes(p.productLink)
);
});

if (produtosValidos.length === 0) {
  console.log('Nenhum produto válido encontrado.');
  return;
}

const produtoValido = produtosValidos.sort((a, b) => {

  const scoreA =
    (a.sales || 0) *
    (a.priceDiscountRate || 0) *
    (a.commissionRate || 0);

  const scoreB =
    (b.sales || 0) *
    (b.priceDiscountRate || 0) *
    (b.commissionRate || 0);

  return scoreB - scoreA;

})[0];

  if (!produtoValido) {
    console.log(`💸 Produtos abaixo do ticket mínimo de R$ ${PRECO_MINIMO}. Pulando ciclo...`);
    return;
  }

  console.log(`🎯 Produto selecionado: ${produtoValido.productName} - R$ ${produtoValido.price}`);

  const linkAfiliadoPronto = await gerarLinkAfiliado(produtoValido.productLink);

const nomeResumido = produtoValido.productName.length > 80
  ? produtoValido.productName.slice(0, 80) + '...'
  : produtoValido.productName;

const textoMensagem = `🔥 *ACHADINHO COM DESCONTO!* 🔥\n\n` +
                      `🛍️ *${nomeResumido}*\n\n` +
                      `💰 Por: *R$ ${produtoValido.price}*\n` +
                      `📉 Desconto: *${produtoValido.priceDiscountRate}% OFF*\n` +
                      `⭐ Avaliação: *${produtoValido.ratingStar}*\n` +
                      `🔥 Vendidos: *${produtoValido.sales}*\n\n` +
                      `👉 Compre aqui:\n${linkAfiliadoPronto}`;

await dispararImagemNoWhatsApp(textoMensagem, produtoValido.imageUrl);

produtosJaEnviados.push(produtoValido.productLink);
salvarEnviados(produtosJaEnviados);

console.log('✅ Produto registrado no enviados.json');
}

// ==========================================
//   5. TEMPORIZADOR INTELIGENTE (HUMANIZADO)
// ==========================================
const esperar = (tempoEmMinutos) => new Promise(resolve => setTimeout(resolve, tempoEmMinutos * 60 * 1000));

async function iniciarFluxoAutomatico() {
  while (true) {
    const horaBrasil = Number(
      new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: 'numeric',
        hour12: false
      }).format(new Date())
    );

    if (horaBrasil >= 7 && horaBrasil < 24) {
      console.log(`\n🕒 Horário comercial válido (${horaBrasil}h). Rodando rotina...`);
      await executarRoboDeOfertas();
    } else {
      console.log(`\n💤 Fora do horário comercial (${horaBrasil}h). Aguardando próximo ciclo...`);
    }

    const intervalosPermitidos = [0.5, 1, 1.5];
    const minutosDeEspera = intervalosPermitidos[Math.floor(Math.random() * intervalosPermitidos.length)];

    console.log(`🤖 Delay Dinâmico: Aguardando exatamente ${minutosDeEspera} minutos para a próxima ação...`);
    await esperar(minutosDeEspera);
  }
}

iniciarFluxoAutomatico();
