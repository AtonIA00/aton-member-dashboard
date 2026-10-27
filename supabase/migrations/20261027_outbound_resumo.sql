-- Resumo do disparo ativo (public.disparos_outbound) para o Member Dashboard.
-- 27/10/2026: a Lavvi vai disparar ~500 mil contatos em remessas; o dash
-- lia linha a linha (teto de 20 mil) e somava tudo num número só. Aqui a
-- soma é feita no banco, em três recortes de uma vez (GROUPING SETS):
--   nivel = 'campanha' (uma linha por campanha / hipótese de template)
--   nivel = 'remessa'  (uma linha por dia do disparo, fuso de Brasília)
--   nivel = 'total'
--
-- Regras:
--   entregue  = status_envio <> 'falha', OU respondeu, OU converteu (houve
--               linha marcada como falha que respondeu: a mensagem chegou);
--   falha     = o resto;
--   optout    = status_envio = 'optout' (tocou "Parar"); conta como entregue;
--   sem_resposta = status_envio = 'sem_resposta' (5 toques sem resposta);
--   teste     = campanha que começa com "teste" (fora, salvo p_incluir_testes).
-- Datas p_de/p_ate são dias de Brasília, inclusivos; null = sem limite.
--
-- Só o servidor do dashboard (service_role) executa: a chave anon é pública.

create or replace function public.outbound_resumo(
  p_ws text,
  p_de date,
  p_ate date,
  p_incluir_testes boolean default false
)
returns table (
  nivel text,
  campanha text,
  dia date,
  base bigint,
  falha bigint,
  entregues bigint,
  optout bigint,
  sem_resposta bigint,
  responderam bigint,
  converteram bigint,
  conv_sem_resp bigint,
  em_voo bigint,
  mediana_h double precision,
  n_horas bigint,
  ate_1h bigint,
  t1 bigint, t2 bigint, t3 bigint, t4 bigint, t5 bigint,
  ret_env1 bigint, ret_env2 bigint, ret_env3 bigint, ret_env4 bigint, ret_env5 bigint,
  ret_resp1 bigint, ret_resp2 bigint, ret_resp3 bigint, ret_resp4 bigint, ret_resp5 bigint
)
language sql
stable
set search_path = public
as $$
  with b as (
    select
      d.campanha,
      (d.disparo_at at time zone 'America/Sao_Paulo')::date as dia,
      d.disparo_at,
      d.status_envio,
      d.respondeu,
      d.convertido,
      d.respondeu_na_tentativa,
      d.retomada_toque,
      d.retomada_respondeu_em,
      (coalesce(d.status_envio, '') <> 'falha' or d.respondeu is true or d.convertido is true) as entregue,
      case
        when d.primeira_resposta_at is not null and d.disparo_at is not null
             and d.primeira_resposta_at >= d.disparo_at
        then extract(epoch from d.primeira_resposta_at - d.disparo_at) / 3600.0
      end as horas
    from public.disparos_outbound d
    where d.workspace_id = p_ws
      and (p_de is null or (d.disparo_at at time zone 'America/Sao_Paulo')::date >= p_de)
      and (p_ate is null or (d.disparo_at at time zone 'America/Sao_Paulo')::date <= p_ate)
      and (p_incluir_testes or coalesce(d.campanha, '') not ilike 'teste%')
  )
  select
    case when grouping(b.campanha) = 0 then 'campanha'
         when grouping(b.dia) = 0 then 'remessa'
         else 'total' end,
    b.campanha,
    b.dia,
    count(*),
    count(*) filter (where not b.entregue),
    count(*) filter (where b.entregue),
    count(*) filter (where b.status_envio = 'optout'),
    count(*) filter (where b.status_envio = 'sem_resposta'),
    count(*) filter (where b.respondeu is true),
    count(*) filter (where b.convertido is true),
    count(*) filter (where b.convertido is true and b.respondeu is not true),
    count(*) filter (where b.entregue and b.disparo_at > now() - interval '24 hours'),
    percentile_cont(0.5) within group (order by b.horas),
    count(b.horas),
    count(*) filter (where b.horas < 1),
    count(*) filter (where b.respondeu_na_tentativa = 1),
    count(*) filter (where b.respondeu_na_tentativa = 2),
    count(*) filter (where b.respondeu_na_tentativa = 3),
    count(*) filter (where b.respondeu_na_tentativa = 4),
    count(*) filter (where b.respondeu_na_tentativa = 5),
    count(*) filter (where b.retomada_toque >= 1),
    count(*) filter (where b.retomada_toque >= 2),
    count(*) filter (where b.retomada_toque >= 3),
    count(*) filter (where b.retomada_toque >= 4),
    count(*) filter (where b.retomada_toque >= 5),
    count(*) filter (where b.retomada_respondeu_em = 1),
    count(*) filter (where b.retomada_respondeu_em = 2),
    count(*) filter (where b.retomada_respondeu_em = 3),
    count(*) filter (where b.retomada_respondeu_em = 4),
    count(*) filter (where b.retomada_respondeu_em = 5)
  from b
  group by grouping sets ((b.campanha), (b.dia), ())
$$;

revoke all on function public.outbound_resumo(text, date, date, boolean) from public, anon, authenticated;
grant execute on function public.outbound_resumo(text, date, date, boolean) to service_role;
