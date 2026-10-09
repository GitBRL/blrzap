# Deploy no Railway

Este guia coloca o painel de disparos no ar no [Railway](https://railway.com). O projeto funciona com as configurações padrão do Railway: não há `Dockerfile` nem arquivo de configuração. Basta conectar o repositório, anexar um volume e definir a senha.

## Resumo do que o app precisa

| Item | Valor | Por quê |
|---|---|---|
| Serviço | 1 serviço Node.js (detectado automaticamente) | build `npm ci` → `npm run build`, início `npm start` |
| Node | 24 (definido em `package.json` → `engines`) | versão testada |
| **Volume** | montado em `/data` | campanhas, mídias e configuração da uazapi ficam salvas entre deploys |
| **`APP_PASSWORD`** | senha forte | sem ela, qualquer pessoa com o link envia mensagens pelo seu número |
| Healthcheck | `/api/health` | o Railway só libera o tráfego quando o app responde |
| Réplicas | **1** | o envio e o recebimento de respostas rodam em memória; 2 réplicas enviariam em dobro |
| Serverless | **desligado** | dormindo, o app não dispara agendamentos nem recebe cliques nos botões |

---

## 1. Subir o código

**Opção A: GitHub (recomendado, com deploy automático a cada push)**

```bash
cd /sistemas/disparos
git init
git add .
git commit -m "Painel de disparos"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/disparos.git
git push -u origin main
```

O `.gitignore` já deixa de fora `node_modules/`, `dist/`, `data/` e `.env`. Confira com `git status` que nenhum desses foi incluído: `data/config.json` e `.env` guardam o token da uazapi.

No Railway: **New Project → Deploy from GitHub repo** e escolha o repositório.

**Opção B: Railway CLI (sem GitHub)**

```bash
npm install -g @railway/cli
railway login
cd /sistemas/disparos
railway init        # cria o projeto
railway up          # envia o código e faz o deploy (respeita o .gitignore)
```

Para atualizar depois, rode `railway up` de novo.

## 2. Anexar o volume (obrigatório)

No canvas do projeto, clique com o botão direito no serviço (ou use **Ctrl/⌘ + K** e procure por "Volume") e crie um volume com **mount path `/data`**.

O app detecta o volume sozinho pela variável `RAILWAY_VOLUME_MOUNT_PATH`, que o Railway define. Não é preciso configurar `DATA_DIR`.

> Sem volume, tudo é apagado a cada deploy, e o log mostra: `⚠ Nenhum volume anexado…`.
>
> Com volume, o Railway não deixa duas versões do app rodando ao mesmo tempo. Cada deploy tem alguns segundos de indisponibilidade, mas isso evita que duas instâncias enviem a mesma campanha.

## 3. Variáveis de ambiente

Na aba **Variables** do serviço:

| Variável | Obrigatória | Exemplo / observação |
|---|---|---|
| `APP_PASSWORD` | **sim** | senha longa e aleatória. O navegador pede usuário e senha: o usuário pode ser qualquer um. |
| `UAZAPI_URL` | não | `https://seusubdominio.uazapi.com`. Também pode ser configurada pela tela. |
| `UAZAPI_TOKEN` | não | token **da instância** (não o admintoken). Também pode ser configurado pela tela. |

Não defina `PORT`: o Railway define sozinho. O que for salvo pela tela de configurações fica no volume (`/data/config.json`) e tem prioridade sobre `UAZAPI_URL`/`UAZAPI_TOKEN`.

## 4. Ajustes do serviço (aba Settings)

1. **Networking → Generate Domain**: gera o endereço público `https://xxxx.up.railway.app`.
2. **Deploy → Healthcheck Path**: `/api/health`. Essa rota não pede senha.
3. **Deploy → Serverless**: **desligado**.
4. **Réplicas**: mantenha **1**.
5. *(Opcional)* **Deploy → Custom Start Command**: `node server/index.js`. Assim o sinal de desligamento chega direto ao Node, sem passar pelo `npm`. Funciona dos dois jeitos.

Depois de mudar configurações, faça um novo deploy (**Deploy → Redeploy**) se o Railway não fizer sozinho.

## 5. Primeiro acesso

1. Abra o domínio gerado e entre com qualquer usuário e a senha de `APP_PASSWORD`.
2. Clique no status no canto superior direito (ou no ⚙️) e informe a **Server URL** e o **token da instância** da uazapi → **Salvar e testar**. O status deve ficar "Conectado".
3. Em **Nova campanha**, importe um CSV pequeno e use **Enviar teste** para o seu número.
4. Se usar botões de interesse: toque nos botões no seu WhatsApp e confira a aba **Respostas** da campanha. Ela deve mostrar "Recebendo respostas em tempo real".
5. Se usar o webhook do Clint: clique em **Enviar lead de teste** e mapeie os campos no Clint.

## 6. Recebimento das respostas dos botões

- **Padrão (SSE):** nada a configurar. O servidor abre uma conexão com a uazapi e recebe os cliques em tempo real.
- **Webhook (opcional):** se preferir que a uazapi chame o painel, cadastre na instância o webhook `https://SEU-DOMINIO.up.railway.app/api/webhook/uazapi` com o evento `messages`. Essa rota não usa a senha do painel: ela valida o token da instância que vem no payload. Atenção: cadastrar esse webhook pode **substituir** um webhook que você já usa na uazapi (Chatwoot, n8n…). Por isso o SSE é o padrão.

## 7. Atualizações e reinícios

- **Novo deploy (push ou `railway up`):** o Railway envia o sinal de desligamento. O app termina o envio em andamento, salva tudo e, ao subir de novo, **retoma sozinho** as campanhas que estavam enviando (o histórico mostra "Servidor reiniciado. Retomando o disparo automaticamente."). Campanhas agendadas continuam agendadas. Envios ao webhook que estavam pendentes são retomados.
- **Queda inesperada (crash, falta de memória):** como o último envio pode não ter sido registrado, a campanha fica **pausada** com um aviso. Confira os contatos e clique em **Retomar**.
- **Durante os segundos de deploy**, cliques nos botões feitos pelos contatos não são recebidos. Prefira publicar atualizações fora do horário das campanhas. O contato também pode responder digitando (por exemplo, "1" ou "sim").

## 8. Fuso horário

O servidor do Railway roda em UTC, e não é preciso configurar nada. Agendamentos e janelas de envio usam o fuso do navegador de quem criou a campanha, e o export usa o fuso da campanha.

## 9. Backups

Os dados ficam no volume. Ative os **backups do volume** no Railway (aba *Backups* do volume) e, para registros importantes, baixe o **Exportar CSV** das campanhas.

## 10. Testar localmente como no Railway

```bash
npm ci
npm run build
PORT=3000 RAILWAY_VOLUME_MOUNT_PATH=./data-teste APP_PASSWORD=teste npm start
# http://localhost:3000  ·  healthcheck: curl localhost:3000/api/health
```

## Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Campanhas e configurações somem após o deploy | sem volume | anexe o volume em `/data` (passo 2) |
| Healthcheck falha e o deploy não termina | erro na inicialização | veja os **Deploy Logs**; a linha esperada é `API de disparos na porta …` |
| O navegador pede senha em tudo | `APP_PASSWORD` definida (esperado) | entre com qualquer usuário e a senha |
| Status "Erro de conexão" / `Invalid token` | token errado ou admintoken | use o token **da instância** e a Server URL do servidor dela |
| Botões não geram resposta | recebimento desligado ou serviço dormindo | aba **Respostas**: o status deve ser "Recebendo respostas em tempo real"; desligue o Serverless |
| Agendamento não disparou no horário | serviço dormindo ou parado | desligue o Serverless; ao voltar, o app dispara o que estiver atrasado |
| Lead não chegou ao Clint | erro no webhook | aba **Respostas** → "com falha" mostra a resposta do Clint; corrija e use **Reenviar falhas** |
| Upload de mídia falha | arquivo grande (limite ~45 MB) | use **Link (URL)** para arquivos grandes |
| Mensagens enviadas em dobro | mais de 1 réplica | volte para 1 réplica |
