# Disparos WhatsApp (uazapi)

Painel para disparo em massa no WhatsApp pela API da [uazapi](https://docs.uazapi.com): importe um CSV ou uma planilha do Excel, filtre os contatos, escreva um template personalizado com as colunas da planilha e acompanhe o envio em tempo real. Opcionalmente, ligue a campanha a um **workflow**: botões, perguntas, condições e webhooks que seguem conforme cada resposta do contato.

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

## Contatos: CSV, XLS ou XLSX

- Cabeçalho na primeira linha (na planilha, a primeira linha preenchida).
- **CSV:** separador `,` ou `;` (detectado automaticamente); UTF-8 ou o padrão do Excel (Windows-1252).
- **XLS / XLSX:** cada aba com dados vira uma opção, e a primeira vem selecionada. Telefones e documentos gravados como número saem inteiros (o Excel mostra `5,51E+12`), decimais saem com vírgula, porcentagens como `15%` e datas como `dd/mm/aaaa`. Colunas repetidas ganham sufixo (`nome (2)`); colunas sem título e sem dados são ignoradas. A leitura é feita no navegador, e a biblioteca só é baixada quando uma planilha é escolhida.
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

## Workflows

Na aba **Workflows** você monta, num canvas, o caminho das mensagens que seguem o disparo. Na campanha, escolha **Mensagem → Com workflow** e o template. A campanha guarda uma **cópia** do workflow: editar o template depois não muda campanhas já criadas.

Na primeira vez, o painel cria o template **Qualificação por faturamento**, que reproduz o antigo “Com botões de interesse” (botões → faixa de faturamento → confirmação de dados → mensagem final; recusa para não qualificados; agradecimento para sem interesse). Se o navegador tinha esse fluxo personalizado, a aba Workflows oferece importá-lo.

| Bloco | O que faz | Saídas |
|---|---|---|
| **Disparo** | A mensagem da campanha (texto e mídia vêm da campanha). Pode ter opções. | uma por opção, ou “Seguir” |
| **Mensagem** | Texto (e mídia por link público), com ou sem opções | uma por opção, ou “Seguir” |
| **Pergunta aberta** | Pergunta e guarda a resposta digitada numa variável. Valida texto, e-mail, telefone ou número. | “Respondeu” |
| **Confirmar dados** | Usa o que já existe (planilha, respostas, número), pergunta o que falta e mostra o resumo com Confirmar/Alterar | “Confirmou” |
| **Condição** | Regras sobre colunas da planilha e respostas (mesmos operadores dos filtros) | “Sim” / “Não” |
| **Webhook** | POST em JSON com uma tabela chave → valor (ex.: Clint), em qualquer ponto do caminho | “Seguir” |

- **Opções:** até 3 viram botões; de 4 a 10, lista. O contato também pode digitar o número ou o texto da opção (e “sim”/“não” quando dá para saber qual é). Cada opção pode ter uma **etiqueta** (ex.: “Qualificado”), que vira contagem, filtro e export nos resultados, e a escolha pode ser guardada numa variável.
- **Sem resposta:** blocos que esperam resposta podem ter um prazo (minutos, horas ou dias). Passado o prazo, o contato segue pela saída “Sem resposta”, por exemplo para um lembrete que volta à pergunta. Respeita a janela de envio da campanha, não sai de campanha pausada ou cancelada, e cada contato recebe no máximo 5.
- **Variáveis:** `{{coluna}}` da planilha, as respostas guardadas, os dados confirmados (`{{Nome}}`, `{{E-mail}}`…, mais `{{data_confirmacao}}` e `{{dados_alterados}}`) e `{{whatsapp}}`/`{{campanha}}`. No webhook, telefones vão só com dígitos e DDI.
- **Webhook:** erros temporários (sem conexão, 408, 429, 5xx) são tentados de novo após 15 s, 1 min e 5 min; envios pendentes são retomados se o servidor reiniciar; **Reenviar falhas** fica na aba Respostas. **Enviar teste** (no bloco) manda um exemplo com `"teste": true`.
- **Regras do editor:** uma saída leva a um bloco só; saída sem seta encerra o caminho; nenhuma seta volta ao disparo; laço sem nenhum bloco que espere resposta é recusado. Workflow com problemas pode ser salvo como rascunho, mas não pode ser usado em campanha.
- **Resultados:** a aba **Respostas** mostra quantos entraram, responderam, estão aguardando e chegaram ao fim; as etiquetas; e cada bloco na ordem do caminho, com quantos passaram, quantos estão parados nele, a escolha de cada opção e os “sem resposta”. O export inclui a etapa atual, as etiquetas, cada resposta guardada (`resposta_<variável>`) e o status de cada webhook.
- Use **Enviar teste** na campanha: com workflow, o teste percorre o caminho inteiro no seu número.

Campanhas criadas antes dos workflows (com “botões de interesse”) continuam funcionando e mostrando os resultados como antes.

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
| GET | `/api/campaigns/:id/export` | relatório CSV (`?only=` com um filtro: `tag:Qualificado`, `replied`, `done`…) |
| GET | `/api/responses` | status do recebimento de respostas + últimas respostas |
| POST | `/api/webhook/uazapi` | webhook opcional da uazapi |
| POST | `/api/campaigns/:id/{pause,resume,cancel,retry-failed,start-now}` | controle |
| POST | `/api/campaigns/:id/reschedule` | reagenda (`{ "startAt": <timestamp ms> }`) |
| DELETE | `/api/campaigns/:id` | exclui campanha |
| GET/POST | `/api/workflows` | lista / cria workflow |
| GET/PUT/DELETE | `/api/workflows/:id` | lê / salva / exclui workflow |
| POST | `/api/workflows/:id/duplicate` | duplica |
| POST | `/api/workflows/webhook-test` | envia um exemplo do bloco de webhook (`{ workflow, nodeId }`) |





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