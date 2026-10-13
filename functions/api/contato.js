/**
 * POST /api/contato
 *
 * Recebe o formulário do site e encaminha a mensagem por e-mail, usando a API
 * de envio da Cloudflare.
 *
 * O token fica em variável secreta do projeto (EMAIL_TOKEN) e nunca no repositório.
 * O identificador da conta e o remetente não são segredo: aparecem em qualquer
 * requisição para a API da Cloudflare e não dão acesso a nada sozinhos.
 *
 * O Pages não suporta binding de e-mail, por isso aqui a chamada é HTTP direta
 * para o endpoint de envio em vez de usar `send_email`.
 */

const CONTA = '3e45ec96568bdb544364ecb331970bb2';
const REMETENTE = { address: 'contato@gxsoftware.geiltonxavier.com', name: 'Site GX Software' };
const DESTINO = 'geilton@live.com';
const ENDPOINT = 'https://api.cloudflare.com/client/v4/accounts/' + CONTA + '/email/sending/send';

const MAX = { nome: 120, email: 200, assunto: 160, mensagem: 5000 };

function responder(corpo, status) {
  return new Response(JSON.stringify(corpo), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

/* Corta no tamanho máximo e remove quebras de linha. A remoção importa:
   sem ela, um assunto com \n permitiria injetar cabeçalho no e-mail. */
function limpar(valor, max) {
  if (typeof valor !== 'string') return '';
  return valor.replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function pareceEmail(valor) {
  return valor.length <= MAX.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor);
}

function agoraEmSaoPaulo() {
  try {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch (_) {
    return new Date().toISOString();
  }
}

function escaparHtml(valor) {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function onRequestPost({ request, env }) {
  if (!env.EMAIL_TOKEN) {
    return responder(
      { erro: 'O envio pelo site ainda não está ligado. Fale pelo WhatsApp enquanto isso.' },
      503
    );
  }

  let dados;
  try {
    dados = await request.json();
  } catch (_) {
    return responder({ erro: 'Não consegui ler os dados enviados.' }, 400);
  }

  /* Armadilha 1: campo escondido que só robô preenche. Devolve sucesso para o
     robô não aprender o que falhou. */
  if (limpar(dados.website, 200) !== '') {
    return responder({ ok: true });
  }

  /* Armadilha 2: ninguém escreve uma mensagem em menos de 3 segundos. */
  const decorrido = Number(dados.decorrido);
  if (!Number.isFinite(decorrido) || decorrido < 3000) {
    return responder({ erro: 'Envio rápido demais. Recarregue a página e tente de novo.' }, 400);
  }

  const nome = limpar(dados.nome, MAX.nome);
  const email = limpar(dados.email, MAX.email);
  const assunto = limpar(dados.assunto, MAX.assunto);
  const mensagem = String(dados.mensagem || '').trim().slice(0, MAX.mensagem);

  if (nome.length < 2) return responder({ erro: 'Preciso do seu nome.' }, 400);
  if (!pareceEmail(email)) return responder({ erro: 'Confira o e-mail, parece incompleto.' }, 400);
  if (mensagem.length < 10) {
    return responder({ erro: 'Escreva um pouco mais sobre o que você precisa.' }, 400);
  }

  const quando = agoraEmSaoPaulo();
  const linhaAssunto = assunto || 'Contato de ' + nome;

  const texto = [
    'Nova mensagem pelo site da GX Software.',
    '',
    'Nome: ' + nome,
    'E-mail: ' + email,
    'Assunto: ' + linhaAssunto,
    'Recebido em: ' + quando,
    '',
    'Mensagem:',
    mensagem,
    '',
    '---',
    'Responder este e-mail responde direto para quem escreveu.'
  ].join('\n');

  const html = [
    '<p>Nova mensagem pelo site da GX Software.</p>',
    '<p>',
    '<b>Nome:</b> ' + escaparHtml(nome) + '<br>',
    '<b>E-mail:</b> ' + escaparHtml(email) + '<br>',
    '<b>Assunto:</b> ' + escaparHtml(linhaAssunto) + '<br>',
    '<b>Recebido em:</b> ' + escaparHtml(quando),
    '</p>',
    '<p><b>Mensagem:</b></p>',
    '<p style="white-space:pre-wrap">' + escaparHtml(mensagem) + '</p>',
    '<hr>',
    '<p style="color:#666;font-size:13px">Responder este e-mail responde direto para quem escreveu.</p>'
  ].join('');

  let resposta;
  try {
    resposta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + env.EMAIL_TOKEN,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        from: REMETENTE,
        to: DESTINO,
        reply_to: email,
        subject: '[Site] ' + linhaAssunto,
        text: texto,
        html: html
      })
    });
  } catch (_) {
    return responder({ erro: 'Não consegui falar com o serviço de e-mail. Use o WhatsApp.' }, 502);
  }

  const resultado = await resposta.json().catch(function () { return null; });

  if (!resposta.ok || !resultado || resultado.success !== true) {
    return responder({ erro: 'O envio não passou. Use o WhatsApp ou o e-mail direto.' }, 502);
  }

  return responder({ ok: true });
}
