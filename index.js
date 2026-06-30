import fetch from 'node-fetch';
import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

//if (!process.env.DATABASE_URL) {
  //console.error("❌ DATABASE_URL não encontrada");
  //process.exit(1);
//}

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
  "produto cabelo",
  "tratamento cabelo",
  "cuidados cabelo",
  "beleza feminina",
  "perfume importado",
  "hidratante corporal",
  "body splash",

  "eletrodomésticos",
  "eletroportáteis",
  "celular smartphone",
  "tablet notebook",
  "fone sem fio bluetooth",

  "moda",
  "cueca",
  "meia",
  "vestido feminino",
"blusa feminina",
"calça feminina",
"conjunto feminino",
"jaqueta feminina",

"camiseta masculina",
"calça masculina",
"bermuda masculina",
"jaqueta masculina",
"moletom masculino",

"conjunto infantil",
"roupa infantil",
"vestido infantil",
"moletom infantil",
"jaqueta infantil"

  "calçados femininos",
  "calçados masculinos",
  "calçados infantis",

  "bolsas femininas",
  "mochilas malas viagem",

  "mãe bebê",
  "casa cozinha",
  "mesa banho",

  "kit cozinha",
  "kit banheiro",
  "kit organização",
  "kit perfume",
  "kit skincare",
  "kit cabelo",
  "kit maquiagem",
  "kit bebê",
  "kit mesa posta",
  "kit cama",
  "kit toalha",
  "kit lingerie",
  "kit cueca",
  "kit meias",

  "ferramentas furadeira parafusadeira",
  "esporte lazer",
  "saúde bem estar",
  "joias relógios acessórios"
];

// Cache do ID do grupo para evitar requisições repetidas após encontrá-lo
let whatsappGrupoIdCache = null;

// ==========================================
//   2. GERADOR DE AUTENTICAÇÃO SHOPEE
// ==========================================

async function prepararBanco() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS produtos_enviados (
      id SERIAL PRIMARY KEY,
      product_link TEXT UNIQUE NOT NULL,
      product_name TEXT,
      enviado_em TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function produtoJaFoiEnviado(productLink) {
  const resultado = await pool.query(
    'SELECT 1 FROM produtos_enviados WHERE product_link = $1 LIMIT 1',
    [productLink]
  );

  return resultado.rowCount > 0;
}

async function registrarProdutoEnviado(produto) {
  await pool.query(
    `INSERT INTO produtos_enviados (product_link, product_name)
     VALUES ($1, $2)
     ON CONFLICT (product_link) DO NOTHING`,
    [produto.productLink, produto.productName]
  );
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
  
const paginaAleatoria = Math.floor(Math.random() * 10) + 1;

console.log(`🔍 Busca: ${nichoDoMomento} | Página: ${paginaAleatoria}`);

  const queryGraphQL = {
    query: `
      query getProductOfferList($keyword: String, $page: Int) {
        productOfferV2(keyword: $keyword, listType: 0, sortType: 2, page: $page, limit: 30) {
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
    variables: {
  keyword: nichoDoMomento,
  page: paginaAleatoria
}
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


const produtosValidos = [];

for (const p of produtos) {
  const preco = parseFloat(p.price);
  const vendas = Number(p.sales || 0);
  const nota = parseFloat(p.ratingStar || 0);
  const desconto = Number(p.priceDiscountRate || 0);
  const comissao = parseFloat(p.commissionRate || 0);
  const comissaoReais = preco * comissao;

const nomeProduto = p.productName.toLowerCase();

const palavrasBloqueadas = [
  "fio",
  "conector",
  "terminal",
  "parafuso",
  "porca",
  "arruela",
  "resistor",
  "placa",
  "sensor",
  "adaptador",
  "etiqueta",
  "saquinho",
  "embalagem"
];

if (palavrasBloqueadas.some(palavra => nomeProduto.includes(palavra))) {
  console.log(`🚫 Bloqueado: ${p.productName}`);
  continue;
}

const produtoDestaque =
  nomeProduto.includes("kit") ||
  nomeProduto.includes("combo") ||
  nomeProduto.includes("leve") ||
  nomeProduto.includes("brinde");

console.log(
    `💰 Comissão: R$ ${comissaoReais.toFixed(2)} | ${p.productName}`
);
  
    const jaEnviado = await produtoJaFoiEnviado(p.productLink);

if (
  preco >= PRECO_MINIMO &&
  comissaoReais >= (produtoDestaque ? 4 : 5) &&
  vendas >= 500 &&
  nota >= 4.3 &&
  desconto >= 15 &&
  !jaEnviado
) {
  produtosValidos.push(p);
}
}

if (produtosValidos.length === 0) {
  console.log('Nenhum produto válido encontrado.');
  return;
}

const produtoValido = produtosValidos.sort((a, b) => {

  const scoreA =
  (a.price || 0) *
  (a.price || 0) *
  (a.sales || 0) *
  (a.commissionRate || 0);

const scoreB =
  (b.price || 0) *
  (b.price || 0) *
  (b.sales || 0) *
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

  const precoAtual = parseFloat(produtoValido.price);
const desconto = parseFloat(produtoValido.priceDiscountRate || 0);

const precoOriginal = desconto > 0
  ? precoAtual / (1 - desconto / 100)
  : precoAtual;

const precoOriginalFormatado = precoOriginal.toFixed(2).replace('.', ',');
const precoAtualFormatado = precoAtual.toFixed(2).replace('.', ',');

const textoMensagem =
`🔥 *SUPER OFERTA SHOPEE* 🔥

🛍️ *${nomeResumido}*

💸 De: ~R$ ${precoOriginalFormatado}~
💰 Por: *R$ ${precoAtualFormatado}*

📉 Desconto: *${produtoValido.priceDiscountRate}% OFF*


👉 Compre aqui:
${linkAfiliadoPronto}`;

await dispararImagemNoWhatsApp(textoMensagem, produtoValido.imageUrl);

await registrarProdutoEnviado(produtoValido);

console.log('✅ Produto registrado no PostgreSQL');
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

    console.log(`\n🕒 Executando rotina (${horaBrasil}h)...`);
    await executarRoboDeOfertas();

    const intervalosPermitidos = [10, 15];
    const minutosDeEspera =
      intervalosPermitidos[Math.floor(Math.random() * intervalosPermitidos.length)];

    console.log(`🤖 Delay Dinâmico: Aguardando exatamente ${minutosDeEspera} minutos para a próxima ação...`);
    await esperar(minutosDeEspera);
  }
}

await prepararBanco();
iniciarFluxoAutomatico();
