import { isTonEnabledForTier } from "@/lib/ton/auth";
import type { Tier } from "@/lib/access";
import { TonChat } from "./TonChat";
import { TonUpsell } from "./TonUpsell";

type Props = {
  tier: Tier;
  hmac: {
    workspace_id: string;
    user_id: string;
    timestamp: string;
    signature: string;
    user_name?: string;
    workspace_name?: string;
  };
};

/**
 * Orquestrador da aba TON. Gate por tier:
 * - enterprise: chat completo
 * - pro com MEMBER_DASHBOARD_TON_PRO_ENABLED=true: chat completo (upsell temp)
 * - resto: upsell pro Enterprise
 */
export function TonView({ tier, hmac }: Props) {
  if (!isTonEnabledForTier(tier)) {
    return <TonUpsell />;
  }
  return <TonChat hmac={hmac} />;
}
