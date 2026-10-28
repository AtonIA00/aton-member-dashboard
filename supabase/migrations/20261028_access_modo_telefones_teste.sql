-- 28/10/2026 (WDS 338565): flags por assinante em wa_member_dashboard_access,
-- padrão desligado (os demais assinantes não mudam).
--   separar_atendimento_modo: KPIs e funil separados por
--     terrace360_leads_atonhub.atendimento_modo ('flavia' | 'direto').
--   telefones_teste: telefones (só dígitos, com DDI) cujos leads somem do
--     dash como se estivessem em wa_lead_exclusions.
alter table public.wa_member_dashboard_access
  add column if not exists separar_atendimento_modo boolean not null default false,
  add column if not exists telefones_teste text[];
