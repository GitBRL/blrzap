# Disparos WhatsApp (uazapi)

Painel para disparo em massa no WhatsApp pela API da [uazapi](https://docs.uazapi.com): importe um CSV, filtre os contatos, escreva um template personalizado com as colunas da planilha e acompanhe o envio em tempo real. Opcionalmente, envie botões de interesse e qualifique os leads pelo faturamento.

- **Frontend:** Vite + React (`client/`)
- **Backend:** Node + Express (`server/`) — guarda o token da uazapi e executa a fila de envio
- **Compartilhado:** template e normalização de telefones (`shared/`), usados pela prévia e pelo envio

## Como rodar

```bash
npm install
cp .env.example .env        # opcional: dá para configurar a uazapi pela tela
npm run dev                 # API em :3001 + Vite em http://localhost:5173
```

Produção (um único processo serve a API e o build do frontend):

```bash
npm run build
npm start                   # http://localhost:3001
```

Na primeira vez, clique no status no canto superior direito e informe a **Server URL** (ex.: `https://seusubdominio.uazapi.com`) e o **token da instância**. O token fica salvo apenas no servidor (`data/config.json`).

Para publicar no Railway, siga o [DEPLOY.md](DEPLOY.md).

### Login

Defina a senha do administrador no `.env`:

```bash
ADMIN_USER=admin          # opcional, padrão "admin"
ADMIN_PASSWORD=uma-senha-forte
```

O painel abre numa tela de login (usuário `admin` + essa senha). A sessão fica num cookie seguro (`HttpOnly`) por 12 h, ou 30 dias com “Manter conectado”. Depois de 10 senhas erradas em 15 min, o login é bloqueado temporariamente. Trocar a senha no `.env` encerra todas as sessões. Ficam fora do login apenas `/api/health` e o webhook da uazapi, que valida o próprio token.

> Sem `ADMIN_PASSWORD`, o painel fica **sem login** (o log avisa). Não publique assim: qualquer pessoa com o endereço conseguiria enviar mensagens pelo seu número.

## CSV

- Cabeçalho na primeira linha; separador `,` ou `;` (detectado automaticamente); UTF-8 ou o padrão do Excel (Windows-1252).
- A coluna de telefone é detectada pelo nome (`telefone`, `celular`, `whatsapp`…) e pode ser trocada na tela.
- Números sem DDI recebem o DDI padrão (55). Inválidos e duplicados são ignorados e aparecem no relatório.
- Há um modelo em `client/public/exemplo-contatos.csv` (link “Baixar CSV de exemplo” na tela).
- **Filtros:** envie só para as linhas que atendem a regras como `faturamento maior que 80 mil`. Valores como `R$ 80.000,00`, `80000`, `80 mil`, `80k` e `1,5 mi` são reconhecidos como números. Combine várias regras com “todos” (E) ou “qualquer um” (OU).

## Template

| Sintaxe | Resultado |
|---|---|
| `{{nome}}` | valor da coluna `nome` (sem diferenciar maiúsculas/minúsculas) |
| `{{cupom\|BEMVINDO}}` | usa `BEMVINDO` quando a célula estiver vazia |
| `{Olá\|Oi\|E aí}` | sorteia uma opção por contato (spintax) |
| `*negrito*` `_itálico_` `~riscado~` | formatação do WhatsApp |

Também é possível anexar imagem, vídeo, documento ou áudio, por upload ou por URL pública. Nesse caso, o texto vai como legenda.

### Anexos e limites

| Tipo | Limite |
|---|---|
| Vídeo, documento | 512 MB |
| Imagem, áudio | 32 MB |

- O arquivo é enviado ao painel **em partes de 8 MB, assim que é escolhido**, com barra de progresso e novas tentativas automáticas. O disparo só libera quando o envio termina.
- **Com endereço público** (Railway ou `PUBLIC_URL`), a uazapi **baixa o arquivo por um link** do painel (`/media/<id>/<nome>`). Isso é obrigatório acima de 45 MB. **Sem endereço público** (rodando local), o arquivo vai em base64 e o limite é 45 MB.
- ⚠ **Tráfego:** a uazapi baixa o arquivo **a cada contato**. Um vídeo de 500 MB para 1.000 contatos gera ~500 GB de saída no servidor do painel, e o Railway cobra por tráfego. Para campanhas grandes, comprima o vídeo (poucos MB costumam bastar no WhatsApp) ou hospede o arquivo num CDN e use **Link (URL)**. O WhatsApp também pode demorar ou recusar vídeos muito grandes, então faça um **Enviar teste** antes.
- Arquivos que nenhuma campanha usa são apagados depois de 24 h. Excluir campanhas antigas libera o espaço dos vídeos.

### Mídia com botões e versão da uazapi

A versão da uazapi é lida no `/status` público dela e aparece na tela de configurações.

- **Imagem:** vai no topo da mensagem com botões em qualquer versão. O app envia nos campos `imageButton` (versões < 2.6) e `file` (2.6+).
- **Vídeo e documento:** só aparecem no topo dos botões a partir da **uazapi 2.6.0**. Em versões anteriores, o app envia o arquivo numa mensagem própria **logo antes** da mensagem com botões. A tela avisa e a prévia mostra assim.

## Botões de interesse e qualificação

Em **Mensagem → Com botões de interesse**, a campanha envia imagem (ou vídeo/documento) + texto + dois botões (`/send/menu`):

1. **“Tenho interesse”** → o contato recebe a pergunta de faturamento com as faixas configuradas (até 3 faixas viram botões; acima disso, uma lista).
2. Ao escolher a faixa, o contato é marcado como **qualificado** se a faixa estiver marcada como tal (padrão: só **acima de R$ 80 mil**). Qualificados recebem a mensagem de próximo contato. Os demais recebem uma recusa educada (“infelizmente não seguiremos com uma proposta neste momento…”), editável na tela. Vale a primeira faixa informada: trocar de resposta depois não muda a classificação.
3. **Confirmação de dados (qualificados):** o lead recebe um resumo como *Nome / E-mail / Telefone* com os botões **Confirmar dados** e **Alterar dados**. Os valores vêm das colunas do CSV (ou do número de WhatsApp). Campos vazios são perguntados antes do resumo. Em **Alterar dados**, cada campo é perguntado de novo, com validação de e-mail e telefone, e o resumo volta a aparecer. A **mensagem final** só é enviada depois da confirmação e pode usar os dados confirmados (`{{Nome}}`, `{{E-mail}}`…). A etapa pode ser desligada e os campos são configuráveis (até 8).
4. **“Não tenho interesse”** → recebe a resposta de agradecimento (opcional).

### Webhook de leads qualificados (ex.: Clint)

Em **Botões e qualificação → Enviar leads qualificados para um webhook**, informe a URL (por exemplo, o webhook de entrada do Clint) e monte os **dados enviados** como uma tabela *chave → valor*. O valor pode ser texto fixo ou variáveis:

| Variável | Conteúdo |
|---|---|
| `{{Nome}}`, `{{E-mail}}`, `{{Telefone}}`… | dados confirmados pelo lead (telefones só com dígitos e DDI) |
| `{{empresa}}`, `{{cidade}}`… | qualquer coluna do CSV |
| `{{whatsapp}}`, `{{faixa_faturamento}}`, `{{campanha}}`, `{{data_confirmacao}}`, `{{dados_alterados}}` | dados do fluxo |

Também vale o valor reserva `{{cidade|não informado}}`, e há a opção de mandar todas as colunas do CSV (`planilha_*`).

- O POST (JSON) sai quando o lead **confirma os dados**. Se a etapa de confirmação estiver desligada, sai quando ele escolhe uma faixa qualificada.
- **Enviar lead de teste** manda um exemplo com `"teste": true`, para mapear os campos no CRM antes do disparo.
- Erros temporários (sem conexão, 408, 429, 5xx) são tentados de novo após 15 s, 1 min e 5 min. Erros 4xx não são repetidos automaticamente. A aba **Respostas** mostra enviados e falhas e tem o botão **Reenviar falhas**. O export inclui `webhook_status` e `webhook_erro`.
- Envios pendentes são retomados se o servidor reiniciar.

O contato também pode responder digitando: `sim`/`1` ou `não`/`2` na primeira pergunta, o número da faixa na segunda e `confirmar`/`1` ou `alterar`/`2` no resumo dos dados.

O export dos qualificados inclui `dados_confirmados`, `dados_alterados` e uma coluna `confirmado_<campo>` para cada dado.

A aba **Respostas** da campanha mostra o funil (enviadas → interessados → informaram faturamento → qualificados), a distribuição por faixa e exporta **só os qualificados** ou **só os interessados** em CSV. Use **Enviar teste** antes: com botões, o teste roda o fluxo completo no seu número.

### Como as respostas chegam

- **SSE (padrão):** o servidor mantém uma conexão com `GET /sse` da uazapi. Funciona sem URL pública, inclusive rodando local. O status aparece como “Recebendo respostas em tempo real”.
- **Webhook (opcional, para produção com URL pública):** cadastre `https://SEU-DOMINIO/api/webhook/uazapi` no webhook da instância com o evento `messages`. O payload é validado pelo token da instância. Configure manualmente para não sobrescrever um webhook que você já usa, como Chatwoot ou n8n.

As respostas só são processadas com o servidor ligado. Cliques feitos com ele desligado não são recuperados.

> Botões e listas não são um recurso oficial do WhatsApp para APIs não oficiais: a própria uazapi avisa que podem deixar de funcionar sem aviso, e em alguns aparelhos ou no WhatsApp Web podem não aparecer. Por isso o fluxo também aceita respostas digitadas.

## Agendamento

- **Agendar:** no card de lançamento, escolha **Agendar** e informe data e hora. A campanha fica como **Agendada** e começa sozinha no horário marcado. O servidor precisa estar ligado nesse momento. Se estiver desligado, ela começa assim que ele voltar.
- **Janela de envio:** em “Ritmo de envio”, marque **Enviar apenas dentro de um horário** e escolha dias e horário (ex.: seg–sex, 09:00–18:00). Fora da janela o disparo para e retoma sozinho na próxima abertura. A tela mostra o **término previsto** já considerando a janela.
- Na campanha agendada: **Iniciar agora**, **Reagendar**, **Pausar** e **Cancelar**. Uma campanha pausada também pode ser reagendada.
- Os horários usam o fuso do navegador de quem criou a campanha (ex.: `America/Sao_Paulo`), mesmo que o servidor rode em UTC.
- As respostas automáticas do fluxo de botões saem na hora, mesmo fora da janela, porque respondem a um clique do contato.

## Como o envio funciona

- Uma campanha por vez, com **intervalo aleatório** entre mensagens, **pausa a cada lote** e “digitando…” opcional.
- Antes de enviar, os números podem ser verificados em `/chat/check`. Os que não têm WhatsApp são ignorados.
- O disparo **pausa sozinho** se o token for inválido, se a instância desconectar, se o WhatsApp restringir a conta (erro 463) ou após 5 falhas seguidas. Corrija o problema e clique em **Retomar**.
- Envios com erro não são repetidos automaticamente, porque a mensagem pode ter saído mesmo assim. Use **Reenviar falhas** se quiser tentar de novo.
- As campanhas ficam em `data/campaigns/` (ou no volume do Railway). Num desligamento normal (novo deploy, Ctrl+C), o envio em andamento termina e a campanha **retoma sozinha** quando o servidor volta. Numa queda inesperada, ela volta **pausada** para você conferir.
- O botão **Exportar CSV** gera a planilha original com status, erro, mensagem enviada e horário de cada contato.

## Boas práticas para evitar bloqueio

Envie apenas para contatos que autorizaram receber mensagens. Comece com volumes baixos em números novos, mantenha intervalos de pelo menos 8 a 20 segundos, use variações (spintax) e acompanhe a taxa de falhas. Mesmo assim, disparos em massa por API não oficial podem levar o WhatsApp a restringir ou banir o número.

## Endpoints da API local

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | healthcheck (sem login) |
| GET | `/api/auth/me` | sessão atual |
| POST | `/api/auth/login` · `/api/auth/logout` | entrar (`{ username, password, remember }`) / sair |
| GET/PUT | `/api/config` | URL/token da uazapi (o token nunca é devolvido inteiro) |
| GET | `/api/instance` | status da instância (`/instance/status`) |
| POST | `/api/uploads` | envia mídia (base64) e retorna `id` |
| POST | `/api/test-send` | envia uma mensagem de teste |
| GET/POST | `/api/campaigns` | lista / cria campanha |
| GET | `/api/campaigns/:id` | resumo + log de atividade |
| GET | `/api/campaigns/:id/contacts` | contatos paginados (`status`, `flow`, `q`, `page`) |
| GET | `/api/campaigns/:id/export` | relatório CSV (`?only=qualified` ou `?only=interested`) |
| GET | `/api/responses` | status do recebimento de respostas + últimas respostas |
| POST | `/api/webhook/uazapi` | webhook opcional da uazapi |
| POST | `/api/campaigns/:id/{pause,resume,cancel,retry-failed,start-now}` | controle |
| POST | `/api/campaigns/:id/reschedule` | reagenda (`{ "startAt": <timestamp ms> }`) |
| DELETE | `/api/campaigns/:id` | exclui campanha |





{ "name": "Maria Silva", "email": "maria@padariasol.com", "phone": "5511987654321",
  "faturamento": "Acima de R$ 80 mil", "whatsapp": "5511987654321",
  "campanha": "Outubro", "origem": "Disparos WhatsApp", "empresa": "Padaria Sol" }

,
Pronto: em Botões e qualificação há um campo para a URL do webhook (o do Clint, por exemplo) e uma tabela com os dados enviados. Quando um lead qualificado confirma os dados, o painel envia esses dados para a URL. Testei com um receptor de webhook simulado, não com o Clint de verdade.

Como configurar

URL do webhook: cole o link do webhook de entrada do Clint.
Dados enviados: cada linha é uma chave e um valor. O valor pode ser texto fixo ou variáveis, que você insere clicando nos botões abaixo da tabela:
dados confirmados pelo lead: {{Nome}}, {{E-mail}}, {{Telefone}};
colunas do CSV: {{empresa}}, {{cidade}}…;
dados do fluxo: {{faixa_faturamento}}, {{whatsapp}}, {{campanha}}, {{data_confirmacao}}, {{dados_alterados}}.
Padrão: name, email, phone, faturamento, whatsapp, campanha e origem. Você pode mudar as chaves, adicionar ou remover linhas.
Opcional: enviar também todas as colunas do CSV, cada uma com o prefixo planilha_.
Exemplo do JSON: a tela mostra o JSON montado com os dados do contato da prévia.
Antes do disparo, use "Enviar lead de teste". Ele manda um lead de exemplo marcado com "teste": true, para você mapear os campos no Clint. A tela mostra a resposta do Clint. Não achei documentação pública do formato do webhook do Clint, por isso as chaves são editáveis. Se ele exigir nomes específicos, é só trocar na tabela.

Exemplo do que é enviado:


{ "name": "Maria Silva", "email": "maria@padariasol.com", "phone": "5511987654321",
  "faturamento": "Acima de R$ 80 mil", "whatsapp": "5511987654321",
  "campanha": "Outubro", "origem": "Disparos WhatsApp", "empresa": "Padaria Sol" }
Telefones vão só com dígitos e DDI, que é o formato que os CRMs costumam esperar.

Quando dá erro

Erro temporário (sem conexão, ou o Clint fora do ar): o envio é tentado de novo depois de 15 s, 1 min e 5 min. No teste, uma falha 503 entrou na segunda tentativa.
Erro de dados (por exemplo, "campo obrigatório ausente"): não adianta repetir, então o envio para. A aba Respostas mostra "1 com falha" com a resposta do Clint e tem o botão Reenviar falhas para usar depois de corrigir.
Acompanhamento: cada lead aparece como "Webhook ✓" ou "Webhook falhou" na tabela de contatos, e o export ganhou as colunas webhook_status e webhook_erro.
Servidor reiniciado: envios que estavam pendentes são retomados.
Atenção: o envio de teste pelo WhatsApp (o do card "Enviar teste") também aciona o webhook quando você confirma os dados. Esse lead chega com "teste": true, e você pode apagá-lo no Clint.

O código principal está em WebhookEditor.jsx (a tela), shared/datafields.js (montagem do JSON) e server/flow.js (envio e novas tentativas).