import { useState, useEffect, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { Flag, FileText, Star, CheckSquare, Check, Trash2, ChevronDown, ChevronUp, Plus, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

type AnnotationType = 'note' | 'flag' | 'session_prep' | 'action_item';

type Annotation = {
  id: string;
  annotation_type: AnnotationType;
  content: string;
  resolved: boolean;
  created_at: string;
};

type Props = {
  clientUserId: string;
  coachId: string;
  contextType?: string;
  contextId?: string;
  defaultType?: AnnotationType;
};

const TYPE_CONFIG: Record<AnnotationType, { label: string; color: string; icon: React.ReactNode }> = {
  note: {
    label: 'Note',
    color: 'text-muted-foreground',
    icon: <FileText className="h-3.5 w-3.5" />,
  },
  flag: {
    label: 'Flag',
    color: 'text-destructive',
    icon: <Flag className="h-3.5 w-3.5" />,
  },
  session_prep: {
    label: 'Session Prep',
    color: 'text-yellow-500',
    icon: <Star className="h-3.5 w-3.5" />,
  },
  action_item: {
    label: 'Action Item',
    color: 'text-emerald-500',
    icon: <CheckSquare className="h-3.5 w-3.5" />,
  },
};

const TYPE_ORDER: AnnotationType[] = ['session_prep', 'flag', 'action_item', 'note'];

export const CoachAnnotations = ({
  clientUserId,
  coachId,
  contextType,
  contextId,
  defaultType,
}: Props) => {
  const { toast } = useToast();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState<AnnotationType>(defaultType ?? 'note');
  const [showResolved, setShowResolved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [visibleToClient, setVisibleToClient] = useState(false);

  // Bumped per load so a slow response for a previous client/context can't
  // overwrite the list for the one currently shown.
  const loadGeneration = useRef(0);

  const loadAnnotations = useCallback(async () => {
    const generation = ++loadGeneration.current;
    let query = supabase
      .from('coach_annotations')
      .select('*')
      .eq('coach_id', coachId)
      .eq('client_user_id', clientUserId)
      .order('created_at', { ascending: false });

    if (contextType) query = query.eq('context_type', contextType);
    if (contextId) query = query.eq('context_id', contextId);

    const { data, error } = await query;
    if (generation !== loadGeneration.current) return;
    if (!error && data) {
      setAnnotations(data as Annotation[]);
    }
  }, [clientUserId, coachId, contextType, contextId]);

  useEffect(() => {
    setAnnotations([]);
    loadAnnotations();
  }, [loadAnnotations]);


  const addAnnotation = async () => {
    if (!newContent.trim()) return;
    setAdding(true);

    // Optimistic add
    const tempId = `temp-${Date.now()}`;
    const optimistic: Annotation = {
      id: tempId,
      annotation_type: newType,
      content: newContent.trim(),
      resolved: false,
      created_at: new Date().toISOString(),
    };
    setAnnotations((prev) => [optimistic, ...prev]);
    const savedContent = newContent.trim();
    setNewContent('');

    const { data, error } = await supabase
      .from('coach_annotations')
      .insert({
        coach_id: coachId,
        client_user_id: clientUserId,
        annotation_type: newType,
        content: savedContent,
        resolved: false,
        is_private: !visibleToClient,
        context_type: contextType ?? null,
        context_id: contextId ?? null,
      })
      .select()
      .single();

    if (error) {
      // Rollback
      setAnnotations((prev) => prev.filter((a) => a.id !== tempId));
      setNewContent(savedContent);
      toast({ title: 'Failed to add annotation', description: error.message, variant: 'destructive' });
    } else if (data) {
      setAnnotations((prev) =>
        prev.map((a) => (a.id === tempId ? (data as Annotation) : a))
      );
    }

    setAdding(false);
  };

  const resolveAnnotation = async (id: string) => {
    // Optimistic
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)));
    // RLS turns a no-longer-permitted write (client turned sharing off, coach
    // plan lapsed) into zero rows with no error: confirm the row changed.
    const { data, error } = await supabase
      .from('coach_annotations')
      .update({ resolved: true })
      .eq('id', id)
      .select('id');

    if (error || !data?.length) {
      setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: false } : a)));
      toast({ title: 'Failed to resolve', variant: 'destructive' });
    }
  };

  const deleteAnnotation = async (id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    const { data, error } = await supabase.from('coach_annotations').delete().eq('id', id).select('id');
    if (error || !data?.length) {
      toast({ title: 'Failed to delete', variant: 'destructive' });
      await loadAnnotations();
    }
  };

  const active = annotations.filter((a) => !a.resolved);
  const resolved = annotations.filter((a) => a.resolved);

  const AnnotationRow = ({
    annotation,
    isResolved,
  }: {
    annotation: Annotation;
    isResolved: boolean;
  }) => {
    const cfg = TYPE_CONFIG[annotation.annotation_type];
    return (
      <div
        className={`flex items-start gap-2.5 py-2.5 border-b border-border/50 last:border-0 ${
          isResolved ? 'opacity-50' : ''
        }`}
      >
        <span className={`mt-0.5 shrink-0 ${cfg.color}`}>{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
          </div>
          <p className="text-sm text-foreground leading-relaxed">{annotation.content}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {format(new Date(annotation.created_at), 'MMM d, yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {!isResolved && (
            <button
              onClick={() => resolveAnnotation(annotation.id)}
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-emerald-500 transition-colors"
              title="Mark resolved"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => deleteAnnotation(annotation.id)}
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Section title */}
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">Coaching Notes</h3>
        {active.length > 0 && (
          <Badge variant="secondary" className="h-5 text-xs px-1.5">
            {active.length}
          </Badge>
        )}
      </div>

      {/* Active annotations */}
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No annotations yet.</p>
      ) : (
        <div className="rounded-lg border border-border bg-card px-3">
          {active.map((a) => (
            <AnnotationRow key={a.id} annotation={a} isResolved={false} />
          ))}
        </div>
      )}

      {/* Resolved toggle */}
      {resolved.length > 0 && (
        <div>
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showResolved ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {showResolved ? 'Hide' : 'Show'} resolved ({resolved.length})
          </button>
          {showResolved && (
            <div className="mt-2 rounded-lg border border-border bg-card/50 px-3">
              {resolved.map((a) => (
                <AnnotationRow key={a.id} annotation={a} isResolved={true} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add new annotation form */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Add annotation
        </p>

        {/* Type selector — pill buttons */}
        <div className="flex flex-wrap gap-1.5">
          {TYPE_ORDER.map((t) => {
            const cfg = TYPE_CONFIG[t];
            const isActive = newType === t;
            return (
              <button
                key={t}
                onClick={() => setNewType(t)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 border-primary text-foreground'
                    : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                }`}
              >
                <span className={isActive ? cfg.color : ''}>{cfg.icon}</span>
                {cfg.label}
              </button>
            );
          })}
        </div>

        <Textarea
          placeholder={`Add a ${TYPE_CONFIG[newType].label.toLowerCase()}...`}
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          className="bg-background resize-none text-sm"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addAnnotation();
          }}
        />

        <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/50">
          <div className="flex items-center gap-2">
            {visibleToClient ? (
              <Eye className="h-3.5 w-3.5 text-primary" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <Label htmlFor="visible-to-client" className="text-xs cursor-pointer">
              Visible to client
            </Label>
            <Switch
              id="visible-to-client"
              checked={visibleToClient}
              onCheckedChange={setVisibleToClient}
            />
          </div>
          <Button
            size="sm"
            onClick={addAnnotation}
            disabled={!newContent.trim() || adding}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
};
