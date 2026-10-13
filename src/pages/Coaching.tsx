import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import AppBreadcrumb from "@/components/AppBreadcrumb";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { brandLogo as logo } from "@/lib/brand";
import { getTierCapability, normalizePlanTier, type PlanTier } from "@/lib/tier-policy";
import {
  Send, ArrowLeft, Loader2, MessageSquare,
  TrendingUp, AlertTriangle, Target, Sparkles, RotateCcw
} from "lucide-react";
import { formatLensLabel, type AdaptiveLens } from "@/lib/intentus-architecture";

interface Message {
  id?: string;
  saveState?: "saving" | "unsaved" | "saved";
  role: "user" | "assistant";
  content: string;
  session_date?: string;
  created_at?: string;
  client_ts?: number;
}

export function localSessionDate(date = new Date()): string {
  return format(date, 'yyyy-MM-dd');
}

const quickPrompts = [
  { icon: <TrendingUp className="h-4 w-4" />, label: "How am I trending?", prompt: "Based on my recent check-ins, how am I trending? Where is my operating rhythm tightening or slipping?" },
  { icon: <AlertTriangle className="h-4 w-4" />, label: "Am I drifting?", prompt: "Am I drifting from my operating focus and 90-day plan? Be direct and use evidence." },
  { icon: <Target className="h-4 w-4" />, label: "What should I focus on?", prompt: "What's the single highest-priority move I should focus on this week based on everything you know about me?" },
  { icon: <Sparkles className="h-4 w-4" />, label: "Challenge me", prompt: "Challenge my assumptions. What contradiction, self-protection, or blind spot should I confront right now?" },
];

