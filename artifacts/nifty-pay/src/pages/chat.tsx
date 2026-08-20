import '@/styles/stream-theme.css';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';
import {
  Chat, Channel, ChannelList, MessageList, MessageComposer,
  TypingIndicator, useChatContext, WithComponents,
} from 'stream-chat-react';
import { useStreamChat } from '@/contexts/stream-chat';
import { useAgoraCall } from '@/contexts/agora-call';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { init, SearchIndex } from 'emoji-mart';

// Initialise the emoji data once at module load (powers the :emoji: autocomplete)
init({ data });
// StreamVideo components are no longer imported here — they live in call-overlay.tsx
// which renders inside AppLayout so the call UI persists across navigation.
import type { Channel as StreamChannel } from 'stream-chat';
import { useToast } from '@/hooks/use-toast';
import { playMessageNotification } from '@/lib/sounds';
import { ensurePushSubscription, notifyCallPush } from '@/lib/push';
import {
  MessageSquare, Phone, Video, ArrowLeft, Plus, Users,
  Search, X, Check, PhoneCall, Sparkles, Bell,
  UserCheck, UserX, Clock, UserPlus, ChevronDown, ChevronUp,
  ImageIcon, Upload, Paintbrush, BellRing,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { API_BASE as API } from '@/lib/api';
import {
  PaymentSheet, makePaymentAttachment, registerPayForRequestHandler,
  type PayRequestInfo,
} from '@/components/payment-chat';
import CommunicationHub from '@/components/communication/CommunicationHub';
import NewChatFlow from '@/components/communication/NewChatFlow';


// Module-level: survives React remounts so the active channel is restored
// when the user navigates away and back.
let _lastChannelId:   string | null = null;
let _lastChannelType: string        = 'messaging';

interface StreamData { token: string; userId: string; userName: string; apiKey: string; }
interface SUser { id: string; name?: string; nanivioNumber?: string; }

/* ─── avatars ───
 * Stream stores user.image as a relative path like "avatars/12?v=169..."
 * (set by the API when a profile photo is uploaded). Build the full URL here. */
function streamAvatarUrl(user: any): string | undefined {
  const img = user?.image;
  if (!img || typeof img !== 'string') return undefined;
  if (img.startsWith('http')) return img;
  return `${API}/${img}`;
}

/* ─── chat wallpaper presets ─── */
const CHAT_BG_PRESETS: { id: string; label: string; css: string; official?: boolean }[] = [
  /* ── Official Nanivio backgrounds ── */
  { id: 'royal-classic', label: 'Royal Classic', official: true, css: `#0b0d1a url(${import.meta.env.BASE_URL}wallpapers/royal-classic.jpg) center / cover no-repeat` },
  { id: 'nano-glow',    label: 'Nano Glow',    official: true, css: `#160b33 url(${import.meta.env.BASE_URL}wallpapers/nano-glow.png) center / cover no-repeat` },
  { id: 'wave-flow',    label: 'Wave Flow',    official: true, css: `#120a2e url(${import.meta.env.BASE_URL}wallpapers/wave-flow.png) center / cover no-repeat` },
  { id: 'hexa-tech',    label: 'Hexa Tech',    official: true, css: `#150d35 url(${import.meta.env.BASE_URL}wallpapers/hexa-tech.png) center / cover no-repeat` },
  { id: 'luxe-marble',  label: 'Luxe Marble',  official: true, css: `#1d1040 url(${import.meta.env.BASE_URL}wallpapers/luxe-marble.png) center / cover no-repeat` },
  { id: 'cosmic-orbit', label: 'Cosmic Orbit', official: true, css: `#0e0827 url(${import.meta.env.BASE_URL}wallpapers/cosmic-orbit.png) center / cover no-repeat` },
  { id: 'aurora-mesh',  label: 'Aurora Mesh',  official: true, css: `#140c31 url(${import.meta.env.BASE_URL}wallpapers/aurora-mesh.png) center / cover no-repeat` },
  { id: 'default',  label: 'Classic',  css: 'radial-gradient(1200px 500px at 80% -10%, hsl(217 60% 16% / 0.55), transparent 60%), radial-gradient(900px 420px at 0% 110%, hsl(262 55% 18% / 0.45), transparent 60%), linear-gradient(180deg, hsl(222 45% 7%), hsl(224 42% 9%))' },
  { id: 'aurora',   label: 'Aurora',   css: 'radial-gradient(800px 400px at 20% 0%, hsl(160 80% 30% / 0.35), transparent 60%), radial-gradient(700px 500px at 90% 30%, hsl(190 90% 35% / 0.3), transparent 55%), radial-gradient(900px 500px at 50% 110%, hsl(260 70% 30% / 0.4), transparent 60%), linear-gradient(180deg, hsl(222 50% 6%), hsl(230 45% 9%))' },
  { id: 'midnight', label: 'Midnight', css: 'radial-gradient(1000px 600px at 50% -20%, hsl(230 70% 20% / 0.6), transparent 65%), linear-gradient(180deg, hsl(232 55% 5%), hsl(240 45% 8%))' },
  { id: 'sunset',   label: 'Sunset',   css: 'radial-gradient(900px 500px at 80% -10%, hsl(15 85% 35% / 0.4), transparent 60%), radial-gradient(700px 400px at 10% 100%, hsl(320 65% 30% / 0.35), transparent 60%), linear-gradient(180deg, hsl(255 40% 8%), hsl(275 40% 9%))' },
  { id: 'ocean',    label: 'Ocean',    css: 'radial-gradient(1000px 500px at 70% -10%, hsl(200 90% 30% / 0.45), transparent 60%), radial-gradient(800px 500px at 10% 110%, hsl(220 80% 25% / 0.5), transparent 60%), linear-gradient(180deg, hsl(212 60% 6%), hsl(216 55% 9%))' },
  { id: 'forest',   label: 'Forest',   css: 'radial-gradient(900px 500px at 85% 0%, hsl(150 60% 22% / 0.45), transparent 60%), radial-gradient(700px 450px at 5% 100%, hsl(120 45% 18% / 0.4), transparent 60%), linear-gradient(180deg, hsl(160 40% 5%), hsl(170 35% 8%))' },
  { id: 'royal',    label: 'Royal',    css: 'radial-gradient(900px 500px at 75% -10%, hsl(268 75% 32% / 0.45), transparent 60%), radial-gradient(800px 500px at 10% 110%, hsl(290 60% 25% / 0.4), transparent 60%), linear-gradient(180deg, hsl(260 45% 7%), hsl(268 40% 9%))' },
  { id: 'blush',    label: 'Blush',    css: 'radial-gradient(900px 500px at 80% -10%, hsl(340 70% 35% / 0.35), transparent 60%), radial-gradient(700px 450px at 5% 110%, hsl(20 75% 32% / 0.3), transparent 60%), linear-gradient(180deg, hsl(335 35% 7%), hsl(350 30% 9%))' },
  { id: 'dots',     label: 'Dots',     css: 'radial-gradient(#1a1a1a 1px, transparent 1px) 0 0 / 20px 20px #0f0f0f' },
  { id: 'graphite', label: 'Graphite', css: `#16181c url(${import.meta.env.BASE_URL}wallpapers/graphite.png) center / cover no-repeat` },
  { id: 'slate',    label: 'Slate',    css: `#111 url(${import.meta.env.BASE_URL}wallpapers/slate.png) center / cover no-repeat` },
  { id: 'noir',     label: 'Noir',     css: `#0a0c12 url(${import.meta.env.BASE_URL}wallpapers/noir.png) center / cover no-repeat` },
];
type WallpaperPreset = { id: string; label: string; css: string; official?: boolean };
const presetCss = (id: string, list: WallpaperPreset[] = CHAT_BG_PRESETS) =>
  list.find(p => p.id === id)?.css
  ?? list.find(p => p.id === 'royal-classic')?.css
  ?? CHAT_BG_PRESETS[0].css; // Royal Classic is the app default fallback

/* Build CSS from a server catalog row (admin-managed wallpapers) */
function serverWallpaperCss(w: { id: string; css?: string | null; imageFile?: string | null; hasUpload?: boolean }): string {
  const img = w.imageFile
    ? `${import.meta.env.BASE_URL}wallpapers/${w.imageFile}`
    : w.hasUpload
      ? `${API}/wallpapers/${w.id}/image`
      : null;
  return img ? `${w.css ?? '#0b0d1a'} url(${img}) center / cover no-repeat` : (w.css ?? '#0b0d1a');
}

/* Subtle WhatsApp-style doodle pattern layered over preset wallpapers */
const DOODLE_PATTERN = `url("data:image/svg+xml,%3Csvg width='120' height='120' viewBox='0 0 120 120' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23ffffff' stroke-opacity='0.045' stroke-width='1.5'%3E%3Ccircle cx='20' cy='20' r='6'/%3E%3Cpath d='M70 15 l8 8 M78 15 l-8 8'/%3E%3Crect x='95' y='40' width='12' height='12' rx='3'/%3E%3Cpath d='M30 70 q6 -10 12 0'/%3E%3Ccircle cx='85' cy='90' r='5'/%3E%3Cpath d='M15 100 h14 M22 93 v14'/%3E%3Cpath d='M55 50 l5 9 h-10 z'/%3E%3Cpath d='M105 105 a5 5 0 1 0 0.1 0'/%3E%3C/g%3E%3C/svg%3E")`;

/* WhatsApp-style "last seen" formatting */
function lastSeenLabel(user: any): string {
  if (user?.online) return 'Online';
  const la = user?.last_active ? new Date(user.last_active) : null;
  if (!la || isNaN(la.getTime())) return 'Offline';
  const now = new Date();
  const time = la.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = la.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay) return `last seen today at ${time}`;
  if (la.toDateString() === yesterday.toDateString()) return `last seen yesterday at ${time}`;
  return `last seen ${la.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

/* ─── custom channel list item ─── */
function ChannelItem({
  channel,
  active,
  myUserId,
  onSelect,
  tick: _tick, // consumed only to force re-render when new messages arrive
}: {
  channel: StreamChannel;
  active: boolean;
  myUserId: string;
  onSelect: () => void;
  tick: number;
}) {
  const members = Object.values(channel.state.members ?? {});
  const other = members.find((m: any) => m.user_id !== myUserId);
  const title =
    (channel.data as any)?.name ??
    (other as any)?.user?.name ??
    'Chat';
  const avatarSrc = streamAvatarUrl((other as any)?.user);
  const online = !!(other as any)?.user?.online;
  const msgs = channel.state.messages;
  const last = msgs[msgs.length - 1];
  const lastText =
    last?.text ??
    (last?.attachments?.length ? '📎 Attachment' : null) ??
    'No messages yet';
  const unread = channel.countUnread();
  const initials = title.slice(0, 2).toUpperCase();
  const lastAt = channel.state.last_message_at
    ? new Date(channel.state.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <button
      className={cn(
        'w-[calc(100%-1rem)] mx-2 mb-1.5 flex items-center gap-3 px-3 py-3 text-left transition-all rounded-2xl border',
        active
          ? 'bg-primary/10 border-primary/40 shadow-lg shadow-primary/5'
          : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.05] hover:border-white/10 active:scale-[0.99]',
      )}
      onClick={onSelect}
    >
      <div className="relative shrink-0">
        <div className={cn('rounded-full p-[2px]', unread ? 'bg-gradient-to-tr from-primary via-sky-400 to-violet-500' : 'bg-white/10')}>
          <Avatar className="w-11 h-11 border-2 border-background">
            {avatarSrc && <AvatarImage src={avatarSrc} alt={title} className="object-cover" />}
            <AvatarFallback className="bg-gradient-to-br from-primary/30 to-violet-500/30 text-primary font-bold text-sm">{initials}</AvatarFallback>
          </Avatar>
        </div>
        {online && (
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-background" />
        )}
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#2b83ff] text-white shadow-[0_4px_15px_rgba(43,131,255,0.15)] font-medium rounded-2xl rounded-tr-none px-4 py-2.5 rounded-full text-[10px] font-bold flex items-center justify-center leading-none shadow-md shadow-primary/40">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <p className={cn('text-sm truncate', unread ? 'font-bold text-foreground' : 'font-medium text-foreground/90')}>
            {title}
          </p>
          {lastAt && <span className="text-[10px] text-[#64748b] shrink-0">{lastAt}</span>}
        </div>
        <p className={cn('text-xs truncate mt-0.5', unread ? 'text-foreground/70 font-medium' : 'text-[#64748b]')}>
          {lastText}
        </p>
      </div>
    </button>
  );
}

/* ─── emoji picker — standalone button that inserts into Stream's textarea via DOM ─── */
function StreamEmojiPicker() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const insertEmoji = (native: string) => {
    // Locate Stream's composer textarea and insert the emoji at the cursor position
    const textarea = document.querySelector('.str-chat__message-textarea') as HTMLTextAreaElement | null;
    if (textarea) {
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      const newVal = textarea.value.slice(0, start) + native + textarea.value.slice(end);
      // Trigger React's synthetic onChange via the native HTMLTextAreaElement setter
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, newVal);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      // Restore cursor right after the inserted emoji
      requestAnimationFrame(() => {
        textarea.setSelectionRange(start + native.length, start + native.length);
        textarea.focus();
      });
    }
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="Emoji"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-9 h-9 flex items-center justify-center rounded-full text-lg transition-colors',
          open ? 'bg-primary/15 text-primary' : 'text-[#64748b] hover:text-foreground hover:bg-muted/40',
        )}
      >
        😊
      </button>
      {open && (
        <div
          className="absolute z-[200] shadow-2xl rounded-2xl overflow-hidden"
          style={{ bottom: '48px', left: '-4px' }}
        >
          <Picker
            data={data}
            theme="dark"
            set="native"
            previewPosition="none"
            skinTonePosition="none"
            maxFrequentRows={2}
            onEmojiSelect={(emoji: any) => insertEmoji(emoji.native)}
          />
        </div>
      )}
    </div>
  );
}

/* ─── invite request banner — shown as a floating card when an invite arrives
       while the user is already viewing a conversation ─── */
/* ─── chat wallpaper hook + picker sheet ─── */
function useChatWallpaper() {
  const [background, setBackground] = useState<string>('royal-classic');
  const [presets, setPresets] = useState<WallpaperPreset[]>(CHAT_BG_PRESETS);

  // Load the admin-managed wallpaper catalog (falls back to built-ins)
  useEffect(() => {
    fetch(`${API}/wallpapers`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const rows = d?.wallpapers;
        if (Array.isArray(rows) && rows.length > 0) {
          setPresets(rows.map((w: any) => ({
            id: w.id, label: w.label, official: !!w.official, css: serverWallpaperCss(w),
          })));
        }
      })
      .catch(() => {});
  }, []);
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const customUrlRef = useRef<string | null>(null);
  useEffect(() => { customUrlRef.current = customUrl; }, [customUrl]);
  // Revoke the active blob URL on unmount to avoid leaking one per remount
  useEffect(() => () => { if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current); }, []);

  const loadCustomImage = useCallback(async () => {
    try {
      const token = localStorage.getItem('nanivio_token') ?? sessionStorage.getItem('nanivio_token');
      const r = await fetch(`${API}/profile/chat-background/image`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!r.ok) return null;
      const url = URL.createObjectURL(await r.blob());
      setCustomUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
      return url;
    } catch { return null; }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('nanivio_token') ?? sessionStorage.getItem('nanivio_token');
    fetch(`${API}/profile/chat-background`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        setBackground(d.background ?? 'royal-classic');
        if (d.background === 'custom' && d.hasCustomImage) loadCustomImage();
      })
      .catch(() => {});
  }, [loadCustomImage]);

  return { background, setBackground, customUrl, loadCustomImage, presets };
}

function WallpaperSheet({
  open, onClose, background, onPicked, onUploaded, presets = CHAT_BG_PRESETS,
}: {
  open: boolean;
  onClose: () => void;
  background: string;
  onPicked: (id: string) => void;
  onUploaded: () => void;
  presets?: WallpaperPreset[];
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const token = localStorage.getItem('nanivio_token') ?? sessionStorage.getItem('nanivio_token');
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const pickPreset = async (id: string) => {
    onPicked(id); // optimistic
    try {
      await fetch(`${API}/profile/chat-background`, {
        method: 'POST', headers: authHeaders, credentials: 'include',
        body: JSON.stringify({ preset: id }),
      });
    } catch { /* keep optimistic value */ }
  };

  const uploadFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Image too large', description: 'Maximum 10 MB.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await fetch(`${API}/profile/chat-background`, {
        method: 'POST', headers: authHeaders, credentials: 'include',
        body: JSON.stringify({ imageBase64: dataUrl }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error((e as any).error ?? 'Upload failed');
      }
      onUploaded();
      toast({ title: 'Wallpaper updated', description: 'Your photo is now the chat background.' });
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div
        className="relative w-full max-h-[75%] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-white/10 bg-card/95 backdrop-blur-xl p-4 pb-6 space-y-4 animate-in slide-in-from-bottom-4 duration-300"
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto w-10 h-1 rounded-full bg-white/20" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Paintbrush className="w-4 h-4 text-primary" />
            <p className="font-bold text-sm">Chat Wallpaper</p>
          </div>
          <button onClick={onClose} className="text-[#64748b] hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#64748b]/70 -mb-2">Official Nanivio</p>
        <div className="grid grid-cols-3 gap-2.5">
          {presets.filter(p => p.official).map(p => (
            <button
              key={p.id}
              onClick={() => pickPreset(p.id)}
              className={cn(
                'relative h-20 rounded-xl overflow-hidden border-2 transition-all',
                background === p.id ? 'border-primary shadow-lg shadow-primary/20 scale-[1.03]' : 'border-white/10 hover:border-white/30',
              )}
              style={{ background: p.css }}
            >
              {background === p.id && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-primary-foreground" />
                </span>
              )}
              <span className="absolute bottom-1 inset-x-0 text-[9px] font-semibold text-white/90 drop-shadow text-center">{p.label}</span>
            </button>
          ))}
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#64748b]/70 -mb-2">Colors & Textures</p>
        <div className="grid grid-cols-4 gap-2.5">
          {presets.filter(p => !p.official).map(p => (
            <button
              key={p.id}
              onClick={() => pickPreset(p.id)}
              className={cn(
                'relative h-20 rounded-xl overflow-hidden border-2 transition-all',
                background === p.id ? 'border-primary shadow-lg shadow-primary/20 scale-[1.03]' : 'border-white/10 hover:border-white/30',
              )}
              style={{ background: p.css }}
            >
              {background === p.id && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-primary-foreground" />
                </span>
              )}
              <span className="absolute bottom-1 inset-x-0 text-[9px] font-semibold text-white/90 drop-shadow text-center">{p.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className={cn(
            'w-full flex items-center justify-center gap-2 h-11 rounded-xl border-2 border-dashed transition-colors text-sm font-semibold',
            background === 'custom' ? 'border-primary/60 text-primary bg-primary/5' : 'border-white/15 text-[#64748b] hover:border-primary/40 hover:text-foreground',
          )}
        >
          {busy
            ? <span className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
            : <Upload className="w-4 h-4" />}
          {background === 'custom' ? 'Your photo is active — upload a new one' : 'Upload your own photo'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}

function InviteRequestBanner({
  channel, myUserId, onAccept, onDecline,
}: {
  channel: StreamChannel;
  myUserId: string;
  onAccept: (ch: StreamChannel) => void;
  onDecline: (ch: StreamChannel) => void;
}) {
  const members = Object.values(channel.state.members ?? {});
  // The inviter is the member who is NOT the current user and was never in an
  // invited state (they created / own the channel).  Stream Chat marks invited
  // members with invite_accepted_at / invite_rejected_at timestamps; the
  // creator's membership has neither, so filtering by their absence finds them.
  const inviter = members.find((m: any) =>
    m.user_id !== myUserId &&
    !m.invite_accepted_at &&
    !m.invite_rejected_at &&
    !m.invited
  ) ?? members.find((m: any) => m.user_id !== myUserId); // fallback: any non-self member
  const inviterName: string = (inviter as any)?.user?.name ?? 'Someone';
  return (
    <div
      className="fixed inset-x-4 top-20 z-[150] bg-card border border-amber-500/30 rounded-2xl shadow-2xl p-4 flex items-center gap-3 animate-in slide-in-from-top-4 duration-300"
      style={{ boxShadow: '0 0 0 1px rgba(251,191,36,0.15), 0 12px 40px rgba(0,0,0,0.5)' }}
    >
      <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
        <span className="text-xl font-bold text-amber-400">{inviterName.slice(0, 1).toUpperCase()}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm truncate">{inviterName}</p>
        <p className="text-xs text-[#64748b]">wants to chat with you</p>
      </div>
      <button onClick={() => onDecline(channel)} className="w-11 h-11 bg-muted hover:bg-muted/60 rounded-full flex items-center justify-center shrink-0 transition-colors" title="Decline">
        <UserX className="w-4 h-4 text-[#64748b]" />
      </button>
      <button onClick={() => onAccept(channel)} className="w-11 h-11 bg-emerald-500 hover:bg-emerald-600 rounded-full flex items-center justify-center shrink-0 transition-colors" title="Accept">
        <UserCheck className="w-4 h-4 text-white" />
      </button>
    </div>
  );
}

/* ─── inner component (needs Chat ctx) ─── */
function ChatInner({
  streamData,
  onStartCall,
  onNewChat,
  onOpenCommunicationHub,
  setActiveChannelRef,
  openChatRef,
}: {
  streamData: StreamData;
  onStartCall: (type: 'audio' | 'video', ch: StreamChannel) => void;
  onNewChat: () => void;
  onOpenCommunicationHub: () => void;
  setActiveChannelRef: React.MutableRefObject<((ch: StreamChannel | undefined) => void) | null>;
  openChatRef: React.MutableRefObject<((user: SUser) => void) | null>;
}) {
  const { client, channel: activeChannel, setActiveChannel } = useChatContext();
  const [tick, setTick] = useState(0);
  const [contacts, setContacts] = useState<any[]>([]);
  const [addUserQuery, setAddUserQuery] = useState('');


  const [showAddContact, setShowAddContact] = useState(false);
  const [contactNv, setContactNv] = useState('');
  const [contactName, setContactName] = useState('');


  const handleStartCall = useCallback(async (type: 'audio' | 'video', ch: StreamChannel) => {
    if (!agoraCall.ready) {
      toast({ title: 'Calls not ready', description: 'Please wait a moment and try again.', variant: 'destructive' });
      return;
    }
    // Check the other user's calling preferences before dialling
    const members = Object.values(ch.state?.members ?? {}) as any[];
    const other = members.find((m: any) => m.user_id !== streamData?.userId);
    if (other?.user_id) {
      try {
        const authToken = localStorage.getItem('nanivio_token');
        const prefs = await fetch(`${API}/user/calling-settings/${other.user_id}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }).then(r => r.json());
        if (!prefs.callsEnabled) {
          toast({ title: 'Calls not allowed', description: `${other.user?.name ?? 'This user'} has disabled calls.`, variant: 'destructive' });
          return;
        }
        if (type === 'video' && !prefs.videoCallsEnabled) {
          toast({ title: 'Video calls not allowed', description: `${other.user?.name ?? 'This user'} has disabled video calls.`, variant: 'destructive' });
          return;
        }
      } catch { /* allow the call if the preference check fails */ }
    }
    if (!other?.user_id) {
      toast({ title: 'Call failed', description: 'Could not find the other person in this chat.', variant: 'destructive' });
      return;
    }
    if (!ch.id) {
      toast({ title: 'Call failed', description: 'This chat is not ready yet.', variant: 'destructive' });
      return;
    }
    // Paid per-minute calls: if the other user is an expert with paid calls
    // enabled, show the rate and require explicit confirmation before ringing.
    let billing: { expertUserId: number; ratePerMinute: number; currency: string } | undefined;
    try {
      const authToken = localStorage.getItem('nanivio_token');
      const r = await fetch(`${API}/paid-calls/rate/${other.user_id}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.enabled) {
        const name = other.user?.name ?? 'This user';
        if ((d.affordableMinutes ?? 0) < 1) {
          toast({
            title: 'Insufficient balance',
            description: `${name} charges ${d.ratePerMinute} ${d.currency}/min for calls. Top up your wallet to call them.`,
            variant: 'destructive',
          });
          return;
        }
        const ok = window.confirm(
          `${name} charges ${d.ratePerMinute} ${d.currency} per minute for calls.\n\n` +
          `Your balance covers about ${d.affordableMinutes} minute${d.affordableMinutes === 1 ? '' : 's'}. ` +
          `Billing starts when they answer and you'll be charged automatically when the call ends.\n\nStart the paid call?`,
        );
        if (!ok) return;
        billing = { expertUserId: Number(other.user_id), ratePerMinute: d.ratePerMinute, currency: d.currency };
      }
    } catch {
      // If the rate check itself fails we do NOT silently start what might be a
      // paid call — surface it and stop.
      toast({ title: 'Call failed', description: 'Could not check call pricing. Please try again.', variant: 'destructive' });
      return;
    }
    try {
      await agoraCall.startCall(type, String(ch.id), other.user_id, other.user?.name ?? 'Call', billing);
      // Ring the callee's device(s) even if the app is closed
      notifyCallPush(other.user_id, type).then((sent) => {
        if (sent === 0) {
          toast({
            title: 'Ringing in-app only',
            description: `${other.user?.name ?? 'This person'} hasn't enabled call notifications yet — they'll only see the call if the app is open.`,
          });
        }
      });
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      const isRegion = msg.toLowerCase().includes('country') || msg.toLowerCase().includes('region') || msg.toLowerCase().includes('geo');
      toast({
        title: isRegion ? 'Not available in your region' : 'Call failed',
        description: isRegion ? 'Video and audio calls are not supported in your country.' : msg,
        variant: 'destructive',
      });
    }
  }, [agoraCall, streamData?.userId, toast]);



  return (
    /*
     * Mobile layout:  100dvh minus sticky header (56px) minus fixed bottom nav (56px).
     * Using 100dvh (dynamic) means the box shrinks when the virtual keyboard opens,
     * keeping the composer pinned just above the keyboard instead of hidden under it.
     * Desktop: h-full works fine — no fixed nav, no sticky header offset.
     */
    <div className="flex flex-col overflow-hidden md:h-full h-[calc(100dvh-56px-56px)]">
      {/* IncomingCallBanner and activeCall overlay are rendered inside AppLayout
          (via CallOverlay) so they work from any page — not just /chat. */}

      <Chat
        client={chatClient!}
        theme="str-chat__theme-dark"
        customClasses={{
          // Channel's outer container — keep the class so theme CSS vars apply,
          // force column so header + messages stack vertically.
          channel: 'str-chat__channel !flex !flex-col flex-1 min-h-0 overflow-hidden',
          // ChannelInner wraps children in .str-chat__container which defaults to
          // flex-direction:row — the real cause of the side-by-side layout bug.
          // Override it to column here (CSS rule in stream-theme.css is the backup).
          chatContainer: 'str-chat__container !flex !flex-col flex-1 min-h-0 overflow-hidden w-full',
        }}
      >
        <ChatInner
          onOpenCommunicationHub={() => setShowCommunicationHub(true)}
          streamData={streamData}
          onStartCall={handleStartCall}
          onNewChat={() => setShowCommunicationHub(true)}
          setActiveChannelRef={setActiveChannelRef}
          openChatRef={openChatRef}
        />
      </Chat>

      <CommunicationHub
        open={showCommunicationHub}
        onClose={() => setShowCommunicationHub(false)}
        onChat={() => {
          setCommunicationMode("chat");
          setShowCommunicationHub(false);
          setShowNewChatFlow(true);
        }}
        onCall={() => {
          setCommunicationMode("call");
          setShowCommunicationHub(false);
          setShowNewChatFlow(true);
        }}
      />

      <NewChatFlow
        open={showNewChatFlow}
        mode={communicationMode}
        onClose={() => setShowNewChatFlow(false)}
        onStartChat={(user) => {
          setShowNewChatFlow(false);
          console.log("Start chat with:", user);
        }}

        onStartCall={async (user) => {
          setShowNewChatFlow(false);

          try {
            const ch = await openChatRef.current?.(user);

            if (!ch) {
              toast({
                title: "Call failed",
                description: "Could not open conversation.",
                variant: "destructive",
              });
              return;
            }

            await agoraCall.startCall(
              "audio",
              String(ch.id),
              user.id,
              user.name ?? "Call"
            );

          } catch (e: any) {
            toast({
              title: "Call failed",
              description: e?.message ?? String(e),
              variant: "destructive",
            });
          }
        }}
      />

    </div>
  );
}

