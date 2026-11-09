-- Disparo Ativo obedece ao filtro de campanha do dash (09/11/2026, Murillo).
--
-- O filtro do topo é o nome_campanha do lead ("Ativação base Well Perdizes D");
-- o disparo tem nome próprio ("ativacao-perdizes-out26-D"). A ligação sai dos
-- dados: cada campanha de disparo pertence ao nome_campanha que concentra a
-- maioria de quem respondeu a ela (telefone pelos 8 últimos dígitos). Empate
-- vai para o nome em ordem alfabética, só para ser estável.
--
-- outbound_resumo ganha p_campanhas (null = todas, como antes).

create or replace function public.outbound_campanha_do_lead(p_ws text)
returns table (campanha text, nome_campanha text)
language sql
stable
set search_path = public
as $$
  with resp as (
    select d.campanha, right(regexp_replace(d.telefone, '\D', '', 'g'), 8) as k
    from public.disparos_outbound d
    where d.workspace_id = p_ws and d.respondeu is true and d.campanha is not null
  ),
  leads as (
    select distinct l.nome_campanha, right(regexp_replace(l.telefone, '\D', '', 'g'), 8) as k
    from public.terrace360_leads_atonhub l
    where l.id_workspace_responsavel::text = p_ws and l.nome_campanha is not null and l.telefone is not null
  ),
  votos as (
    select r.campanha, le.nome_campanha, count(*) as n
    from resp r join leads le on le.k = r.k
    group by 1, 2
  )
  select distinct on (v.campanha) v.campanha, v.nome_campanha
  from votos v
  order by v.campanha, v.n desc, v.nome_campanha
$$;

revoke all on function public.outbound_campanha_do_lead(text) from public, anon, authenticated;
grant execute on function public.outbound_campanha_do_lead(text) to service_role;

drop function if exists public.outbound_resumo(text, date, date, boolean);

create or replace function public.outbound_resumo(
  p_ws text,
  p_de date,
  p_ate date,
  p_incluir_testes boolean default false,
  p_campanhas text[] default null
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
      and (p_campanhas is null or d.campanha = any(p_campanhas))
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

revoke all on function public.outbound_resumo(text, date, date, boolean, text[]) from public, anon, authenticated;
grant execute on function public.outbound_resumo(text, date, date, boolean, text[]) to service_role;