const Coaching = () => {
  const historyGeneration = useRef(0);
  const sendFlight = useRef(false);
  const saveFlights = useRef(new Set<string>());
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeLens, setActiveLens] = useState<AdaptiveLens | null>(null);
  const [planTier, setPlanTier] = useState<PlanTier>("free");
  const [profileLoading, setProfileLoading] = useState(true);
  const [freshStart, setFreshStart] = useState(false);
  const [freshStartAt, setFreshStartAt] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { user } = useAuth();
  const navigate = useNavigate();

  const todayStr = localSessionDate();

  const formatDateLabel = (dateStr: string) => {
    const d = parseISO(dateStr);
    if (isToday(d)) return "Today";
    if (isYesterday(d)) return "Yesterday";
    return format(d, "EEE MMM d");
  };

  const priorSessionDates = useMemo(() => {
    const dates = Array.from(new Set(messages.map(m => m.session_date).filter(Boolean) as string[]));
    return dates.filter(d => d !== todayStr).slice(-3);
  }, [messages, todayStr]);

  const scrollToDate = (dateStr: string) => {
    dateRefs.current[dateStr]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleStartFresh = () => {
    setFreshStart(true);
    setFreshStartAt(Date.now());
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  useEffect(() => {
    if (!user) return;
    const loadProfile = async () => {
      setProfileLoading(true);
      try {
        const { data } = await supabase.from("profiles").select("plan_tier").eq("user_id", user.id).single();
        setPlanTier(normalizePlanTier(data?.plan_tier));
        // No active lens available from current schema
        setActiveLens(null);
      } finally {
        setProfileLoading(false);
      }
    };
    loadProfile();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const generation = ++historyGeneration.current;
    const loadHistory = async () => {
      setHistoryLoading(true);
      setHistoryError(false);
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const { data, error } = await supabase.from('coaching_messages')
          .select('id, role, content, created_at, session_date').eq('user_id', user.id)
          .gte('session_date', localSessionDate(sevenDaysAgo)).order('created_at', { ascending: true });
        if (generation !== historyGeneration.current) return;
        if (error) throw error;
        // Preserve in-memory pending messages if history is explicitly retried.
        setMessages(prev => {
          const merged = new Map((data || []).map(m => [m.id, { ...m, role: m.role as Message['role'], saveState: 'saved' as const }]));
          for (const m of prev) if (m.id && m.saveState !== 'saved') merged.set(m.id, m as never);
          return [...merged.values()];
        });
      } catch {
        if (generation === historyGeneration.current) setHistoryError(true);
      } finally {
        if (generation === historyGeneration.current) setHistoryLoading(false);
      }
    };
    loadHistory();
    return () => { historyGeneration.current++; };
  }, [user?.id, historyAttempt]);

  const persistMessage = async (message: Message) => {
    if (!user || !message.id || saveFlights.current.has(message.id)) return;
    saveFlights.current.add(message.id);
    setMessages(prev => prev.map(m => m.id === message.id ? {...m, saveState: 'saving'} : m));
    try {
      const { error } = await supabase.from('coaching_messages').insert({
        id: message.id, user_id: user.id, role: message.role,
        content: message.content, session_date: message.session_date,
      });
      // Retrying an ambiguous write uses the SAME id; a conflict is read back,
      // never a second AI generation or a second history row.
      if (error && error.code !== '23505') throw error;
      const { data, error: readError } = await supabase.from('coaching_messages')
        .select('id, role, content, session_date').eq('id', message.id).eq('user_id', user.id).single();
      if (readError || !data || data.content !== message.content || data.role !== message.role || data.session_date !== message.session_date) throw new Error('History save not confirmed');
      setMessages(prev => prev.map(m => m.id === message.id ? {...m, saveState: 'saved'} : m));
    } catch {
      setMessages(prev => prev.map(m => m.id === message.id ? {...m, saveState: 'unsaved'} : m));
    } finally { saveFlights.current.delete(message.id); }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    const tierCapability = getTierCapability(planTier);
    if (!user || !text.trim() || isStreaming || sendFlight.current || historyLoading || historyError || !tierCapability.canUseAiChat) return;
    sendFlight.current = true;

    const trimmedInput = text.trim();
    const today = localSessionDate();
    const assistantId = crypto.randomUUID();
    const nowTs = Date.now();
    const userMsg: Message = { id: crypto.randomUUID(), saveState: "saving", role: "user", content: trimmedInput, session_date: today, client_ts: nowTs };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setIsStreaming(true);

    // Build context: include last 10 from most recent prior session, then current-session messages.
    // If freshStart, restrict current-session messages to today only.
    const currentSessionMsgs = freshStart && freshStartAt
      ? updatedMessages.filter(m => {
        // Always include the message currently being sent.
        if (m === userMsg) return true;
        const ts = m.client_ts ?? (m.created_at ? new Date(m.created_at).getTime() : 0);
        return ts >= freshStartAt;
      })
      : updatedMessages.filter(m => !m.session_date || m.session_date === today);
    const priorDates = Array.from(new Set(updatedMessages.map(m => m.session_date).filter(Boolean) as string[]))
      .filter(d => d !== today);
    const mostRecentPriorDate = priorDates.sort().pop();
    const priorContextMsgs = mostRecentPriorDate && !freshStart
      ? updatedMessages.filter(m => m.session_date === mostRecentPriorDate).slice(-10)
      : [];
    const outboundMessages = [...priorContextMsgs, ...currentSessionMsgs].map(m => ({ role: m.role, content: m.content }));

    await persistMessage(userMsg);

    let assistantText = "";

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/coaching-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          mode: "chat",
          messages: outboundMessages,
        }),
      });

      if (!resp.ok || !resp.body) {
        const errData = resp.ok ? null : await resp.json().catch(() => null);
        setMessages(prev => [...prev, {
          role: "assistant",
          content: errData?.error || "Sorry, I couldn't process that right now. Please try again.",
          session_date: today,
        }]);
        setIsStreaming(false);
        sendFlight.current = false;
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantText += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.id === assistantId) {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantText, client_ts: m.client_ts ?? Date.now() } : m);
                }
                return [...prev, { id: assistantId, saveState: "saving", role: "assistant", content: assistantText, session_date: today, client_ts: Date.now() }];
              });
            }
          } catch {
            // Ignore incomplete SSE chunks; the next chunk usually completes the frame.
          }
        }
      }
    } catch (e) {
      console.error("Chat error:", e);
      if (!assistantText) {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Something went wrong. Please try again.",
          session_date: today,
        }]);
      }
    }
    if (assistantText) await persistMessage({ id: assistantId, role: 'assistant', content: assistantText, session_date: today });
    setIsStreaming(false);
    sendFlight.current = false;
    inputRef.current?.focus();
  };


  const tierCapability = getTierCapability(planTier);

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col h-[100dvh]">
      {/* Header */}
      <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} aria-label="Back to dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center">
              <img src={logo} alt="Intentus" className="h-8 w-auto object-contain md:h-10" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground hidden sm:block">Operating coach · Direct, warm, not therapy{activeLens ? ` · ${formatLensLabel(activeLens)}` : ""}</p>
            {messages.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    title="Start fresh"
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Start fresh
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Start a new session?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Your history will be preserved but today's context resets.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleStartFresh}>Start fresh</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </nav>

      <AppBreadcrumb />
      <p className="px-4 text-xs text-muted-foreground">New sessions use your device’s local calendar. Older session dates are shown as recorded and may have been grouped in UTC.</p>
      {historyLoading && <p role="status">Loading history…</p>}
      {historyError && <div role="alert">History could not be loaded. <Button onClick={() => setHistoryAttempt(n => n + 1)}>Retry history</Button></div>}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-2xl px-4 py-6 space-y-4">
          {messages.length === 0 && (
            <div className="space-y-6">
              <div className="text-center space-y-2 pt-8">
                <div className="inline-flex bg-primary/10 rounded-2xl p-4">
                  <MessageSquare className="h-8 w-8 text-primary" />
                </div>
                <h2 className="font-heading text-xl font-bold text-foreground">Your AI Operating Coach</h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  {tierCapability.canUseAiChat
                    ? `You are using ${tierCapability.coachingName}. Ask about progress, drift, decision clarity, blind spots, or the next move.`
                    : "Starter includes the audit snapshot and weekly accountability tracking. Ongoing AI coaching opens on Executive and above."}
                </p>
                {activeLens && (
                  <p className="text-xs text-primary font-medium">Currently weighted toward {formatLensLabel(activeLens).toLowerCase()}.</p>
                )}
              </div>
              {tierCapability.canUseAiChat ? (
                <div className="grid grid-cols-2 gap-3">
                  {quickPrompts.map((qp, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(qp.prompt)}
                      className="flex items-center gap-2 p-3 rounded-xl border border-border bg-card hover:bg-accent/5 hover:border-primary/30 transition-all text-left text-sm"
                    >
                      <div className="text-primary shrink-0">{qp.icon}</div>
                      <span className="text-foreground font-medium">{qp.label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-border bg-card p-5 text-center space-y-3">
                  <p className="text-sm text-foreground">{tierCapability.aiBehavior}</p>
                  <Button variant="hero" onClick={() => navigate("/subscribe")}>View plans</Button>
                </div>
              )}
            </div>
          )}

          {priorSessionDates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <span className="text-xs text-muted-foreground">Previous sessions:</span>
              {priorSessionDates.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => scrollToDate(d)}
                  className="text-xs px-2.5 py-1 rounded-full border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  {formatDateLabel(d)}
                </button>
              ))}
            </div>
          )}

          {messages.map((msg, i) => {
            const prev = messages[i - 1];
            const showDivider = msg.session_date && msg.session_date !== prev?.session_date;
            const isFirstOfDate = showDivider && msg.session_date;
            return (
              <div key={msg.id || i}>
                {showDivider && (
                  <div
                    ref={(el) => { if (isFirstOfDate) dateRefs.current[msg.session_date!] = el; }}
                    className="flex items-center gap-3 my-4"
                  >
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground font-medium">{formatDateLabel(msg.session_date!)}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card border border-border text-foreground"
                  }`}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.saveState === 'unsaved' && <div role="alert">Not saved to history. Keep this page open. <Button variant="outline" size="sm" onClick={() => persistMessage(msg)}>Retry save</Button></div>}
                    {msg.saveState === 'saving' && <p role="status" className="text-xs">Saving history…</p>}
                    {msg.role === "assistant" && i === messages.length - 1 && isStreaming && (
                      <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-middle" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex justify-start">
              <div className="bg-card border border-border rounded-2xl px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-card/50 backdrop-blur-sm p-4">
        <div className="container mx-auto max-w-2xl">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
            className="flex gap-2"
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={tierCapability.canUseAiChat ? "Ask for clarity, challenge, or the next priority..." : "Upgrade to Executive to use the AI coach"}
              disabled={isStreaming || historyLoading || historyError || profileLoading || !tierCapability.canUseAiChat}
              className="flex-1"
            />
            <Button type="submit" variant="hero" size="icon" aria-label="Send message" disabled={isStreaming || historyLoading || historyError || !input.trim() || profileLoading || !tierCapability.canUseAiChat}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Coaching and self-reflection tools, not medical advice.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Coaching;