/* ─── page entry — reads persistent client from StreamChatProvider ─── */
export default function ChatPage() {
  const { streamData, chatClient } = useStreamChat();
  const [needsPushOptIn, setNeedsPushOptIn] = useState(false);

  // Subscribe this device to incoming-call push notifications.
  // On iOS the permission prompt only works from a user tap, so when
  // permission is still 'default' after the automatic attempt we show
  // an explicit "Enable" banner instead.
  useEffect(() => {
    if (!streamData) return;
    void ensurePushSubscription().finally(() => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default'
          && 'serviceWorker' in navigator && 'PushManager' in window) {
        setNeedsPushOptIn(true);
      }
    });
  }, [streamData]);

  const openDirectChat = useCallback(async (user: SUser) => {
    if (!client) return;

    try {
      const raw = await client.queryChannels(
        {
          type: 'messaging',
          members: { $in: [streamData.userId] },
        },
        [{ last_message_at: -1 }],
        { limit: 50, state: true },
      );

      const list: StreamChannel[] = Array.isArray(raw)
        ? raw
        : (raw as any)?.channels ?? [];

      const match = list.find(ch => {
        const ids = Object.keys(ch.state.members ?? {});
        return (
          ids.length === 2 &&
          ids.includes(user.id) &&
          ids.includes(streamData.userId)
        );
      });

      if (match) {
        setActiveChannelRef.current?.(match);
        return match;
      }

      const channelId = `ch-${streamData.userId}-${Date.now()}`;

      const ch = client.channel(
        'messaging',
        channelId,
        {
          members: [
            streamData.userId,
            user.id,
          ],
        },
      );

      await ch.create();
      await ch.watch();

      setActiveChannelRef.current?.(ch);
      return ch;

    } catch (err: any) {
      console.error('Could not open chat', err);
    }
  }, [
    client,
    streamData.userId,
  ]);

  useEffect(() => {
    openChatRef.current = openDirectChat;
  }, [openDirectChat]);




  const { background, setBackground, customUrl, loadCustomImage, presets } = useChatWallpaper();
  const [showWallpaper, setShowWallpaper] = useState(false);
  // In-chat payments
  const [showPaySheet, setShowPaySheet] = useState(false);
  const [payRequestInfo, setPayRequestInfo] = useState<PayRequestInfo | null>(null);
  const PaymentAttachment = useMemo(() => makePaymentAttachment(streamData.userId), [streamData.userId]);
  useEffect(() => {
    registerPayForRequestHandler((info) => { setPayRequestInfo(info); setShowPaySheet(true); });
    return () => registerPayForRequestHandler(null);
  }, []);
  // In-app flash: { name, text } shown for 3 s when a message arrives in a background channel
  const [msgFlash, setMsgFlash] = useState<{ name: string; text: string } | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadContacts = useCallback(async () => {
    const token = localStorage.getItem('nanivio_token');

    const r = await fetch(`${API}/contacts`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const d = await r.json();
    setContacts(d.contacts ?? []);
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);


  const saveContact = async () => {
    const token = localStorage.getItem('nanivio_token');

    const response = await fetch(`${API}/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        nanivioNumber: contactNv,
        contactName,
      }),
    });

    if (response.ok) {
      setContactNv('');
      setContactName('');
      setShowAddContact(false);
      loadContacts();
    }
  };


  const acceptInvite = async (ch: any) => {
    try {
      await ch.addMembers([streamData.userId]);
      await ch.watch();
      setActiveChannel(ch);
    } catch {}
  };


  const declineInvite = async (ch: any) => {
    try {
      await ch.removeMembers([streamData.userId]);
    } catch {}
  };


  const channelFilters = { type: 'messaging', members: { $in: [client?.userID || ''] } };
  // Secondary sort by created_at so brand-new channels (no messages yet) still appear at top
  const channelSort = [{ last_message_at: -1 }, { created_at: -1 }] as const;
  const channelOptions = { limit: 50, state: true, presence: true, watch: true, message_limit: 1 };

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── In-app message flash banner ── */}
      {msgFlash && (
        <div
          className="absolute top-2 inset-x-3 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl border border-primary/30 bg-card/95 backdrop-blur-md shadow-xl shadow-black/30 animate-in slide-in-from-top-3 duration-300"
          style={{ boxShadow: '0 0 0 1px rgba(45,212,191,0.12), 0 8px 32px rgba(0,0,0,0.4)' }}
        >
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <Bell className="w-3.5 h-3.5 text-primary animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-foreground truncate">{msgFlash.name}</p>
            <p className="text-[11px] text-[#64748b] truncate">{msgFlash.text}</p>
          </div>
          <button onClick={() => setMsgFlash(null)} className="text-[#64748b] hover:text-foreground shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}


      <Dialog open={showAddContact} onOpenChange={setShowAddContact}>
        <DialogContent className="max-w-sm rounded-2xl">
          <div className="space-y-4">
            <h2 className="text-lg font-bold">
              Add Contact
            </h2>

            <Input
              placeholder="User NV number (e.g. 0123456789)"
              value={contactNv}
              onChange={(e) => setContactNv(e.target.value)}
            />

            <Input
              placeholder="Save name as..."
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />

            <Button
              className="w-full"
              disabled={
                !/^0\d{9}$/.test(contactNv.trim()) ||
                !contactName.trim()
              }
              onClick={saveContact}
            >
              Save Contact
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {!activeChannel ? (
        /* ── channel list ── */
        <div className="flex flex-col h-full">
          {/* Nanivio Number Chat Entry */}
          <div className="px-4 pt-5 pb-4 border-b border-border/40 space-y-5">

            <div className="text-center">
              <div className="mx-auto mb-3 w-14 h-14 rounded-3xl bg-primary/10 flex items-center justify-center">
                <MessageSquare className="w-7 h-7 text-primary" />
              </div>

              <h1 className="text-xl font-bold">
                Chat
              </h1>

              <p className="text-xs text-muted-foreground mt-1">
                Message any Nanivio Number instantly
              </p>
            </div>

            <div className="space-y-3">
              <Input
                className="h-12 rounded-2xl text-center text-sm"
                placeholder="Enter Nanivio Number"
                value={addUserQuery}
                onChange={(e) => setAddUserQuery(e.target.value)}
              />

              <Button
                className="w-full h-12 rounded-2xl font-semibold"
                disabled={!/^0\d{9}$/.test(addUserQuery.trim())}
                onClick={() => {
                  onOpenCommunicationHub();
                }}
              >
                Start Chat
              </Button>
            </div>

          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain pb-2">

            {/* Contacts */}
            <div className="mx-3 mt-3 mb-2 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
              <div className="flex items-center justify-between px-3 py-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Contacts</span>
                </div>

                <button
                  onClick={() => setShowAddContact(true)}
                  className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center hover:bg-primary/20"
                  title="Add Contact"
                >
                  <UserPlus className="w-4 h-4 text-primary" />
                </button>
              </div>

              {contacts.length === 0 ? (
                <p className="px-3 pb-3 text-xs text-muted-foreground">
                  No saved contacts
                </p>
              ) : (
                contacts.map((c) => (
                  <button
                    key={c.id}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 text-left"
                    onClick={() =>
                      openDirectChat({
                        id: c.streamUserId,
                        name: c.name,
                      })
                    }
                  >
                    <Avatar className="w-8 h-8">
                      <AvatarFallback>
                        {c.name?.slice(0,2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1">
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.nanivioNumber}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>

            <ChannelList
              filters={channelFilters}
              sort={channelSort}
              options={channelOptions}
              setActiveChannelOnMount={false}
              renderChannels={(channels: StreamChannel[]) => {
                // Show empty state only when there are no pending invites either
                if (channels.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-16 gap-4 px-6 text-center">
                      <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                        <MessageSquare className="w-8 h-8 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold">No chats yet</p>
                        <p className="text-sm text-[#64748b] mt-1">Enter a Nanivio Number to start a direct chat or call</p>
                      </div>
                    </div>
                  );
                }

                return (
                  <>
                    {channels.map((ch) => (
                      <ChannelItem
                        key={ch.cid}
                        channel={ch}
                        active={ch.cid === (activeChannel as any)?.cid}
                        myUserId={streamData.userId}
                        tick={tick}
                        onSelect={() => {
                          setActiveChannel(ch);
                          // Persist so the channel is restored after navigation
                          _lastChannelId   = ch.id   ?? null;
                          _lastChannelType = ch.type  ?? 'messaging';
                          ch.markRead?.().catch(() => {});
                        }}
                      />
                    ))}
                  </>
                );
              }}
            />

          </div>
        </div>
      ) : (
        /* ── active channel ── */
        <Channel channel={activeChannel}>
        <WithComponents overrides={{ Attachment: PaymentAttachment }}>
          {/*
           * Layout is controlled by customClasses.channel on <Chat> above,
           * which replaces str-chat__channel's default flex-row with flex-col.
           */}

          {/* ── channel header ── */}
          <div className="flex items-center gap-2.5 px-3 py-2 border-b border-white/[0.06] shrink-0 bg-background/80 backdrop-blur-xl">
            <button
              onClick={() => (setActiveChannel as any)(undefined)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[#64748b] hover:text-foreground hover:bg-white/5 transition-colors shrink-0"
              title="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            {(() => {
              const other = Object.values(activeChannel.state.members ?? {}).find((m: any) => m.user_id !== streamData.userId) as any;
              const title = (activeChannel.data as any)?.name ?? other?.user?.name ?? 'Chat';
              const avatarSrc = streamAvatarUrl(other?.user);
              const online = !!other?.user?.online;
              return (
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <div className="relative shrink-0">
                    <div className="rounded-full p-[2px] bg-gradient-to-tr from-primary/60 via-sky-400/60 to-violet-500/60">
                      <Avatar className="w-9 h-9 border-2 border-background">
                        {avatarSrc && <AvatarImage src={avatarSrc} alt={title} className="object-cover" />}
                        <AvatarFallback className="bg-gradient-to-br from-primary/30 to-violet-500/30 text-primary font-bold text-xs">
                          {String(title).slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    {online && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-background" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate leading-tight">{title}</p>
                    <p className={cn('text-[10px] leading-tight truncate', online ? 'text-emerald-400' : 'text-[#64748b]')}>
                      {lastSeenLabel(other?.user)}
                    </p>
                  </div>
                  {other?.user_id && <PaidRateBadge userId={String(other.user_id)} />}
                </div>
              );
            })()}
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                size="icon" variant="ghost"
                className="w-10 h-10 rounded-full text-[#64748b] hover:text-foreground hover:bg-primary/10"
                title="Chat wallpaper"
                onClick={() => setShowWallpaper(true)}
              >
                <ImageIcon className="w-4 h-4" />
              </Button>
              <Button
                size="icon" variant="ghost"
                className="w-10 h-10 rounded-full text-[#64748b] hover:text-foreground hover:bg-primary/10"
                title="Audio call"
                onClick={() => onStartCall('audio', activeChannel)}
              >
                <Phone className="w-4 h-4" />
              </Button>
              <Button
                size="icon" variant="ghost"
                className="w-10 h-10 rounded-full text-[#64748b] hover:text-foreground hover:bg-primary/10"
                title="Video call"
                onClick={() => onStartCall('video', activeChannel)}
              >
                <Video className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* ── invite state awareness ── */}
          {(() => {
            const myMembership = (activeChannel.state.members ?? {})[streamData.userId] as any;
            const iAmInvited = myMembership?.invited && !myMembership?.invite_accepted_at && !myMembership?.invite_rejected_at;

            const allMembers = Object.values(activeChannel.state.members ?? {}) as any[];
            const pendingInvitees = allMembers.filter(m =>
              m.user_id !== streamData.userId && m.invited && !m.invite_accepted_at && !m.invite_rejected_at
            );
            const isWaitingForAcceptance = !iAmInvited && pendingInvitees.length > 0;

            if (iAmInvited) {
              // ── User B: accept or decline the invitation ──
              const inviterMember = allMembers.find(m => m.user_id !== streamData.userId && !m.invited);
              const inviterName: string = inviterMember?.user?.name ?? 'Someone';
              return (
                <div className="flex flex-col flex-1 items-center justify-center gap-5 px-6 text-center">
                  <div className="w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                    <span className="text-3xl font-bold text-amber-400">{inviterName.slice(0, 1).toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="font-bold text-lg">{inviterName}</p>
                    <p className="text-sm text-[#64748b] mt-1">wants to start a chat with you</p>
                  </div>
                  <p className="text-xs text-[#64748b] max-w-[260px]">
                    Accept to begin messaging. If you decline, this request will be removed.
                  </p>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      className="gap-2 border-border/50 hover:border-destructive/40 hover:text-destructive hover:bg-destructive/5"
                      onClick={() => declineInvite(activeChannel)}
                    >
                      <UserX className="w-4 h-4" />
                      Decline
                    </Button>
                    <Button
                      className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white"
                      onClick={() => acceptInvite(activeChannel)}
                    >
                      <UserCheck className="w-4 h-4" />
                      Accept
                    </Button>
                  </div>
                </div>
              );
            }

            if (isWaitingForAcceptance) {
              // ── User A: waiting for B to accept ──
              const inviteeName: string = pendingInvitees[0]?.user?.name ?? 'them';
              return (
                <div className="flex flex-col flex-1 items-center justify-center gap-5 px-6 text-center">
                  <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Clock className="w-8 h-8 text-primary animate-pulse" />
                  </div>
                  <div>
                    <p className="font-bold text-base">Waiting for {inviteeName}</p>
                    <p className="text-sm text-[#64748b] mt-1">
                      Your chat request has been sent. You can start messaging once they accept.
                    </p>
                  </div>
                  <p className="text-xs text-[#64748b]/70">
                    {inviteeName} will see your request in their Messages tab.
                  </p>
                </div>
              );
            }

            // ── Normal: both users are full members ──
            return (
              <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden w-full">
                {/* wallpaper layer */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={
                    background === 'custom' && customUrl
                      ? { backgroundImage: `url(${customUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                      : { background: presetCss(background, presets) }
                  }
                />
                {/* WhatsApp-style doodle pattern over gradient presets (not image wallpapers) */}
                {!(background === 'custom' && customUrl) && !presetCss(background, presets).includes('url(') && (
                  <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: DOODLE_PATTERN }} />
                )}
                {/* readability overlay on top of custom photos */}
                {background === 'custom' && customUrl && (
                  <div className="absolute inset-0 pointer-events-none bg-black/45" />
                )}
                <div className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain chat-wallpaper-active">
                  <MessageList />
                </div>
                {/* typing indicator — "typing…" like WhatsApp, just above the composer */}
                <div className="relative shrink-0 px-4 wa-typing">
                  <TypingIndicator scrollToBottom={() => {}} />
                </div>
                {/* Composer + visible emoji button */}
                <div className="relative shrink-0 w-full border-t border-white/[0.06] bg-background/70 backdrop-blur-xl">
                  <div className="flex items-center px-3 pt-2 pb-0.5">
                    <StreamEmojiPicker />
                    <span className="ml-2 text-[11px] text-[#64748b]/50">emoji</span>
                    <button
                      type="button"
                      data-testid="chat-pay-btn"
                      onClick={() => { setPayRequestInfo(null); setShowPaySheet(true); }}
                      className="ml-3 flex items-center gap-1 h-7 px-2.5 rounded-full bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors text-[11px] font-bold"
                      title="Send or request money"
                    >
                      💸 Pay
                    </button>
                  </div>
                  <MessageComposer
                    additionalTextareaProps={{ placeholder: 'Message…' }}
                    audioRecordingEnabled
                    emojiSearchIndex={SearchIndex}
                  />
                </div>
                {(() => {
                  const other = Object.values(activeChannel.state.members ?? {}).find((m: any) => m.user_id !== streamData.userId) as any;
                  return (
                    <PaymentSheet
                      open={showPaySheet}
                      onClose={() => { setShowPaySheet(false); setPayRequestInfo(null); }}
                      chatId={(activeChannel as any).id ?? ''}
                      otherUserId={payRequestInfo?.requesterUserId ?? other?.user_id ?? ''}
                      otherName={payRequestInfo?.requesterName ?? other?.user?.name ?? 'Contact'}
                      payRequest={payRequestInfo}
                    />
                  );
                })()}
                <WallpaperSheet
                  open={showWallpaper}
                  onClose={() => setShowWallpaper(false)}
                  presets={presets}
                  background={background}
                  onPicked={id => setBackground(id)}
                  onUploaded={() => { setBackground('custom'); loadCustomImage(); }}
                />
              </div>
            );
          })()}
        </WithComponents>
        </Channel>
      )}

    </div>
  );
}

