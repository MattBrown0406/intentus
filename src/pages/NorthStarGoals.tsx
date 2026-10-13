import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Plus, Pencil, Trash2, Check, X, Loader2, Target, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import AppBreadcrumb from '@/components/AppBreadcrumb';

type Horizon = '1_year' | '3_year' | '5_year';

type Goal = {
  id: string;
  horizon: Horizon;
  title: string;
  description: string | null;
  why: string | null;
  success_looks_like: string | null;
  created_at: string;
};

type GoalForm = {
  title: string;
  description: string;
  why: string;
  success_looks_like: string;
};

const emptyForm = (): GoalForm => ({
  title: '',
  description: '',
  why: '',
  success_looks_like: '',
});

const HORIZONS: { value: Horizon; label: string; years: string }[] = [
  { value: '1_year', label: '1 Year', years: '1 year' },
  { value: '3_year', label: '3 Years', years: '3 years' },
  { value: '5_year', label: '5 Years', years: '5 years' },
];

const NorthStarGoals = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingHorizon, setAddingHorizon] = useState<Horizon | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GoalForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);


  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    loadGoals();
  }, [user, navigate]);

  const loadGoals = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('north_star_goals')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) {
      toast({ title: 'Error loading goals', description: error.message, variant: 'destructive' });
    } else {
      setGoals((data as Goal[]) ?? []);
    }
    setLoading(false);
  };

  const goalsForHorizon = (h: Horizon) => goals.filter((g) => g.horizon === h);

  const handleSave = async (horizon: Horizon) => {
    if (!form.title.trim()) {
      toast({ title: 'Title is required', variant: 'destructive' });
      return;
    }
    if (!user) return;
    setSaving(true);

    if (editingId) {
      const { error } = await supabase
        .from('north_star_goals')
        .update({
          title: form.title.trim(),
          description: form.description.trim() || null,
          why: form.why.trim() || null,
          success_looks_like: form.success_looks_like.trim() || null,
        })
        .eq('id', editingId);

      if (error) {
        toast({ title: 'Failed to save goal', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Goal updated' });
        await loadGoals();
        setEditingId(null);
        setForm(emptyForm());
      }
    } else {
      const { error } = await supabase.from('north_star_goals').insert({
        user_id: user.id,
        horizon,
        title: form.title.trim(),
        description: form.description.trim() || null,
        why: form.why.trim() || null,
        success_looks_like: form.success_looks_like.trim() || null,
        is_active: true,
      });

      if (error) {
        toast({ title: 'Failed to add goal', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Goal added' });
        await loadGoals();
        setAddingHorizon(null);
        setForm(emptyForm());
      }
    }

    setSaving(false);
  };

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    setPendingDeleteId(null);
    const { error } = await supabase
      .from('north_star_goals')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      toast({ title: 'Failed to delete goal', description: error.message, variant: 'destructive' });
    } else {
      setGoals((prev) => prev.filter((g) => g.id !== id));
      toast({ title: 'Goal deleted' });
    }
  };


  const startEdit = (goal: Goal) => {
    setAddingHorizon(null);
    setEditingId(goal.id);
    setForm({
      title: goal.title,
      description: goal.description ?? '',
      why: goal.why ?? '',
      success_looks_like: goal.success_looks_like ?? '',
    });
  };

  const cancelForm = () => {
    setEditingId(null);
    setAddingHorizon(null);
    setForm(emptyForm());
  };

  const renderGoalFormFields = (horizon: Horizon) => (
    <div className="space-y-3">
      <Input
        placeholder="Goal title (required)"
        value={form.title}
        onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
        className="bg-background"
        autoFocus
      />
      <Textarea
        placeholder="Description (optional)"
        value={form.description}
        onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
        className="bg-background resize-none"
        rows={2}
      />
      <Textarea
        placeholder="Why does this matter? (optional)"
        value={form.why}
        onChange={(e) => setForm((p) => ({ ...p, why: e.target.value }))}
        className="bg-background resize-none"
        rows={2}
      />
      <Textarea
        placeholder="What does success look like? (optional)"
        value={form.success_looks_like}
        onChange={(e) => setForm((p) => ({ ...p, success_looks_like: e.target.value }))}
        className="bg-background resize-none"
        rows={2}
      />
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => handleSave(horizon)}
          disabled={saving || !form.title.trim()}
          className="gap-1.5"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {editingId ? 'Save changes' : 'Add goal'}
        </Button>
        <Button variant="ghost" size="sm" onClick={cancelForm} className="gap-1.5">
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Link
            to="/dashboard"
            className="text-sm font-semibold text-foreground tracking-tight hover:text-primary transition-colors"
          >
            Intentus
          </Link>
          <div className="w-16" /> {/* spacer */}
        </div>
      </nav>

      <AppBreadcrumb />

      <div className="max-w-4xl mx-auto px-4 pt-4">
        <p className="text-sm text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
          ℹ️ Your goals are shared with your AI coaching sessions as active context.
        </p>
      </div>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-10">
        {/* Hero section */}
        <div className="mb-10 space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Target className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="font-heading text-3xl font-bold text-foreground tracking-tight">
                North Star
              </h1>
            </div>
          </div>
          <p className="text-muted-foreground leading-relaxed max-w-xl">
            Where you're going shapes how you operate today. These goals give your 90-day plans
            direction and meaning.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="secondary" className="text-xs">
              {goals.length} {goals.length === 1 ? 'goal' : 'goals'} set
            </Badge>
            <Link
              to="/report"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
            >
              View 90-day plan
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="1_year">
          <TabsList className="w-full grid grid-cols-3 mb-6">
            {HORIZONS.map(({ value, label }) => {
              const count = goalsForHorizon(value).length;
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  onClick={() => {
                    if (addingHorizon !== value && editingId !== null) cancelForm();
                  }}
                  className="gap-2"
                >
                  {label}
                  {count > 0 && (
                    <Badge
                      variant="secondary"
                      className="h-4 min-w-4 px-1 text-[10px] leading-none"
                    >
                      {count}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {HORIZONS.map(({ value: horizon, label, years }) => {
            const horizonGoals = goalsForHorizon(horizon);
            const isAddingHere = addingHorizon === horizon;

            return (
              <TabsContent key={horizon} value={horizon} className="space-y-4 focus-visible:outline-none">
                {/* Loading */}
                {loading && (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {/* Goal cards */}
                {!loading && horizonGoals.map((goal) => (
                  <Card key={goal.id} className="bg-card border-border">
                    {editingId === goal.id ? (
                      <CardContent className="pt-5">
                        {renderGoalFormFields(horizon)}
                      </CardContent>
                    ) : (
                      <>
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between gap-2">
                            <CardTitle className="text-base leading-snug font-semibold">
                              {goal.title}
                            </CardTitle>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => startEdit(goal)}
                                aria-label={`Edit goal: ${goal.title}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => setPendingDeleteId(goal.id)}
                                aria-label={`Delete goal: ${goal.title}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-2 pt-0">
                          {goal.description && (
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              {goal.description}
                            </p>
                          )}
                          {goal.why && (
                            <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2">
                              <p className="text-xs font-medium text-primary mb-0.5 uppercase tracking-wide">
                                Why it matters
                              </p>
                              <p className="text-sm text-foreground leading-relaxed">{goal.why}</p>
                            </div>
                          )}
                          {goal.success_looks_like && (
                            <div className="rounded-lg bg-muted/30 border border-border px-3 py-2">
                              <p className="text-xs font-medium text-muted-foreground mb-0.5 uppercase tracking-wide">
                                Success looks like
                              </p>
                              <p className="text-sm text-foreground leading-relaxed">
                                {goal.success_looks_like}
                              </p>
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground pt-1">
                            Added {format(new Date(goal.created_at), 'MMM d, yyyy')}
                          </p>
                        </CardContent>
                      </>
                    )}
                  </Card>
                ))}

                {/* Empty state */}
                {!loading && horizonGoals.length === 0 && !isAddingHere && (
                  <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
                    <Target className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      No goals set yet.
                      <br />
                      What do you want to be true in {years}?
                    </p>
                  </div>
                )}

                {/* Add form */}
                {!loading && isAddingHere && (
                  <Card className="bg-card border-primary/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold text-foreground">
                        New {label} goal
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {renderGoalFormFields(horizon)}
                    </CardContent>
                  </Card>
                )}

                {/* Add goal button */}
                {!loading && !isAddingHere && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      cancelForm();
                      setAddingHorizon(horizon);
                    }}
                    className="gap-1.5 w-full border-dashed"
                  >
                    <Plus className="h-4 w-4" />
                    Add {label} goal
                  </Button>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </main>

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this goal?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>

  );
};

export default NorthStarGoals;
