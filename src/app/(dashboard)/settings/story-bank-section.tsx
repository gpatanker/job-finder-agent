"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { StoryBankEntry } from "@/lib/db/schema";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type StoryFormValues = { slug: string; title: string; tags: string; content: string };

function StoryForm({
  initial,
  isNew,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: StoryFormValues;
  isNew: boolean;
  pending: boolean;
  onSubmit: (values: StoryFormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-testid="story-form">
      <div className="space-y-1.5">
        <Label>Slug</Label>
        <Input
          value={values.slug}
          disabled={!isNew}
          onChange={(e) => setValues((v) => ({ ...v, slug: e.target.value }))}
          data-testid="story-form-slug"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Title</Label>
        <Input
          value={values.title}
          onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
          data-testid="story-form-title"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Tags (comma-separated)</Label>
        <Input
          value={values.tags}
          onChange={(e) => setValues((v) => ({ ...v, tags: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Content</Label>
        <Textarea
          className="min-h-40"
          value={values.content}
          onChange={(e) => setValues((v) => ({ ...v, content: e.target.value }))}
          data-testid="story-form-content"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} data-testid="story-form-submit">
          {pending ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}

export function StoryBankSection({ stories: initialStories }: { stories: StoryBankEntry[] }) {
  const [stories, setStories] = useState(initialStories);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<StoryBankEntry | null>(null);
  const [pending, setPending] = useState(false);

  async function handleCreate(values: StoryFormValues) {
    setPending(true);
    try {
      const res = await fetch("/api/settings/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: values.slug,
          title: values.title,
          tags: values.tags.split(",").map((t) => t.trim()).filter(Boolean),
          content: values.content,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to add story");
      setStories((s) => [...s, body.story].sort((a, b) => a.title.localeCompare(b.title)));
      toast.success("Story added");
      setShowAdd(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add story");
    } finally {
      setPending(false);
    }
  }

  async function handleEdit(values: StoryFormValues) {
    if (!editing) return;
    setPending(true);
    try {
      const res = await fetch(`/api/settings/stories/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          tags: values.tags.split(",").map((t) => t.trim()).filter(Boolean),
          content: values.content,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update story");
      setStories((s) => s.map((story) => (story.id === body.story.id ? body.story : story)));
      toast.success("Story updated");
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update story");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(story: StoryBankEntry) {
    if (!confirm(`Delete story "${story.title}"?`)) return;
    try {
      const res = await fetch(`/api/settings/stories/${story.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete story");
      setStories((s) => s.filter((x) => x.id !== story.id));
      toast.success("Story deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete story");
    }
  }

  return (
    <div className="mt-4 space-y-3" data-testid="story-bank-section">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {stories.length} stories grounding generated answers
        </p>
        <Button onClick={() => setShowAdd(true)} data-testid="add-story-button">
          <Plus className="h-4 w-4" /> Add story
        </Button>
      </div>

      <div className="space-y-2">
        {stories.map((story) => (
          <Card key={story.id} data-testid={`story-${story.id}`}>
            <CardContent className="py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{story.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {story.tags.map((tag) => (
                      <Badge key={tag} variant="neutral">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditing(story)}
                    data-testid={`edit-story-${story.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(story)}
                    data-testid={`delete-story-${story.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{story.content}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {showAdd && (
        <Modal title="Add story" onClose={() => setShowAdd(false)}>
          <StoryForm
            initial={{ slug: "", title: "", tags: "", content: "" }}
            isNew
            pending={pending}
            onSubmit={handleCreate}
            onCancel={() => setShowAdd(false)}
          />
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit: ${editing.title}`} onClose={() => setEditing(null)}>
          <StoryForm
            initial={{
              slug: editing.slug,
              title: editing.title,
              tags: editing.tags.join(", "),
              content: editing.content,
            }}
            isNew={false}
            pending={pending}
            onSubmit={handleEdit}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}
