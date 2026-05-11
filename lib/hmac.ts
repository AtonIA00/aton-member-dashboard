import { createHmac, timingSafeEqual } from "node:crypto";

// Validação da assinatura HMAC-SHA256 do iframe Uchat.
//
// A doc da Uchat (PHP):
//   $data = json_encode([
//     'workspace_id' => getParam('workspace_id'),
//     'user_id'      => getParam('user_id'),
//     'timestamp'    => getParam('timestamp'),
//   ]);
//   $sig = hash_hmac('sha256', $data, PRIVATE_KEY);
//
// CAVEAT — divergência observada entre fontes:
// - Doc oficial Uchat (PHP): strings (`getParam` retorna string)
// - Aton WA observou em produção: a Uchat embeda valores como NÚMEROS
//   no JSON ({"workspace_id":258051,...}) — int, sem aspas
// - Script de teste interno (gerar_url_hmac.js): strings
//
// Pra tolerar AMBAS as codificações sem quebrar nenhuma fonte legítima,
// tentamos primeiro como string (alinhado com doc e script) e, se falhar,
// como número (alinhado com produção real do Aton WA). Qualquer das duas
// passando autoriza. Ambas falhando → bad_signature.
//
// Premissas:
// 1. Ordem das chaves: workspace_id → user_id → timestamp (PHP preserva ordem
//    do array associativo; JS preserva ordem de inserção do objeto literal).
// 2. Timestamp em epoch segundos. Se vier em ms, normaliza.
// 3. workspace_id/user_id são inteiros (validados via Number.isFinite).

export type UchatAuthParams = {
  workspace_id: string;
  user_id: string;
  timestamp: string;
  signature: string;
};

export type HmacOk = {
  ok: true;
  workspaceId: string;
  userId: string;
  timestamp: number;
};
export type HmacFail = {
  ok: false;
  reason: "missing_params" | "bad_timestamp" | "stale" | "bad_signature";
};
export type HmacValidationResult = HmacOk | HmacFail;

export function validateUchatSignature(
  params: Partial<UchatAuthParams>,
  opts: { maxAgeSeconds: number } = { maxAgeSeconds: 300 },
): HmacValidationResult {
  const privateKey = process.env.UCHAT_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("UCHAT_PRIVATE_KEY ausente no environment");
  }

  const { workspace_id, user_id, timestamp, signature } = params;
  if (!workspace_id || !user_id || !timestamp || !signature) {
    return { ok: false, reason: "missing_params" };
  }

  const wsNum = Number(workspace_id);
  const userNum = Number(user_id);
  const tsNum = Number(timestamp);
  if (
    !Number.isFinite(wsNum) ||
    !Number.isFinite(userNum) ||
    !Number.isFinite(tsNum) ||
    tsNum <= 0
  ) {
    return { ok: false, reason: "bad_timestamp" };
  }

  // Normaliza timestamp para epoch em segundos.
  const tsSec = tsNum > 1e12 ? Math.floor(tsNum / 1000) : tsNum;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > opts.maxAgeSeconds) {
    return { ok: false, reason: "stale" };
  }

  // Tenta codificação como STRING (doc oficial + script de teste interno).
  const dataAsStrings = JSON.stringify({
    workspace_id: String(workspace_id),
    user_id: String(user_id),
    timestamp: String(timestamp),
  });
  // Tenta codificação como NÚMERO (observado em prod no Aton WA).
  const dataAsNumbers = JSON.stringify({
    workspace_id: wsNum,
    user_id: userNum,
    timestamp: tsNum,
  });

  const expectedStr = createHmac("sha256", privateKey).update(dataAsStrings).digest("hex");
  const expectedNum = createHmac("sha256", privateKey).update(dataAsNumbers).digest("hex");

  const sigBuf = Buffer.from(signature, "utf8");
  const matches = (cand: string) => {
    const candBuf = Buffer.from(cand, "utf8");
    return sigBuf.length === candBuf.length && timingSafeEqual(sigBuf, candBuf);
  };

  if (!matches(expectedStr) && !matches(expectedNum)) {
    return { ok: false, reason: "bad_signature" };
  }

  return {
    ok: true,
    workspaceId: String(wsNum),
    userId: String(userNum),
    timestamp: tsSec,
  };
}
