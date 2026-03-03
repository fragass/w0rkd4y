// api/dm/create.js
export default async function handler(req, res) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ success: false, error: "Supabase not configured" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const body = req.body || {};

    // Compat com diferentes formatos
    const creator = body.creator || body.name || body.user1;
    const target = body.target || body.to || body.user2;
    const roomWanted = body.room;

    if (!creator || !target || !roomWanted) {
      return res.status(400).json({
        success: false,
        error: "Dados incompletos. Use: /c @usuario NOME_DA_SALA",
      });
    }

    // ✅ bloqueia /c @seu_proprio_nome ...
    if (creator === target) {
      return res.status(400).json({
        success: false,
        error: "Você precisa marcar OUTRO usuário para criar uma sala. Ex: /c @fulano sala123",
      });
    }

    // ✅ Agora aceita letras + números + _ + -
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(roomWanted)) {
      return res.status(400).json({
        success: false,
        error: 'Nome de sala inválido. Use 3 a 32 caracteres: letras, números, "_" ou "-".',
      });
    }

    const channelsEndpoint = `${SUPABASE_URL}/rest/v1/private_channels`;

    // Helper: buscar canal existente por dupla (qualquer ordem)
    async function findExistingChannel() {
      const url =
        `${channelsEndpoint}?select=id,room,user1,user2` +
        `&or=(and(user1.eq.${encodeURIComponent(creator)},user2.eq.${encodeURIComponent(target)}),and(user1.eq.${encodeURIComponent(target)},user2.eq.${encodeURIComponent(creator)}))` +
        `&limit=1`;

      const r = await fetch(url, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });

      const j = await r.json();
      return Array.isArray(j) && j.length ? j[0] : null;
    }

    // Tenta inserir (vai falhar se já existir a dupla por causa do unique_channel)
    const insertResp = await fetch(channelsEndpoint, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        room: roomWanted,
        user1: creator,
        user2: target,
        last_activity: new Date().toISOString(),
      }),
    });

    const insertText = await insertResp.text();

    if (!insertResp.ok) {
      let errObj = null;
      try { errObj = JSON.parse(insertText); } catch {}

      // ✅ Mensagem clara quando já existe DM entre a dupla
      if (errObj && errObj.code === "23505") {
        const existing = await findExistingChannel();
        if (existing) {
          return res.status(200).json({
            success: true,
            reused: true,
            room: existing.room,
            message: `Você já tem uma sala privada com @${target}. Vou abrir a existente: ${existing.room}`,
            channel: existing,
          });
        }

        return res.status(200).json({
          success: true,
          reused: true,
          room: null,
          message: `Você já tem uma sala privada com @${target}. Use /entrar <nome_da_sala>.`,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Falha ao criar a sala.",
        details: insertText,
      });
    }

    let created = null;
    try { created = JSON.parse(insertText); } catch {}
    const createdRow = Array.isArray(created) ? created[0] : created;

    // Notifica via "Sistema" (não quebra se falhar)
    try {
      const messagesEndpoint = `${SUPABASE_URL}/rest/v1/messages`;
      await fetch(messagesEndpoint, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          name: "Sistema",
          to: target,
          content: `@${creator} criou a sala "${roomWanted}". Use /entrar ${roomWanted}`,
        }),
      });
    } catch {}

    return res.status(200).json({
      success: true,
      reused: false,
      room: createdRow?.room || roomWanted,
      message: `Sala "${roomWanted}" criada com @${target}.`,
      channel: createdRow,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: "Erro interno no create.",
      details: String(e?.message || e),
    });
  }
}
