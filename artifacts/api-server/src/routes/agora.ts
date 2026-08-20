/**
 * Agora calling routes:
 *  - GET  /agora/token   → RTC token for joining a call channel
 *  - POST /agora/signal  → relay call signaling (invite/accept/reject/end/video upgrade)
 *    to the other user's devices via Stream Chat custom user events.
 *
 * Authorization model: every call is bound to a Stream chat channel
 * (`chatId`). Both the token and every signal require the requester to be a
 * member of that chat channel, and the Agora channel name must be derived
 * from it (`nanivio-<chatId>-<random>`), so a user can never mint a token
 * for (or signal into) someone else's call.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { StreamChat } from "stream-chat";
import { db, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();

const SIGNAL_TYPES = new Set([
  "call_invite",
  "call_accept",
  "call_reject",
  "call_end",
  "call_cancel",
  "video_upgrade_request",
  "video_upgrade_accept",
  "video_upgrade_decline",
]);
const CHAT_ID_RE = /^[a-zA-Z0-9!_-]{1,60}$/;
const CHANNEL_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** In-memory caller→target invite throttle (invite only). */
const inviteRateLimit = new Map<string, number>();

function getAgoraCreds() {
  // trim() guards against stray whitespace/newlines pasted into the secrets
  const appId = process.env.AGORA_APP_ID?.trim();
  const cert = process.env.AGORA_APP_CERTIFICATE?.trim();
  if (!appId || !cert) throw new Error("Agora is not configured yet (missing AGORA_APP_ID / AGORA_APP_CERTIFICATE)");
  return { appId, cert };
}

function getStreamClient() {
  const key = process.env.STREAM_API_KEY;
  const secret = process.env.STREAM_API_SECRET;
  if (!key || !secret) throw new Error("Stream credentials not configured");
  return StreamChat.getInstance(key, secret);
}

/** The Agora channel for a call must be derived from the chat channel id. */
function channelMatchesChat(channel: string, chatId: string): boolean {
  return channel === `nanivio-${chatId}` || channel.startsWith(`nanivio-${chatId}-`);
}

/**
 * Returns the member user-ids of the chat channel IF `userId` is a member,
 * otherwise null. This is the authorization gate for tokens and signals.
 */
async function chatMembersIfMember(userId: number, chatId: string): Promise<string[] | null> {
  try {
    const client = getStreamClient();
    const channels = await client.queryChannels(
      { type: "messaging", id: { $eq: chatId }, members: { $in: [String(userId)] } } as any,
      {},
      { limit: 1 },
    );
    if (!channels.length) return null;
    return Object.keys((channels[0] as any).state?.members ?? {});
  } catch {
    return null;
  }
}

/* ── RTC token for a call channel ── */
router.get("/agora/token", requireAuth, async (req: any, res): Promise<void> => {
  try {
    const { appId, cert } = getAgoraCreds();
    const channel = String(req.query.channel ?? "");
    const chatId = String(req.query.chatId ?? "");
    if (!CHAT_ID_RE.test(chatId) || !CHANNEL_RE.test(channel) || !channelMatchesChat(channel, chatId)) {
      res.status(400).json({ error: "Invalid channel" });
      return;
    }
    // Only members of the underlying chat may join its call channel
    if (!(await chatMembersIfMember(req.userId, chatId))) {
      res.status(403).json({ error: "You are not part of this conversation" });
      return;
    }
    const uid = req.userId as number;
    const expireSecs = 3600;
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId, cert, channel, uid, RtcRole.PUBLISHER, expireSecs, expireSecs,
    );
    res.json({ appId, token, uid, channel, expiresIn: expireSecs });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Token generation failed" });
  }
});

/* ── relay call signaling to the other user ── */
router.post("/agora/signal", requireAuth, async (req: any, res): Promise<void> => {
  try {
    const toUserId = Number(req.body?.toUserId);
    const event = req.body?.event ?? {};
    if (!Number.isInteger(toUserId) || toUserId <= 0 || toUserId === req.userId) {
      res.status(400).json({ error: "Invalid toUserId" });
      return;
    }
    if (typeof event.type !== "string" || !SIGNAL_TYPES.has(event.type)) {
      res.status(400).json({ error: "Invalid signal type" });
      return;
    }
    const chatId = String(event.chatId ?? "");
    const channel = String(event.channel ?? "");
    if (!CHAT_ID_RE.test(chatId) || !CHANNEL_RE.test(channel) || !channelMatchesChat(channel, chatId)) {
      res.status(400).json({ error: "Invalid channel" });
      return;
    }
    // Sender must be a member of the chat, and the target must be too —
    // signals are confined to the conversation the call belongs to.
    const members = await chatMembersIfMember(req.userId, chatId);
    if (!members || !members.includes(String(toUserId))) {
      res.status(403).json({ error: "You can only call people you chat with" });
      return;
    }
    if (event.type === "call_invite") {
      const rlKey = `${req.userId}->${toUserId}`;
      const now = Date.now();
      if (now - (inviteRateLimit.get(rlKey) ?? 0) < 5_000) {
        res.status(429).json({ error: "Please wait before calling again" });
        return;
      }
      inviteRateLimit.set(rlKey, now);
      if (inviteRateLimit.size > 5000) {
        for (const [k, t] of inviteRateLimit) if (now - t > 60_000) inviteRateLimit.delete(k);
      }
    }
    const [caller] = await db.select({ name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, req.userId));
    const client = getStreamClient();
    await client.sendUserCustomEvent(String(toUserId), {
      type: event.type,
      // "channel" is a reserved key in Stream events and gets stripped — use callChannel
      callChannel: channel,
      callChatId: chatId,
      kind: event.kind === "audio" ? "audio" : "video",
      fromUserId: String(req.userId),
      fromName: caller?.name ?? "Someone",
    } as any);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Signal failed" });
  }
});

export default router;
