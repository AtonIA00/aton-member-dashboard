# Aton Member Dashboard

BI self-service do assinante Aton — leads, campanhas, anúncios e qualificação em tempo real, embedado como iframe (HMAC-SHA256) dentro do painel atonbot.cc.

- **Produção:** https://member-dashboard.aton-ia.com.br
- **Stack:** Next.js 16 (App Router, standalone) · TypeScript · Tailwind v4 · Supabase · Recharts · Docker Swarm + Traefik (VPS Hostinger)
- **Banco:** projeto Supabase compartilhado `ydkzszcvktytbyfbaefp` (read-only em `terrace360_leads_atonhub`; tabela própria `wa_member_dashboard_access`)

## Arquitetura

Mesmo padrão iframe + HMAC do **Aton WA**. A Uchat embeda:

```
https://member-dashboard.aton-ia.com.br/?workspace_id=...&user_id=...&timestamp=...&signature=...
```

A `signature` é HMAC-SHA256 com `UCHAT_PRIVATE_KEY` — mesma chave do Aton WA (já em produção no Whitelabel Uchat).

## Marcos

- **M1** Fundação — deploy automático, placeholder com identidade Aton, healthcheck ✓ (atual)
- **M2** HMAC gate + tabela `wa_member_dashboard_access`
- **M3** Dashboard read-only base (KPIs + funil + tabelas)
- **M4** Filtros avançados (campanha, anúncio, canal, mql, etapa)
- **M5** Charts Recharts (volume diário, donut MQL, distribuição por etapa)
- **M6** Polimento mobile + microcopy

Detalhes em `Aton IA/departamentos Aton/Tecnologia/Member Dashboard/ROADMAP_MEMBER_DASHBOARD.md` (mantido pelo Cowork).

## Dev local

```bash
npm install
npm run dev
# http://localhost:3000
```

## Deploy

`git push origin main` dispara o workflow `.github/workflows/deploy.yml` no self-hosted runner do servidor. Ver `FRAMEWORK.md` §3 e §4 pra padrões Aton (Traefik, overlay AtonbotNet, `NEXT_PUBLIC_*` como ARG).

### Env vars e feature flags em produção

As env vars (secrets + flags) vivem em `/root/aton-member-dashboard/.env.local` **no servidor** (não no repo). O passo "Update Swarm service" do workflow reaplica todas via `docker service update --env-add` a cada deploy — o `--env-file` só vale na criação do service, então mudar o arquivo depois **não** reflete sozinho.

Variáveis documentadas em [`.env.example`](.env.example). Convenção de flag: `MEMBER_DASHBOARD_<FEATURE>_ENABLED=true`. Isso permite mergear código **dark** (invisível em prod) e acender depois sem rebuild.

Pra ligar/desligar uma flag em prod (ex.: `MEMBER_DASHBOARD_RETORNO_COMERCIAL_ENABLED`):

```bash
# no servidor 72.61.217.72
echo 'MEMBER_DASHBOARD_RETORNO_COMERCIAL_ENABLED=true' >> /root/aton-member-dashboard/.env.local
docker service update --env-add MEMBER_DASHBOARD_RETORNO_COMERCIAL_ENABLED=true member-dashboard_app
# (ou re-rode o workflow via GitHub Actions → Run workflow, que reaplica o .env.local inteiro)
```

Persistir no arquivo **e** aplicar no service: o `--env-add` acende agora; a linha no `.env.local` garante que o próximo deploy não reverta.