/* ─── connected page — uses persistent clients from context providers ─── */
function ChatConnected() {
  const { streamData: _sd, chatClient } = useStreamChat();
  const streamData = _sd!; // guaranteed by ChatPage guard
  const agoraCall = useAgoraCall();
  const { toast } = useToast();
  const setActiveChannelRef = useRef<((ch: any) => void) | null>(null);
  const openChatRef = useRef<((user: SUser) => Promise<StreamChannel | undefined>) | null>(null);

  const [addUserQuery, setAddUserQuery] = useState('');
  const [showCommunicationHub, setShowCommunicationHub] = useState(false);
  const [showNewChatFlow, setShowNewChatFlow] = useState(false);
  const [communicationMode, setCommunicationMode] = useState<"chat" | "call">("chat");

  const [contacts, setContacts] = useState<any[]>([]);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactNv, setContactNv] = useState('');
  const [contactName, setContactName] = useState('');


  // Auto-start audio call when Vibe sends /chat?call=NV
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nv = params.get("call");

    if (!nv || !openChatRef.current) return;

    const startNvCall = async () => {
      try {
        const token = localStorage.getItem("nanivio_token");

        const res = await fetch(
          `${API}/stream/chat/${encodeURIComponent(nv)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!res.ok) return;

        const data = await res.json();

        if (!data.userId) return;

        const user = {
          id: data.userId,
          name: data.name,
          nanivioNumber: nv,
        };

        const ch = await openChatRef.current?.(user);

        if (!ch) return;

        await handleStartCall("audio", ch);

        window.history.replaceState({}, "", "/chat");

      } catch (err) {
        console.error("NV call failed:", err);
      }
    };

    startNvCall();

  }, []);






  const handleEnablePush = useCallback(() => {
    void ensurePushSubscription().finally(() => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'default') {
        setNeedsPushOptIn(false);
      }
    });
  }, []);

  if (!streamData || !chatClient) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-4">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
          <MessageSquare className="w-8 h-8 text-primary animate-pulse" />
        </div>
        <p className="text-sm text-[#64748b]">Connecting to chat…</p>
      </div>
    );
  }

  return (
    <>
      {needsPushOptIn && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border-b border-primary/20 text-sm">
          <BellRing className="w-4 h-4 text-primary shrink-0" />
          <span className="flex-1 text-foreground/90">Turn on notifications to get calls when the app is closed</span>
          <button
            onClick={handleEnablePush}
            className="px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold"
            data-testid="button-enable-call-notifications"
          >
            Enable
          </button>
          <button
            onClick={() => setNeedsPushOptIn(false)}
            className="text-[#64748b] text-xs px-1"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      <ChatConnected />
    </>
  );
}

/** Small "per-minute rate" pill shown in the chat header when the other user
 *  has paid calls enabled, so users see the rate before pressing call. */
function PaidRateBadge({ userId }: { userId: string }) {
  const [rate, setRate] = useState<{ ratePerMinute: number; currency: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRate(null);
    const token = localStorage.getItem('nanivio_token');
    if (!token) return;
    fetch(`${API}/paid-calls/rate/${userId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.enabled) setRate({ ratePerMinute: d.ratePerMinute, currency: d.currency }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);
  if (!rate) return null;
  return (
    <span
      data-testid="paid-rate-badge"
      className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-400/25"
      title="This user charges per minute for calls"
    >
      {rate.ratePerMinute} {rate.currency}/min calls
    </span>
  );
}
